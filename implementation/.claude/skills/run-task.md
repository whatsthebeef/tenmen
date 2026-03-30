---
name: run-task
description: Pick up the next Ready task and run the full agent workflow (investigate → implement → test → review → PR), or restart from a specific phase.
user_invocable: true
---

# Run Task

Pick up and execute the next available task, or resume a task from a specific phase.

## Usage

```
/run-task
/run-task --from <phase> --task <task-id>
```

- `--from <phase>` — Resume from phase 1–6. Default is 1 (pick a new task).
- `--task <task-id>` — Required when resuming (phases 2–6). The task ID to continue.

### Examples

```
/run-task                                 # Start a new task from phase 1
/run-task --from 3 --task F1S1T1          # Resume task F1S1T1 from implementation
```

## Instructions

You are invoking the orchestrator workflow. Follow these steps:

1. **Resolve the web app URL**
   - Check `.claude/memory/` for a saved `task_api_url`.
   - If not found, ask the user for the web app URL and save it to memory.

2. **Parse arguments**
   - Extract `--from` phase number (default: 1).
   - Extract `--task` task ID (required if `--from` > 1).
   - If resuming without `--task`, ask for the task ID.

3. **Invoke the Orchestrator Agent**
   Launch the `orchestrator` agent with:
   - Web app URL
   - Starting phase number
   - Task ID (if resuming)

   The orchestrator runs all phases from start to finish, writing output files along the way. It only stops early for serious blockers.

4. **Report Results**
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
/run-task --from <phase> --task <task-id>
```
