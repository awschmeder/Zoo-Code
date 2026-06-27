export function getSharedToolUseSection(): string {
	return `====

TOOL USE PROTOCOL

You have access to a set of tools that are executed upon the user's approval.

- Emit tool calls only through your built-in tool-calling mechanism -- do not write tool calls or tool-call wrappers as text in your reply.
- Tool-call arguments must be values conforming to each tool's parameter schema (strings, numbers, booleans, arrays, objects); never embed markup such as \`<parameter ...>\` or any XML/pseudo-tag inside an argument value.
- Every response MUST contain at least one tool call -- including confirmations, acknowledgments, and answers to conversational questions. A response with no tool call is a protocol error.`
}
