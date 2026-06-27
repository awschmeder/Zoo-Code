import type OpenAI from "openai"

import accessMcpResource from "../access_mcp_resource"
import attemptCompletion from "../attempt_completion"
import codebaseSearch from "../codebase_search"
import editTool from "../edit"
import editFile from "../edit_file"
import executeCommand from "../execute_command"
import listFiles from "../list_files"
import newTask from "../new_task"
import runSlashCommand from "../run_slash_command"
import searchFiles from "../search_files"
import searchReplace from "../search_replace"
import skill from "../skill"
import switchMode from "../switch_mode"
import updateTodoList from "../update_todo_list"
import writeToFile from "../write_to_file"

type FunctionTool = OpenAI.Chat.ChatCompletionTool & { type: "function" }

const descriptionOf = (tool: OpenAI.Chat.ChatCompletionTool): string =>
	(tool as FunctionTool).function.description ?? ""

/**
 * These tests guard the Pt.2 prompt-engineering changes (defect classes C4/C5/C6).
 * They assert that the removed absolute mandates stay removed and that the added
 * cross-tool selection and failure/recovery guidance remains present. Model tool
 * selection itself is not unit-testable, but description-content invariants are.
 */
describe("native tool description guidance (Pt.2)", () => {
	describe("absolute mandates replaced with decision rules", () => {
		it("codebase_search no longer mandates being used FIRST for any exploration", () => {
			const description = descriptionOf(codebaseSearch)
			expect(description).not.toContain("you MUST use this tool FIRST")
			expect(description).not.toContain("any new area of exploration requires codebase_search first")
			expect(description).toContain("When to use this tool")
		})

		it("write_to_file keeps the no-placeholder rule but drops the NON-NEGOTIABLE absolute", () => {
			const description = descriptionOf(writeToFile)
			expect(description).not.toContain("NON-NEGOTIABLE")
			expect(description).not.toContain("STRICTLY FORBIDDEN")
			// no-placeholder intent retained
			expect(description).toContain("// rest of code unchanged")
			// large-file + output-budget guidance added
			expect(description).toContain("surgical edit tool")
			expect(description).toContain("output budget")
		})

		it("attempt_completion drops the user-confirmation precondition and states the achievable intent", () => {
			const description = descriptionOf(attemptCompletion)
			expect(description).not.toContain("This tool CANNOT be used until you've confirmed from the user")
			expect(description).not.toContain("code corruption and system failure")
			expect(description).toContain("returned to you automatically")
			expect(description).toContain("do not need to ask the user to confirm")
			// allows honest reporting of an unresolved failure
			expect(description).toContain("partial or failed outcome")
		})
	})

	describe("cross-tool selection / ordering guidance", () => {
		it("list_files distinguishes itself from search_files and codebase_search", () => {
			const description = descriptionOf(listFiles)
			expect(description).toContain("When to use this tool")
			expect(description).toContain("search_files")
			expect(description).toContain("codebase_search")
		})

		it("search_files prefers codebase_search for unexplored areas and documents the regex dialect", () => {
			const description = descriptionOf(searchFiles)
			expect(description).toContain("prefer codebase_search first")
			expect(description).toContain("lookarounds")
			expect(description).toContain("backreferences")
			expect(description).toContain("(?i)")
		})

		it("skill surfaces the must-use-skills precondition and contrasts with run_slash_command", () => {
			const description = descriptionOf(skill)
			expect(description).toContain("required precondition")
			expect(description).toContain("run_slash_command")
		})

		it("run_slash_command contrasts with skill and documents skill fallback", () => {
			const description = descriptionOf(runSlashCommand)
			expect(description).toContain("skill")
			expect(description).toContain("falls back to resolving a skill")
		})

		it("switch_mode contrasts with new_task and names FileRestrictionError as a trigger", () => {
			const description = descriptionOf(switchMode)
			expect(description).toContain("new_task")
			expect(description).toContain("FileRestrictionError")
			expect(description).toContain("in place")
		})

		it("new_task notes its context isolation (switch_mode contrast lives in switch_mode)", () => {
			const description = descriptionOf(newTask)
			expect(description).toContain("fresh context")
			expect(description).toContain("returns only its result")
		})

		it("access_mcp_resource distinguishes reading a resource from invoking a server tool", () => {
			const description = descriptionOf(accessMcpResource)
			expect(description).toContain("When to use this vs an MCP server tool")
			expect(description).toContain("URI")
		})
	})

	describe("failure modes and recovery", () => {
		it("codebase_search documents silent empty results and the fallback path", () => {
			const description = descriptionOf(codebaseSearch)
			expect(description).toContain("Failure modes and recovery")
			expect(description).toContain("do NOT re-run the same query")
			expect(description).toContain("search_files")
			expect(description).toContain("read_file")
		})

		it("execute_command cross-references read_command_output for truncated/background output", () => {
			const description = descriptionOf(executeCommand)
			expect(description).toContain("read_command_output")
			expect(description).toContain("artifact")
			expect(description).toContain("do not re-run the command")
		})

		it("update_todo_list links full-overwrite semantics to keeping unfinished tasks", () => {
			const description = descriptionOf(updateTodoList)
			expect(description).toContain("full overwrite")
			expect(description).toContain("carry forward")
			expect(description).toContain("in-progress")
		})

		it("search_replace states zero-match and multi-match outcomes", () => {
			const description = descriptionOf(searchReplace)
			expect(description).toContain("Zero matches")
			expect(description).toContain("Multiple matches")
		})

		it("edit states the zero-match outcome alongside the uniqueness failure", () => {
			const description = descriptionOf(editTool)
			expect(description).toContain("not found at all")
		})

		it("edit_file states zero-match and count-mismatch outcomes", () => {
			const description = descriptionOf(editFile)
			expect(description).toContain("Zero matches")
			expect(description).toContain("Count mismatch")
		})
	})
})
