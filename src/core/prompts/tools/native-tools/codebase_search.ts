import type OpenAI from "openai"

const CODEBASE_SEARCH_DESCRIPTION = `Find files most relevant to the search query using semantic search. Searches based on meaning rather than exact text matches. By default searches entire workspace. Reuse the user's exact wording unless there's a clear reason not to - their phrasing often helps semantic search. Queries MUST be in English (translate if needed).

When to use this tool: codebase_search is the primary tool for codebase exploration when exploring an unfamiliar area by concept or behavior (e.g. "where is retry logic handled") and you do not yet know the exact symbol, file, or literal. For precise matching of known terms, symbols, or patterns, use search_files. To examine directory structure, use list_files. To open a specific file path, prefer read_file.

NOTE: Do NOT use codebase_search to look up exact keywords, symbol names, function/method/class/variable names, or filenames. If you already have a specific term, literal, or identifier in mind, always use search_files or list_files instead. Avoid running consecutive or repetitive codebase_searches to explore; use it at most a few times to get oriented, then transition to precise search or read tools.

Failure modes and recovery: this tool returns results only when the workspace index is available. If indexing is disabled, still building, incomplete, or unreachable, it can return empty or low-confidence results without an explicit error. When results are empty or clearly off-target, do NOT re-run the same query -- fall back to search_files (for known text/patterns) or read_file (for known paths) instead.

Parameters:
- query: (required) The search query. Reuse the user's exact wording/question format unless there's a clear reason not to.
- path: (optional) Limit search to specific subdirectory (relative to the current workspace directory). Leave empty for entire workspace.

Example: Searching for user authentication code
{ "query": "User login and password hashing", "path": "src/auth" }

Example: Searching entire workspace
{ "query": "database connection pooling", "path": null }`

const QUERY_PARAMETER_DESCRIPTION = `Meaning-based search query describing the information you need`

const PATH_PARAMETER_DESCRIPTION = `Optional subdirectory (relative to the workspace) to limit the search scope`

export default {
	type: "function",
	function: {
		name: "codebase_search",
		description: CODEBASE_SEARCH_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: QUERY_PARAMETER_DESCRIPTION,
				},
				path: {
					type: ["string", "null"],
					description: PATH_PARAMETER_DESCRIPTION,
				},
			},
			required: ["query", "path"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
