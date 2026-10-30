<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Design System

Before writing or modifying any UI code, read `DESIGN.md` in the project root.
Treat it as the visual source of truth for all frontend work.
Use its color tokens, typography scale, spacing rules, component styles, and do/don’t guidance exactly as specified.
Do not invent colors, fonts, or spacing values outside of `DESIGN.md`.

# UI Components

Use existing components from `@ibase/ui` first when building UI. If a needed component is not available, add the corresponding shadcn/ui component to `packages/ui` and use it from there before building a custom component. Follow `DESIGN.md` when adapting shadcn/ui styles.

<!-- GENERAL CODING GUIDELINES START -->

# Jo's Thought Imprint

1. Fail fast with explicit errors: do not add fallback logic unless explicitly requested.
2. Let exceptions and errors bubble up as early as possible: do not handle errors inside the business layer.
3. Use effective tests: first prove that the bug or issue exists by making the test fail. Do not only write tests that pass, since they prove nothing.
4. Document externally exposed types, interfaces, functions, and classes, and add functional comments to key logic branches.
5. Reuse utility functions from `utils` whenever possible. If a general-purpose function does not exist but can be extracted and reused, add it to `utils` and reuse it there.
6. When writing unit tests, strictly mirror the source structure in `tests` directory. Each unit test file must test only the functionality of its corresponding source file.
7. Do not add unit tests that match stylesheets or source files with regular expressions; styles should be verified through component behavior and the toolchain.
8. Always use source types from the owning library or module. Do not create local duplicate types, and do not assert values as locally substituted types just to work around TypeScript issues.
9. Avoid abstraction layers that do not simplify the code or maintain a real boundary. Prefer calling the owning module or service directly instead of passing values through broad wrapper objects layer by layer.
10. Do not add explicit return types to functions unless TypeScript cannot infer them correctly or an explicit annotation is required to preserve a public contract.
11. Do not extract one-off helper functions unless they maintain a real boundary, hide meaningful complexity, or are expected to be reused. Prefer inlining simple one-use logic.
12. Do not revert files that are already staged in Git.
13. Keep source files under 500 lines where practical; split them as needed to keep files short and focused. This limit does not apply to unit test files.
14. Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.

<!-- GENERAL CODING GUIDELINES END -->
