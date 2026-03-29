---
name: run-task
description: Pick up the next Ready task from the Google Sheet and run one phase of the agent workflow, pausing for review between phases.
user_invocable: true
---

# Run Task

Pick up and execute the next available task from the project's Google Sheet, or resume a task from a specific phase.

## Usage

```
/run-task <sheet-id>
/run-task <sheet-id> --from <phase> --task <task-id>
```

- `<sheet-id>` — Google Sheet ID or URL. If omitted, check `.claude/memory/` for a saved reference.
- `--from <phase>` — Resume from phase 1–6. Default is 1 (pick a new task).
- `--task <task-id>` — Required when resuming (phases 2–6). The task ID to continue.

### Examples

```
/run-task abc123                          # Start a new task from phase 1
/run-task abc123 --from 3 --task F1S1T1   # Resume task F1S1T1 from implementation
```

## Instructions

You are invoking the orchestrator workflow. Follow these steps:

1. **Parse arguments**
   - Extract the sheet ID (from argument or memory).
   - Extract `--from` phase number (default: 1).
   - Extract `--task` task ID (required if `--from` > 1).
   - If resuming without `--task`, ask for the task ID.

2. **Invoke the Orchestrator Agent**
   Launch the `orchestrator` agent with:
   - Sheet ID
   - Starting phase number
   - Task ID (if resuming)

   The orchestrator runs all phases from start to finish, writing output files along the way. It only stops early for serious blockers.

3. **Report Results**
   When the orchestrator completes, report:
   - Task ID and description
   - PR URL (if created)
   - Final status
   - Any errors or issues encountered
   - Remind the user they can restart from any phase if the result isn't satisfactory

## Phase Output Files

Each phase writes an output file to `.reviews/`. If the end result isn't satisfactory, the user can edit any output file and restart from that phase.

| Phase | What happens | Output file |
|-------|-------------|-------------|
| 1 | Pick task, create branch | `.reviews/task-<id>-context.md` |
| 2 | Investigate, produce plan | `.reviews/task-<id>-plan.md` |
| 3 | Implement the plan | `.reviews/task-<id>-implementation.md` |
| 4 | Write and run tests | `.reviews/task-<id>-tests.md` |
| 5 | Review code changes | `.reviews/task-<id>.md` |
| 6 | Create PR, update sheet | — |

### Restarting from a phase

To redo from a specific phase, edit the output file from the previous phase (e.g., edit the plan before re-running implementation), then:

```
/run-task <sheet-id> --from <phase> --task <task-id>
```
