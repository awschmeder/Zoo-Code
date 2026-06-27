import type OpenAI from "openai"

const SKILL_DESCRIPTION = `Load and execute a skill by name. Skills provide specialized instructions for common tasks like creating MCP servers or custom modes.

Use this tool when you need to follow specific procedures documented in a skill. Available skills are listed in the AVAILABLE SKILLS section of the system prompt.

Skill applicability is a required precondition, not an opt-in: before responding, evaluate the request against every available skill description and, if exactly one clearly applies, load it with this tool before continuing -- do not wait to be told to use a skill. Prefer the most specific skill when several match, and do not reload a skill whose instructions are already in the conversation.

When to use this vs run_slash_command: skill is the primary tool to load a named skill directly. Use run_slash_command to run a named slash command; if no slash command matches the name, it falls back to resolving a skill of the same name. When you specifically intend to load a skill, prefer this tool.`

const SKILL_PARAMETER_DESCRIPTION = `Name of the skill to load (e.g., create-mcp-server, create-mode). Must match a skill name from the available skills list.`

const ARGS_PARAMETER_DESCRIPTION = `Optional context or arguments to pass to the skill`

export default {
	type: "function",
	function: {
		name: "skill",
		description: SKILL_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				skill: {
					type: "string",
					description: SKILL_PARAMETER_DESCRIPTION,
				},
				args: {
					type: ["string", "null"],
					description: ARGS_PARAMETER_DESCRIPTION,
				},
			},
			required: ["skill", "args"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
