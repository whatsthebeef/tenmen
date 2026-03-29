---
name: Workflow Configuration
description: Core configuration for the multi-agent task workflow — sheet reference, branch strategy, review limits.
type: project
---

## Multi-Agent Workflow

- **PR target branch**: `master`
- **Feature branch format**: `task/<id>-<slug>`
- **Max review cycles**: 3
- **Review documents**: `.reviews/task-<id>.md`
- **Google Sheet ID**: <!-- TODO: Save the sheet ID here after first run -->

**Why:** This is the agreed workflow for automated task pickup, planning, development, and review. The 3-round review cap prevents infinite loops while still allowing meaningful iteration.

**How to apply:** The orchestrator agent reads these settings. When the user provides a sheet ID via `/run-task`, update the Google Sheet ID above so future runs don't need it repeated.
