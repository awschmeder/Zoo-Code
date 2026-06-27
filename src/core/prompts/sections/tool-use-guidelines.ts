export function getToolUseGuidelinesSection(): string {
	return `# Tool Selection Guidelines

- Assess what information you already have and what information you need to proceed with the task.
- If you need additional information to proceed, assess which of the available tools would be most effective for gathering this information.
- Prefer using the provided tools when possible, instead of using \`execute_command\` to perform equivalent operations using the shell.
- Each tool use should be informed by the results of previous tool uses and user prompts.
- Every response must contain at least one tool call.
- If multiple actions are needed, you may use multiple tools in parallel in a single response when appropriate, or use tools sequentially across multiple responses. Prefer parallel tool calls when possible and appropriate.
- Choose the most appropriate tool based on the task and the tool descriptions provided.`
}
