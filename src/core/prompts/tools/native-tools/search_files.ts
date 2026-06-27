import type OpenAI from "openai"

const SEARCH_FILES_DESCRIPTION = `Request to perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context.

When to use this tool: prefer search_files when you already know an exact symbol, string literal, or regex pattern to match (such as a specific keyword, function name, class name, or variable name). For semantic search/exploration of unfamiliar areas, prefer codebase_search first if it is available, then use search_files to pin down specific matches. To enumerate files, use list_files.

Craft your regex patterns carefully to balance specificity and flexibility. Use this tool to find code patterns, TODO comments, function definitions, or any text-based information across the project. The results include surrounding context, so analyze the surrounding code to better understand the matches. Leverage this tool in combination with other tools for more comprehensive analysis.

Regex dialect: patterns use Rust regex syntax, which does NOT support lookarounds ((?=...), (?!...), (?<=...), (?<!...)) or backreferences (\\1). Matching is case-sensitive by default; prepend the (?i) flag for case-insensitive matching (e.g. (?i)todo matches TODO, Todo, and todo).

Parameters:
- path: (required) The path of the directory to search in (relative to the current workspace directory). This directory will be recursively searched.
- regex: (required) The regular expression pattern to search for. Uses Rust regex syntax (no lookarounds or backreferences; use (?i) for case-insensitive matching).
- file_pattern: (optional) Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).

Example: Searching for all .ts files in the current directory
{ "path": ".", "regex": ".*", "file_pattern": "*.ts" }

Example: Searching for function definitions in JavaScript files
{ "path": "src", "regex": "function\\s+\\w+", "file_pattern": "*.js" }`

const PATH_PARAMETER_DESCRIPTION = `Directory to search recursively, relative to the workspace`

const REGEX_PARAMETER_DESCRIPTION = `Rust-compatible regular expression pattern to match`

const FILE_PATTERN_PARAMETER_DESCRIPTION = `Optional glob to limit which files are searched (e.g., *.ts)`

export default {
	type: "function",
	function: {
		name: "search_files",
		description: SEARCH_FILES_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: PATH_PARAMETER_DESCRIPTION,
				},
				regex: {
					type: "string",
					description: REGEX_PARAMETER_DESCRIPTION,
				},
				file_pattern: {
					type: ["string", "null"],
					description: FILE_PATTERN_PARAMETER_DESCRIPTION,
				},
			},
			required: ["path", "regex", "file_pattern"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
