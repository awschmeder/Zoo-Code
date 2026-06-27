export function getSharedToolUseSection(): string {
	return `====

TOOL USE PROTOCOL

You have access to a set of tools that are executed upon the user's approval.

- Tool calls invoke the structured function-calling schema attached to this request; argument values must be plain strings, numbers, booleans, arrays, or objects -- not text formatted to look like markup or code.
- Every response MUST contain at least one tool call -- including confirmations, acknowledgments, and answers to conversational questions. A response with no tool call is a protocol error.`
}
