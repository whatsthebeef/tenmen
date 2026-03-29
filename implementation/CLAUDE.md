# Developer Agent System

This repository uses a multi-agent workflow orchestrated by Claude Code. The orchestrator runs one phase at a time, pausing between phases so the user can review and edit the output before continuing.

## Workflow Overview

The orchestrator runs all phases end-to-end. Each phase writes an output file to `.reviews/` so the user can review the result and restart from any phase if needed.

1. **Phase 1** — Pick task, create branch → `.reviews/task-<id>-context.md`
2. **Phase 2** — Investigate, produce plan → `.reviews/task-<id>-plan.md`
3. **Phase 3** — Implement the plan → `.reviews/task-<id>-implementation.md`
4. **Phase 4** — Write and run tests → `.reviews/task-<id>-tests.md`
5. **Phase 5** — Review code changes → `.reviews/task-<id>.md`
6. **Phase 6** — Create PR, update sheet

### Running

```
/run-task <sheet-id>                          # Full run from phase 1
/run-task <sheet-id> --from 3 --task F1S1T1   # Restart from phase 3 (e.g., after editing the plan)
```

## Google Sheet Structure

| Task ID | Description | Acceptance Criteria | Notes | Dev Notes | Status |
|---------|-------------|---------------------|-------|-----------|--------|

- **Dev Notes**: Written by the developer before setting the task to `Ready`. Passed to the investigator and implementer for additional context.
- Relevant statuses: `Ready`, `Working`, `Finished`, `Error`

## Conventions

- Feature branches: `task/<id>-<slug>` (slug derived from description)
- Phase output files: `.reviews/task-<id>-*.md`
- PR target: `master`
- Max review cycles: 3
- Commits should be atomic and well-described

## Project Structure

```
.claude/
├── settings.json          # MCP servers, permissions
├── agents/
│   ├── orchestrator.md    # Main agent — runs one phase at a time
│   ├── investigator.md    # Analyzes task, builds implementation plan
│   ├── implementer.md     # Implements the plan, fixes review items
│   ├── unit_test_writer.md # Runs tests, writes missing tests, produces test report
│   └── change_reviewer.md # Reviews code, classifies feedback
├── skills/
│   └── run-task.md        # Entry point: /run-task
.reviews/                  # Phase output and review documents
```
