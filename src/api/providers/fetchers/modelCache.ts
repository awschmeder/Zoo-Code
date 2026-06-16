import * as path from "path"
import fs from "fs/promises"
import * as fsSync from "fs"
import { createHash } from "crypto"

import NodeCache from "node-cache"
import { z } from "zod"

import type { ProviderName, ModelRecord } from "@roo-code/types"
import { modelInfoSchema, TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { safeWriteJson } from "../../../utils/safeWriteJson"

import { ContextProxy } from "../../../core/config/ContextProxy"
import { getCacheDirectoryPath } from "../../../utils/storage"
import type { RouterName } from "../../../shared/api"
import { fileExistsAtPath } from "../../../utils/fs"

import { getOpenRouterModels } from "./openrouter"
import { getVercelAiGatewayModels } from "./vercel-ai-gateway"
import { getOpencodeGoModels } from "./opencode-go"
import { getRequestyModels } from "./requesty"
import { getUnboundModels } from "./unbound"
import { getLiteLLMModels } from "./litellm"
import { GetModelsOptions } from "../../../shared/api"
import { getOllamaModels } from "./ollama"
import { getLMStudioModels } from "./lmstudio"
import { getPoeModels } from "./poe"
import { getDeepSeekModels } from "./deepseek"
import { getZooGatewayModels } from "./zoo-gateway"

const memoryCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 5 * 60 })

// Zod schema for validating ModelRecord structure from disk cache
const modelRecordSchema = z.record(z.string(), modelInfoSchema)

// Track in-flight refresh requests to prevent concurrent API calls for the same provider+url.
// Keyed on the compound cache key (see getCacheKey) so that two different LiteLLM servers never
// deduplicate each other's in-flight refreshes.
const inFlightRefresh = new Map<string, Promise<ModelRecord>>()

// Providers whose model lists are scoped to the signed-in user (e.g. per-account
// allowlists or org policies). For these we MUST NOT cache results on disk or
// in memory: a sign-in/out cycle could otherwise serve a previous user's model
// list to the next user, and stale data could mask backend allowlist updates.
const AUTH_SCOPED_PROVIDERS: ReadonlySet<RouterName> = new Set(["zoo-gateway"])

// Providers whose model list is determined by the server URL, not just by the provider name.
// Each unique baseUrl must be cached independently so that switching endpoints never serves
// stale results from a previously-cached server.
const URL_SCOPED_PROVIDERS: ReadonlySet<RouterName> = new Set([
	"litellm",
	"poe",
	"deepseek",
	"ollama",
	"lmstudio",
	"requesty",
])

// Providers where the API key itself determines which models are visible (e.g. per-key
// allowlists on a shared proxy). For these the cache key also includes a short hash of
// the API key so that two different keys on the same server never share a cache entry.
const KEY_SCOPED_PROVIDERS: ReadonlySet<RouterName> = new Set([
	"litellm", // Per-key model allowlists are a first-class LiteLLM proxy feature
	"poe", // Per-account model availability
	"requesty", // Per-account custom model policies
])

function isAuthScopedProvider(provider: RouterName): boolean {
	return AUTH_SCOPED_PROVIDERS.has(provider)
}

/**
 * Build a cache key that is unique per provider+server+key combination.
 *
 * - URL-scoped providers include the normalized baseUrl so that two different servers
 *   of the same provider type never share a cache entry.
 * - Key-scoped providers additionally fold in a short sha256 hash of the API key so that
 *   two different API keys on the same server never share a cache entry (relevant when
 *   the server enforces per-key model allowlists, e.g. LiteLLM, Poe, Requesty).
 */
function getCacheKey(options: GetModelsOptions): string {
	const { provider } = options
	const isUrlScoped = URL_SCOPED_PROVIDERS.has(provider as RouterName)
	const isKeyScoped = KEY_SCOPED_PROVIDERS.has(provider as RouterName)

	if (isUrlScoped && options.baseUrl) {
		// Strip trailing slashes so "http://host:4000/" and "http://host:4000" map to the same key.
		const normalizedUrl = options.baseUrl.replace(/\/+$/, "")
		if (isKeyScoped && options.apiKey) {
			// Short (16-char) sha256 prefix -- enough to make collisions effectively impossible
			// while keeping filenames readable. We do not need the full digest here.
			const keyHash = createHash("sha256").update(options.apiKey).digest("hex").slice(0, 16)
			return `${provider}:${normalizedUrl}:${keyHash}`
		}
		return `${provider}:${normalizedUrl}`
	}
	return provider
}

/**
 * Convert a cache key to a filesystem-safe filename component.
 * Replaces characters that are illegal or awkward in filenames with underscores.
 */
function cacheKeyToFilename(cacheKey: string): string {
	return cacheKey.replace(/[:/\\?#*<>|"\s]+/g, "_")
}

async function writeModels(cacheKey: string, data: ModelRecord) {
	const filename = `${cacheKeyToFilename(cacheKey)}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	await safeWriteJson(path.join(cacheDir, filename), data)
}

async function readModels(cacheKey: string): Promise<ModelRecord | undefined> {
	const filename = `${cacheKeyToFilename(cacheKey)}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	const filePath = path.join(cacheDir, filename)
	const exists = await fileExistsAtPath(filePath)
	return exists ? JSON.parse(await fs.readFile(filePath, "utf8")) : undefined
}

/**
 * Fetch models from the provider API.
 * Extracted to avoid duplication between getModels() and refreshModels().
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from the provider API
 */
async function fetchModelsFromProvider(options: GetModelsOptions): Promise<ModelRecord> {
	const { provider } = options

	let models: ModelRecord

	switch (provider) {
		case "openrouter":
			models = await getOpenRouterModels()
			break
		case "requesty":
			// Requesty models endpoint requires an API key for per-user custom policies.
			models = await getRequestyModels(options.baseUrl, options.apiKey)
			break
		case "unbound":
			models = await getUnboundModels(options.apiKey)
			break
		case "litellm":
			// Type safety ensures apiKey and baseUrl are always provided for LiteLLM.
			models = await getLiteLLMModels(options.apiKey, options.baseUrl)
			break
		case "ollama":
			models = await getOllamaModels(options.baseUrl, options.apiKey)
			break
		case "lmstudio":
			models = await getLMStudioModels(options.baseUrl)
			break
		case "vercel-ai-gateway":
			models = await getVercelAiGatewayModels()
			break
		case "opencode-go":
			models = await getOpencodeGoModels(options.apiKey)
			break
		case "poe":
			models = await getPoeModels(options.apiKey, options.baseUrl)
			break
		case "deepseek":
			models = await getDeepSeekModels(options.baseUrl, options.apiKey)
			break
		case "zoo-gateway":
			models = await getZooGatewayModels({ zooSessionToken: options.apiKey, zooGatewayBaseUrl: options.baseUrl })
			break
		default: {
			// Ensures router is exhaustively checked if RouterName is a strict union.
			const exhaustiveCheck: never = provider
			throw new Error(`Unknown provider: ${exhaustiveCheck}`)
		}
	}

	return models
}

/**
 * Get models from the cache or fetch them from the provider and cache them.
 * There are two caches:
 * 1. Memory cache - This is a simple in-memory cache that is used to store models for a short period of time.
 * 2. File cache - This is a file-based cache that is used to store models for a longer period of time.
 *
 * @param router - The router to fetch models from.
 * @param apiKey - Optional API key for the provider.
 * @param baseUrl - Optional base URL for the provider (currently used only for LiteLLM).
 * @returns The models from the cache or the fetched models.
 */
export const getModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options
	const cacheKey = getCacheKey(options)

	const shouldSkipCache = isAuthScopedProvider(provider)

	let models = shouldSkipCache ? undefined : getModelsFromCache(options)

	if (models) {
		return models
	}

	try {
		models = await fetchModelsFromProvider(options)
		const modelCount = Object.keys(models).length

		// Only cache non-empty results so a failed API response doesn't get persisted
		// as if the provider had no models. Auth-scoped providers skip caching entirely.
		if (modelCount > 0 && !shouldSkipCache) {
			memoryCache.set(cacheKey, models)

			await writeModels(cacheKey, models).catch((err) =>
				console.error(`[MODEL_CACHE] Error writing ${cacheKey} models to file cache:`, err),
			)
		} else if (modelCount === 0) {
			TelemetryService.instance.captureEvent(TelemetryEventName.MODEL_CACHE_EMPTY_RESPONSE, {
				provider,
				context: "getModels",
				hasExistingCache: false,
			})
		}

		return models
	} catch (error) {
		// Log the error and re-throw it so the caller can handle it (e.g., show a UI message).
		console.error(`[getModels] Failed to fetch models in modelCache for ${provider}:`, error)

		throw error // Re-throw the original error to be handled by the caller.
	}
}

/**
 * Force-refresh models from API, bypassing cache.
 * Uses atomic writes so cache remains available during refresh.
 * This function also prevents concurrent API calls for the same provider using
 * in-flight request tracking to avoid race conditions.
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from API, or existing cache if refresh yields worse data
 */
export const refreshModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options
	const cacheKey = getCacheKey(options)

	const shouldSkipCache = isAuthScopedProvider(provider)

	// Check if there's already an in-flight refresh for this provider+url combination.
	// This prevents race conditions where multiple concurrent refreshes might
	// overwrite each other's results. Skip de-duplication for auth-scoped
	// providers because two concurrent calls may carry different tokens
	// (e.g., after a sign-out/sign-in within the same session) and we must
	// not return the first caller's results to the second caller.
	if (!shouldSkipCache) {
		const existingRequest = inFlightRefresh.get(cacheKey)
		if (existingRequest) {
			return existingRequest
		}
	}

	// Create the refresh promise and track it
	const refreshPromise = (async (): Promise<ModelRecord> => {
		try {
			// Force fresh API fetch - skip getModelsFromCache() check
			const models = await fetchModelsFromProvider(options)
			const modelCount = Object.keys(models).length

			// Get existing cached data for comparison
			const existingCache = shouldSkipCache ? undefined : getModelsFromCache(options)
			const existingCount = existingCache ? Object.keys(existingCache).length : 0

			if (modelCount === 0) {
				TelemetryService.instance.captureEvent(TelemetryEventName.MODEL_CACHE_EMPTY_RESPONSE, {
					provider,
					context: "refreshModels",
					hasExistingCache: existingCount > 0,
					existingCacheSize: existingCount,
				})
				if (existingCount > 0) {
					return existingCache!
				} else {
					return {}
				}
			}

			if (!shouldSkipCache) {
				memoryCache.set(cacheKey, models)

				await writeModels(cacheKey, models).catch((err) =>
					console.error(`[refreshModels] Error writing ${cacheKey} models to disk:`, err),
				)
			}

			return models
		} catch (error) {
			// Log the error for debugging, then return existing cache if available (graceful degradation).
			// For auth-scoped providers (zoo-gateway) we MUST NOT return cached models from a prior
			// session, since they could belong to a different user -- return empty instead.
			console.error(`[refreshModels] Failed to refresh ${cacheKey} models:`, error)
			if (shouldSkipCache) {
				return {}
			}
			return getModelsFromCache(options) || {}
		} finally {
			// Always clean up the in-flight tracking
			if (!shouldSkipCache) {
				inFlightRefresh.delete(cacheKey)
			}
		}
	})()

	// Track the in-flight request (auth-scoped providers are excluded; see above).
	if (!shouldSkipCache) {
		inFlightRefresh.set(cacheKey, refreshPromise)
	}

	return refreshPromise
}

/**
 * Initialize background model cache refresh.
 * Refreshes public provider caches without blocking or requiring auth.
 * Should be called once during extension activation.
 */
export async function initializeModelCacheRefresh(): Promise<void> {
	// Wait for extension to fully activate before refreshing
	setTimeout(async () => {
		// Providers that work without API keys
		const publicProviders: Array<{ provider: RouterName; options: GetModelsOptions }> = [
			{ provider: "openrouter", options: { provider: "openrouter" } },
			{ provider: "vercel-ai-gateway", options: { provider: "vercel-ai-gateway" } },
		]

		// Refresh each provider in background (fire and forget)
		for (const { options } of publicProviders) {
			refreshModels(options).catch(() => {
				// Silent fail - old cache remains available
			})

			// Small delay between refreshes to avoid API rate limits
			await new Promise((resolve) => setTimeout(resolve, 500))
		}
	}, 2000)
}

/**
 * Flush models memory cache for a specific router.
 *
 * @param options - The options for fetching models, including provider, apiKey, and baseUrl
 * @param refresh - If true, immediately fetch fresh data from API
 */
export const flushModels = async (options: GetModelsOptions, refresh: boolean = false): Promise<void> => {
	if (refresh) {
		// Don't delete memory cache - let refreshModels atomically replace it
		// This prevents a race condition where getModels() might be called
		// before refresh completes, avoiding a gap in cache availability
		// Await the refresh to ensure the cache is updated before returning
		await refreshModels(options)
	} else {
		// Only delete memory cache when not refreshing. Use the compound cache key so that
		// URL-scoped providers (litellm, poe, etc.) actually evict the per-server entry rather
		// than a bare provider-name entry that was never written.
		memoryCache.del(getCacheKey(options))
	}
}

/**
 * Get models from cache, checking memory first, then disk.
 * This ensures providers always have access to last known good data,
 * preventing fallback to hardcoded defaults on startup.
 *
 * @param provider - The provider to get models for.
 * @returns Models from memory cache, disk cache, or undefined if not cached.
 */
export function getModelsFromCache(
	options: GetModelsOptions | ProviderName,
): ModelRecord | undefined {
	const cacheKey = typeof options === "string" ? options : getCacheKey(options)
	// Check memory cache first (fast)
	const memoryModels = memoryCache.get<ModelRecord>(cacheKey)
	if (memoryModels) {
		return memoryModels
	}

	// Memory cache miss - try to load from disk synchronously
	// This is acceptable because it only happens on cold start or after cache expiry
	try {
		const filename = `${cacheKeyToFilename(cacheKey)}_models.json`
		const cacheDir = getCacheDirectoryPathSync()
		if (!cacheDir) {
			return undefined
		}

		const filePath = path.join(cacheDir, filename)

		// Use synchronous fs to avoid async complexity in getModel() callers
		if (fsSync.existsSync(filePath)) {
			const data = fsSync.readFileSync(filePath, "utf8")
			const models = JSON.parse(data)

			// Validate the disk cache data structure using Zod schema
			// This ensures the data conforms to ModelRecord = Record<string, ModelInfo>
			const validation = modelRecordSchema.safeParse(models)
			if (!validation.success) {
				console.error(
					`[MODEL_CACHE] Invalid disk cache data structure for ${cacheKey}:`,
					validation.error.format(),
				)
				return undefined
			}

			// Populate memory cache for future fast access
			memoryCache.set(cacheKey, validation.data)

			return validation.data
		}
	} catch (error) {
		console.error(`[MODEL_CACHE] Error loading ${cacheKey} models from disk:`, error)
	}

	return undefined
}

/**
 * Synchronous version of getCacheDirectoryPath for use in getModelsFromCache.
 * Returns the cache directory path without async operations.
 */
function getCacheDirectoryPathSync(): string | undefined {
	try {
		const globalStoragePath = ContextProxy.instance?.globalStorageUri?.fsPath
		if (!globalStoragePath) {
			return undefined
		}
		const cachePath = path.join(globalStoragePath, "cache")
		return cachePath
	} catch (error) {
		console.error(`[MODEL_CACHE] Error getting cache directory path:`, error)
		return undefined
	}
}
