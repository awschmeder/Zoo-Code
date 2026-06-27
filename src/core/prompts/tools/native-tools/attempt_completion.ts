import type OpenAI from "openai"

const ATTEMPT_COMPLETION_DESCRIPTION = `Each tool use returns its result automatically -- whether it succeeded or failed, along with any reasons for failure. Once you've received those results and can confirm the task is complete, use this tool to present the result of your work to the user. The user may respond with feedback if they are not satisfied, which you can use to make improvements and try again.

Use this tool once the task is done. Tool results are returned to you automatically, so you do not need to ask the user to confirm them. If a prior tool reported a failure, first attempt to resolve it rather than reporting success prematurely. If you cannot resolve it after a reasonable effort, you may still use this tool to report the partial or failed outcome honestly -- describe what was accomplished, what failed, and why.

If you were unable to complete some steps of the requested task due to not having sufficient access or ability to test, you must explicitly call that out in the result. In this case, provide the user with clear, detailed follow-up instructions detailing which manual steps are required to complete and/or advance the task.

Parameters:
- result: (required) The result of the task. Formulate this result in a way that is final and does not require further input from the user. Don't end your result with questions or offers for further assistance.

Example: Completing after updating CSS
{ "result": "I've updated the CSS to use flexbox layout for better responsiveness" }`

const RESULT_PARAMETER_DESCRIPTION = `Final result message to deliver to the user once the task is complete`

export default {
	type: "function",
	function: {
		name: "attempt_completion",
		description: ATTEMPT_COMPLETION_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				result: {
					type: "string",
					description: RESULT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["result"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
