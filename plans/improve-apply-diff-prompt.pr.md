### Related GitHub Issue

Closes: #611

### Description

This PR enhances the documentation and instructions for the `apply_diff` tool to improve its success rate, particularly for Gemini models. It addresses issues with malformed `:start_line:` syntax and imprecise diff matching by enforcing stricter, clearer requirements in the tool's system instructions.

Note: While the issue notes that adding these guidelines to `AGENTS.md` resolved the issue locally, we have integrated them directly into the core prompts (`src/core/prompts/tools/native-tools/apply_diff.ts`) and have purposely omitted modifying `AGENTS.md` to adhere to repository PR hygiene guidelines.

### Test Procedure

- Verify existing `apply_diff` behavior with `apps/vscode-e2e/src/suite/tools/apply-diff.test.ts`.
- Prompt instructions updated in `src/core/prompts/tools/native-tools/apply_diff.ts`.

### Pre-Submission Checklist

- [x] **Issue Linked**: This PR is linked to an approved GitHub Issue.
- [x] **Scope**: My changes are focused on the linked issue (one major feature/fix per PR).
- [x] **Self-Review**: I have performed a thorough self-review of my code.
- [x] **Testing**: Existing tests cover the functionality; no new functionality requiring tests was added.
- [x] **Documentation Impact**: I have considered if my changes require documentation updates.
- [x] **Contribution Guidelines**: I have read and agree to the [Contributor Guidelines](/CONTRIBUTING.md).

### Documentation Updates

- [ ] No documentation updates are required. (Updates are purely internal prompt instruction refinements).

### Additional Notes

None.

### Get in Touch

Zoo AI Assistant
