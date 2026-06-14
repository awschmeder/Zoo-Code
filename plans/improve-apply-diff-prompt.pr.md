### Related GitHub Issue

Closes: #611

### Description

This PR enhances the documentation and instructions for the `apply_diff` tool to improve its success rate, particularly for Gemini models. It addresses issues with malformed `:start_line:` syntax and imprecise diff matching by enforcing stricter, clearer requirements in the tool's system instructions and adding a corresponding guideline to `AGENTS.md`.

### Test Procedure

- Verify existing `apply_diff` behavior with `apps/vscode-e2e/src/suite/tools/apply-diff.test.ts`.
- Documentation updates applied in `src/core/prompts/tools/native-tools/apply_diff.ts` and `AGENTS.md`.

### Pre-Submission Checklist

- [x] **Issue Linked**: This PR is linked to an approved GitHub Issue.
- [x] **Scope**: My changes are focused on the linked issue (one major feature/fix per PR).
- [x] **Self-Review**: I have performed a thorough self-review of my code.
- [x] **Testing**: Existing tests cover the functionality; no new functionality requiring tests was added.
- [x] **Documentation Impact**: I have considered if my changes require documentation updates.
- [x] **Contribution Guidelines**: I have read and agree to the [Contributor Guidelines](/CONTRIBUTING.md).

### Documentation Updates

- [x] Yes, documentation updates are required. (This PR updates `apply_diff` tool instructions and `AGENTS.md`).

### Additional Notes

None.

### Get in Touch

Zoo AI Assistant
