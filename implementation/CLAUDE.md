# Developer Agent System

This repository uses a multi-agent workflow orchestrated by Claude Code. The orchestrator runs all phases end-to-end, interacting with the task sheet via a web app API. Each phase writes an output file to `.reviews/` so the user can review the result and restart from any phase if needed.

## Workflow Overview

1. **Phase 1** — Pick task, create branch → `.reviews/task-<id>-context.md`
2. **Phase 2** — Investigate, produce plan → `.reviews/task-<id>-plan.md`
3. **Phase 3** — Implement the plan → `.reviews/task-<id>-implementation.md`
4. **Phase 4** — Write and run tests → `.reviews/task-<id>-tests.md`
5. **Phase 5** — Review code changes → `.reviews/task-<id>.md`
6. **Phase 6** — Create PR, update sheet

### Running

```
/run-task                                     # Full run from phase 1
/run-task --from 3 --task F1S1T1              # Restart from phase 3 (e.g., after editing the plan)
```

The web app URL is stored in `.claude/memory/` per project. You'll be prompted to set it on first run.

## Task Sheet Structure

| id | name | description | acceptance_criteria | notes | dev_notes | status | date_created |
|----|------|-------------|---------------------|-------|-----------|--------|--------------|

- **dev_notes**: Written by the developer before setting the task to `Ready`. Passed to the investigator and implementer for additional context.
- **date_created**: ISO datetime. Tasks are claimed FIFO (oldest first).
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
├── settings.json          # Permissions, sandbox config
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
