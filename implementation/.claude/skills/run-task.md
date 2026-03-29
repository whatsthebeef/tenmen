---
name: run-task
description: Pick up the next Ready task from the Google Sheet and run it through the full agent workflow (plan → develop → review → PR).
user_invocable: true
---

# Run Task

Pick up and execute the next available task from the project's Google Sheet.

## Usage

```
/run-task <sheet-id>
/run-task <sheet-url>
```

If no sheet ID is provided, check if one is saved in memory.

## Instructions

You are invoking the orchestrator workflow. Follow these steps:

1. **Resolve the Sheet ID**
   - If the user provided a sheet ID or URL, extract the sheet ID.
   - If no ID was provided, check `.claude/memory/` for a saved sheet reference.
   - If still no ID, ask the user for the Google Sheet ID or URL.

2. **Invoke the Orchestrator Agent**
   Launch the `orchestrator` agent with the sheet ID. The orchestrator will handle the full workflow:
   - Pick a `Ready` task
   - Set status to `Working`
   - Run planner → developer → reviewer cycle
   - Create PR
   - Set status to `Finished`

3. **Report Results**
   When the orchestrator completes, report:
   - Task ID and description
   - PR URL (if created)
   - Final status
   - Any errors or issues encountered

## Error Recovery

If the orchestrator fails mid-workflow:
- The sheet status should be set to `Error` (the orchestrator handles this)
- Report the failure phase and error to the user
- Suggest next steps (e.g., "Run `/run-task <sheet-id>` again after fixing the issue")
