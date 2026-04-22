# Jarvis Starter Pack Codex Rules

## Read Order
- Read `START_HERE.md`, `MAP.md`, and `POLICY.md` before substantial work.
- For project-specific work, read `TASKS/PROJECTS/<project_id>/BOOT_ENTRY.md` first.

## Protected Paths
- Treat `00_Core/`, `01_Modules/`, `02_Protocols/`, `03_Memory/`, `04_Knowledge/`, and `05_Scripts/` as protected reference material by default.
- Do not modify protected paths without an explicit user request.

## Working Outputs
- Put active project plans, notes, and task artifacts under `TASKS/`.
- Put completed handoff summaries under `CAPSULES/`.
- Put execution logs and diagnostics under `LOGS/`.

## Execution Defaults
- Keep small work in the main session.
- Use sub-agents only when a role split clearly improves quality, speed, or verification.
- Verify before reporting completion.
- Keep changes small, reversible, and easy to review.

## Completion GitHub Flow
- When a project-level task is completed (for example: README/runbook refinement, feature/fix implementation, checklist/log updates), ask once at handoff:
  - `GitHub commit/push/PR까지 진행할까요?`
- If the user approves, continue automatically with a non-interactive flow:
  1. confirm changed file scope
  2. create a focused commit message
  3. commit
  4. push (if remote/branch is configured)
  5. open or prepare PR context when requested
- If the user declines, finish with local changes only and do not re-ask in the same task unless new substantial changes are added.
- Keep this as a default behavioral rule for Jarvis Starter Pack operations unless the user explicitly overrides it.
