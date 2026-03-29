# Developer Agent System

This repository uses a multi-agent workflow orchestrated by Claude Code. A single orchestrator agent picks tasks from a Google Sheet and coordinates planning, development, testing, and review through specialized sub-agents.

## Workflow Overview

1. **Orchestrator** (`/run-task`) picks a `Ready` task from the Google Sheet
2. **Planner** agent analyzes the task and produces an implementation plan
3. **Developer** agent implements the plan and commits
4. **Tester** agent runs the full test suite, maps coverage to acceptance criteria, writes missing tests
5. **Reviewer** agent reviews the code, classifies feedback as `in-scope` or `suggestion`
6. Developer fixes `in-scope` items, tester re-validates (max 3 review cycles)
7. Reviewer generates a final adjustments document in `.reviews/`
8. Orchestrator creates a PR targeting `master`
9. Sheet is updated with `Finished` status and PR URL

## Google Sheet Structure

| Task ID | Description | Acceptance Criteria | Notes | Status |
|---------|-------------|---------------------|-------|--------|

Relevant statuses for this agent: `Ready`, `Working`, `Finished`, `Error`

## Conventions

- Feature branches: `task/<id>-<slug>` (slug derived from description)
- Review documents: `.reviews/task-<id>.md`
- PR target: `master`
- Max review cycles: 3
- Tester agent validates all tests pass before review handoff
- Test reports: `.reviews/task-<id>-tests.md`
- Commits should be atomic and well-described

## Project Structure

```
.claude/
├── settings.json          # MCP servers, permissions
├── agents/
│   ├── orchestrator.md    # Main agent — picks task, coordinates
│   ├── planner.md         # Analyzes task, builds implementation plan
│   ├── developer.md       # Implements the plan, fixes review items
│   ├── tester.md          # Runs tests, writes missing tests, produces test report
│   └── reviewer.md        # Reviews code, classifies feedback
├── skills/
│   └── run-task.md        # Entry point: /run-task
.reviews/                  # Review adjustment documents
```
