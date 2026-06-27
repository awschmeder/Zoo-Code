import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk" // Keep for type usage only

import { litellmDefaultModelId, litellmDefaultModelInfo } from "@roo-code/types"

import { calculateApiCostOpenAI } from "../../shared/cost"

import { ApiHandlerOptions } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { sanitizeOpenAiCallId } from "../../utils/tool-id"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { RouterProvider } from "./router-provider"
import { extractReasoningFromDelta } from "./utils/extract-reasoning"

/**
 * LiteLLM provider handler
 *
 * This handler uses the LiteLLM API to proxy requests to various LLM providers.
 * It follows the OpenAI API format for compatibility.
 */
export class LiteLLMHandler extends RouterProvider implements SingleCompletionHandler {
	// The most recent Gemini thought signature captured from the streaming response.
	// Persisted via getThoughtSignature() so it can be replayed on subsequent requests,
	// preserving Gemini's thought-summary continuity (see fix-gemini-thought-signature plan).
	private lastThoughtSignature: string | undefined

	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "litellm",
			baseURL: `${options.litellmBaseUrl || "http://localhost:4000"}`,
			apiKey: options.litellmApiKey || "dummy-key",
			modelId: options.litellmModelId,
			defaultModelId: litellmDefaultModelId,
			defaultModelInfo: litellmDefaultModelInfo,
		})
	}

	private isGpt5(modelId: string): boolean {
		// Match gpt-5, gpt5, and variants like gpt-5o, gpt-5-turbo, gpt5-preview, gpt-5.1
		// Avoid matching gpt-50, gpt-500, etc.
		return /\bgpt-?5(?!\d)/i.test(modelId)
	}

	/**
	 * Detect if the model is a Gemini model that requires thought signature handling.
	 * Gemini 3 models validate thought signatures for tool/function calling steps.
	 */
	private isGeminiModel(modelId: string): boolean {
		// Match various Gemini model patterns:
		// - gemini-3-pro, gemini-3-flash, gemini-3-*
		// - gemini 3 pro, Gemini 3 Pro (space-separated, case-insensitive)
		// - gemini/gemini-3-*, google/gemini-3-*
		// - vertex_ai/gemini-3-*, vertex/gemini-3-*
		// Also match Gemini 2.5+ models which use similar validation
		const lowerModelId = modelId.toLowerCase()
		return (
			// Match hyphenated versions: gemini-3, gemini-2.5
			lowerModelId.includes("gemini-3") ||
			lowerModelId.includes("gemini-2.5") ||
			// Match space-separated versions: "gemini 3", "gemini 2.5"
			// This handles model names like "Gemini 3 Pro" from LiteLLM model groups
			lowerModelId.includes("gemini 3") ||
			lowerModelId.includes("gemini 2.5") ||
			// Also match provider-prefixed versions
			/\b(gemini|google|vertex_ai|vertex)\/gemini[-\s](3|2\.5)/i.test(modelId)
		)
	}

	/**
	 * Build a map from assistant-message ordinal (index among assistant messages, in order)
	 * to the real Gemini thought signature persisted on that message.
	 *
	 * The signature is persisted by the generic history pipeline as a
	 * `{ type: "thoughtSignature", thoughtSignature }` block appended to the assistant
	 * message content (see apiConversationHistory.ts). `convertToOpenAiMessages` drops this
	 * unknown block type, so it never leaks into wire content -- we read it here from the
	 * original Anthropic messages and reattach it as provider_specific_fields during injection.
	 *
	 * Keying by assistant ordinal is safe because each assistant Anthropic message maps 1:1,
	 * in order, to exactly one assistant OpenAI message in convertToOpenAiMessages.
	 */
	private buildRealThoughtSignatureMap(messages: Anthropic.Messages.MessageParam[]): Map<number, string> {
		const signatureByAssistantIndex = new Map<number, string>()
		let assistantIndex = -1

		for (const message of messages) {
			if (message.role !== "assistant") {
				continue
			}
			assistantIndex++

			if (!Array.isArray(message.content)) {
				continue
			}

			for (const block of message.content as Array<{ type: string; thoughtSignature?: string }>) {
				if (block.type === "thoughtSignature" && block.thoughtSignature) {
					signatureByAssistantIndex.set(assistantIndex, block.thoughtSignature)
				}
			}
		}

		return signatureByAssistantIndex
	}

	/**
	 * Inject thought signatures for Gemini models via provider_specific_fields.
	 *
	 * When a real per-message signature is available (captured from a prior Gemini turn and
	 * persisted into history), it is replayed onto the assistant message so Gemini can continue
	 * emitting thought summaries instead of degrading into raw reasoning.
	 *
	 * When no real signature is present (e.g. cross-model history where tool calls came from
	 * another model like Claude), the dummy signature base64("skip_thought_signature_validator")
	 * is injected to bypass Gemini's validation for tool calls.
	 *
	 * Per LiteLLM documentation, thought signatures are carried in
	 * provider_specific_fields.thought_signature of tool calls.
	 */
	private injectThoughtSignatureForGemini(
		openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[],
		realSignatureByAssistantIndex?: Map<number, string>,
	): OpenAI.Chat.ChatCompletionMessageParam[] {
		// Base64 encoded "skip_thought_signature_validator" as per LiteLLM docs
		const dummySignature = Buffer.from("skip_thought_signature_validator").toString("base64")
		let assistantIndex = -1

		return openAiMessages.map((msg) => {
			if (msg.role === "assistant") {
				assistantIndex++
				const toolCalls = (msg as any).tool_calls as any[] | undefined
				const realSignature = realSignatureByAssistantIndex?.get(assistantIndex)

				// Prefer the real captured signature for this message; fall back to the dummy
				// so cross-model / missing-history validation behavior is preserved.
				const signature = realSignature ?? dummySignature

				if (toolCalls && toolCalls.length > 0) {
					// Inject the resolved signature into ALL tool calls' provider_specific_fields
					const updatedToolCalls = toolCalls.map((tc) => ({
						...tc,
						provider_specific_fields: {
							...(tc.provider_specific_fields || {}),
							thought_signature: signature,
						},
					}))

					return {
						...msg,
						tool_calls: updatedToolCalls,
					}
				}

				// Fallback for assistant turns that carry a real signature but no tool calls.
				// In normal Zoo operation every assistant turn ends with a tool call, so this
				// path is not expected to fire; it exists only as a safety net in case Zoo's
				// operational requirements ever change (e.g. allowing tool-free reasoning turns).
				// The proxy accepts a message-level provider_specific_fields.thought_signatures
				// (array) on an assistant message. The dummy is intentionally not applied here --
				// only a genuine captured signature warrants message-level continuity.
				if (realSignature) {
					return {
						...msg,
						provider_specific_fields: {
							...((msg as any).provider_specific_fields || {}),
							thought_signatures: [realSignature],
						},
					} as OpenAI.Chat.ChatCompletionMessageParam
				}
			}
			return msg
		})
	}

	/**
	 * Expose the most recent captured Gemini thought signature so the generic history
	 * pipeline (apiConversationHistory.ts) can persist it onto the assistant message.
	 * Mirrors the native Gemini provider's getThoughtSignature().
	 */
	public getThoughtSignature(): string | undefined {
		return this.lastThoughtSignature
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Reset per-turn so a stale signature never carries over between turns.
		this.lastThoughtSignature = undefined

		const { id: modelId, info } = await this.fetchModel()

		const openAiMessages = convertToOpenAiMessages(messages, {
			normalizeToolCallId: sanitizeOpenAiCallId,
		})

		// Prepare messages with cache control if enabled and supported
		let systemMessage: OpenAI.Chat.ChatCompletionMessageParam
		let enhancedMessages: OpenAI.Chat.ChatCompletionMessageParam[]

		if (this.options.litellmUsePromptCache && info.supportsPromptCache) {
			// Create system message with cache control in the proper format
			systemMessage = {
				role: "system",
				content: [
					{
						type: "text",
						text: systemPrompt,
						cache_control: { type: "ephemeral" },
					} as any,
				],
			}

			// Find the last two user messages to apply caching
			const userMsgIndices = openAiMessages.reduce(
				(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
				[] as number[],
			)
			const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
			const secondLastUserMsgIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1

			// Apply cache_control to the last two user messages
			enhancedMessages = openAiMessages.map((message, index) => {
				if ((index === lastUserMsgIndex || index === secondLastUserMsgIndex) && message.role === "user") {
					// Handle both string and array content types
					if (typeof message.content === "string") {
						return {
							...message,
							content: [
								{
									type: "text",
									text: message.content,
									cache_control: { type: "ephemeral" },
								} as any,
							],
						}
					} else if (Array.isArray(message.content)) {
						// Apply cache control to the last content item in the array
						return {
							...message,
							content: message.content.map((content, contentIndex) =>
								contentIndex === message.content.length - 1
									? ({
											...content,
											cache_control: { type: "ephemeral" },
										} as any)
									: content,
							),
						}
					}
				}
				return message
			})
		} else {
			// No cache control - use simple format
			systemMessage = { role: "system", content: systemPrompt }
			enhancedMessages = openAiMessages
		}

		// Required by some providers; others default to max tokens allowed
		const maxTokens: number | undefined = info.maxTokens ?? undefined

		// Check if this is a GPT-5 model that requires max_completion_tokens instead of max_tokens
		const isGPT5Model = this.isGpt5(modelId)

		// For Gemini models with native protocol: inject fake reasoning.encrypted block for tool calls
		// This is required when switching from other models to Gemini to satisfy API validation.
		// Gemini 3 models validate thought signatures for function calls, and when conversation
		// history contains tool calls from other models (like Claude), they lack the required
		// signatures. The "skip_thought_signature_validator" value bypasses this validation.
		const isGemini = this.isGeminiModel(modelId)
		let processedMessages = enhancedMessages
		if (isGemini) {
			// Replay real per-message signatures captured from prior Gemini turns when present,
			// falling back to the dummy bypass for messages that lack one (cross-model history).
			const realSignatureByAssistantIndex = this.buildRealThoughtSignatureMap(messages)
			processedMessages = this.injectThoughtSignatureForGemini(enhancedMessages, realSignatureByAssistantIndex)
		}

		const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: modelId,
			messages: [systemMessage, ...processedMessages],
			stream: true,
			stream_options: {
				include_usage: true,
			},
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
		}

		// GPT-5 models require max_completion_tokens instead of the deprecated max_tokens parameter
		if (isGPT5Model && maxTokens) {
			requestOptions.max_completion_tokens = maxTokens
		} else if (maxTokens) {
			requestOptions.max_tokens = maxTokens
		}

		if (this.supportsTemperature(modelId)) {
			requestOptions.temperature = this.options.modelTemperature ?? 0
		}

		// LiteLLM recognizes X-<vendor>-Session-ID for per-conversation request correlation.
		// This header enables LiteLLM to group related API calls by task for logging and tracing.
		// Unlike Zoo gateways (which use X-Zoo-Task-ID to correlate requests across multiple
		// models within a single conversation), this header is specific to the LiteLLM provider
		// and facilitates provider-level logging and debugging on LiteLLM's admin panel.
		// Matches the convention used by Claude Code (x-claude-code-session-id) and
		// GitHub Copilot (x-copilot-session-id).
		const requestHeaders: Record<string, string> = {}
		if (metadata?.taskId) {
			requestHeaders["X-Zoo-Session-ID"] = metadata.taskId
		}

		try {
			const { data: completion } = await this.client.chat.completions
				.create(requestOptions, { headers: requestHeaders })
				.withResponse()

			let lastUsage

			for await (const chunk of completion) {
				const delta = chunk.choices[0]?.delta
				const usage = chunk.usage as LiteLLMUsage

				if (delta?.content) {
					yield { type: "text", text: delta.content }
				}

				const reasoningText = extractReasoningFromDelta(delta)
				if (reasoningText) {
					yield { type: "reasoning", text: reasoningText }
				}

				// Capture Gemini thought signatures so they can be persisted on the assistant
				// message and replayed on the next request, preserving thought-summary continuity.
				// Narrow local cast mirrors the LiteLLMUsage cast; the field is not on the SDK type.
				const providerFields = (delta as LiteLLMDelta | undefined)?.provider_specific_fields
				const thoughtSignatures = providerFields?.thought_signatures
				if (Array.isArray(thoughtSignatures)) {
					for (const signature of thoughtSignatures) {
						// Entries may be empty strings; keep the last non-empty one.
						if (signature) {
							this.lastThoughtSignature = signature
						}
					}
				}

				// Handle tool calls in stream - emit partial chunks for NativeToolCallParser
				if (delta?.tool_calls) {
					for (const toolCall of delta.tool_calls) {
						yield {
							type: "tool_call_partial",
							index: toolCall.index,
							id: toolCall.id,
							name: toolCall.function?.name,
							arguments: toolCall.function?.arguments,
						}
					}
				}

				if (usage) {
					lastUsage = usage
				}
			}

			if (lastUsage) {
				// Extract cache-related information if available
				// LiteLLM may use different field names for cache tokens
				const cacheWriteTokens =
					lastUsage.cache_creation_input_tokens || (lastUsage as any).prompt_cache_miss_tokens || 0
				const cacheReadTokens =
					lastUsage.prompt_tokens_details?.cached_tokens ||
					(lastUsage as any).cache_read_input_tokens ||
					(lastUsage as any).prompt_cache_hit_tokens ||
					0

				const { totalCost } = calculateApiCostOpenAI(
					info,
					lastUsage.prompt_tokens || 0,
					lastUsage.completion_tokens || 0,
					cacheWriteTokens,
					cacheReadTokens,
				)

				const usageData: ApiStreamUsageChunk = {
					type: "usage",
					inputTokens: lastUsage.prompt_tokens || 0,
					outputTokens: lastUsage.completion_tokens || 0,
					cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
					cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
					totalCost,
				}

				yield usageData
			}
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`LiteLLM streaming error: ${error.message}`)
			}
			throw error
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId, info } = await this.fetchModel()

		// Check if this is a GPT-5 model that requires max_completion_tokens instead of max_tokens
		const isGPT5Model = this.isGpt5(modelId)

		try {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: [{ role: "user", content: prompt }],
			}

			if (this.supportsTemperature(modelId)) {
				requestOptions.temperature = this.options.modelTemperature ?? 0
			}

			// GPT-5 models require max_completion_tokens instead of the deprecated max_tokens parameter
			if (isGPT5Model && info.maxTokens) {
				requestOptions.max_completion_tokens = info.maxTokens
			} else if (info.maxTokens) {
				requestOptions.max_tokens = info.maxTokens
			}

			const response = await this.client.chat.completions.create(requestOptions)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`LiteLLM completion error: ${error.message}`)
			}
			throw error
		}
	}
}

// LiteLLM usage may include an extra field for Anthropic use cases.
interface LiteLLMUsage extends OpenAI.CompletionUsage {
	cache_creation_input_tokens?: number
}

// LiteLLM streaming deltas carry Gemini continuity handles in provider_specific_fields,
// which is not part of the OpenAI SDK delta type.
interface LiteLLMDelta extends OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta {
	provider_specific_fields?: {
		thought_signatures?: string[]
	}
}
