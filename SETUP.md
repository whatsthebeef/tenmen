# Tenmen — Setup, Modify & Deploy

## Prerequisites

- Node.js installed
- Google Workspace account with access to a Shared Drive
- Gemini API key from https://aistudio.google.com/apikey

## Concepts

Each Tenmen **app** is a separate Apps Script project with its own deployment, configuration, Shared Drive, and task spreadsheet. You can run multiple apps from the same codebase (e.g. one per team or project). App configs are stored in `planning/deployments/<name>.clasp.json`.

## Initial Setup

### 1. Install clasp

```bash
npm install -g @google/clasp
```

### 2. Login to clasp

```bash
cd planning
npx @google/clasp login
```

This opens a browser to authenticate with your Google account.

### 3. Create an app

```bash
./deploy.sh myapp --create
```

This creates a new Apps Script project named "Tenmen — myapp" and saves the project config to `planning/deployments/myapp.clasp.json`.

On first run you'll be prompted for your Google Workspace domain (or leave blank for a personal account). This is saved to `planning/.deploy-config` and reused for all apps.

### 4. Deploy

```bash
./deploy.sh myapp
```

This pushes the code and creates the first web app deployment. The web app URL opens automatically in your browser.

### 5. Configure via the web app

On first visit you'll be prompted to authorize the script (you may need to click Advanced > Go to Tenmen). After authorizing, the setup form appears.

Fill in:
- **Gemini API Key** — from https://aistudio.google.com/apikey
- **Gemini Model** — defaults to `gemini-3-pro-preview`, change if needed
- **Shared Drive ID** — from the Shared Drive URL: `drive.google.com/drive/folders/THIS_ID`
- **Approver Emails** — comma-separated list

Click **Save & Initialize**. This automatically:
- Stores all config in Script Properties (persists across deploys)
- Creates the **Tenmen Tasks** spreadsheet in the Shared Drive
- Creates `proposals/`, `archive/`, `technical_notes/` folders
- Initializes spreadsheet tabs (Tasks, Proposals, Approvals, Actions)
- Installs the 1-minute polling trigger
- Saves the web app URL

No need to open the Apps Script editor.

### 6. Prepare your Shared Drive

- Feature documents at the root, named with feature ID prefix: `F1 Feature Name`
- Create a `transcripts` folder for meeting summaries (or let the system create it)
- Drop Gemini meeting summaries into the `transcripts` folder

### 7. Reconfigure (optional)

Visit the web app URL with `?action=setup`, or click "Reconfigure settings" on the landing page.

## Managing Multiple Apps

### Create a second app

```bash
./deploy.sh otherapp --create
./deploy.sh otherapp
```

Then configure it via the web app — each app has its own Shared Drive, approvers, etc.

### List available apps

```bash
./deploy.sh
```

Running without arguments lists all configured apps.

### Deploy a specific app

```bash
./deploy.sh myapp
```

### Deploy and merge config into a project repo

```bash
./deploy.sh myapp --merge /path/to/repo
```

This deploys the app, then merges the Claude Code agent config into the target repo and writes the web app URL to the repo's `.claude/memory/` so the orchestrator can find it.

### Open the Apps Script editor

```bash
./deploy.sh myapp --open
```

## Deploying Changes

### Push and deploy

```bash
./deploy.sh myapp
```

This pushes the code to the app's Apps Script project and updates its deployment. Config stored in Script Properties is not affected.

Subsequent deploys update the existing deployment in place (same URL).

### When redeployment is needed

- **Always needed** when changing code used by the web app (WebApp.js, Approvals.js, Confirmation.html, or any function called from doGet/doPost)
- **Not needed** when changes only affect the poll cycle (Code.js trigger logic, Prompts.js, Gemini.js) — these run from the time-based trigger which always uses the latest pushed code

### Re-authorization

If you add new OAuth scopes to `appsscript.json`, you need to re-authorize:

1. Go to https://myaccount.google.com/permissions
2. Find "Tenmen — myapp" and remove access
3. Visit the web app URL — it will prompt for new permissions

## Modifying Code

### File structure

```
planning/
  appsscript.json      — Manifest (scopes, services, web app config)
  Code.js              — Setup, triggers, poll cycle, flow dispatch
  Config.js            — Script Properties config, getters, defaults
  Drive.js             — Shared Drive operations, doc read/write
  Sheets.js            — Spreadsheet CRUD, approvals, config
  Debounce.js          — 10-min debounce for change detection
  Gemini.js            — Gemini API wrapper
  Prompts.js           — AI prompt templates (edit these to tune output)
  Proposals.js         — Google Doc proposal creation with rich text
  Approvals.js         — Approval logic, apply approved changes
  Email.js             — Email notifications
  Archive.js           — Move approved proposals to archive folder
  WebApp.js            — Web app handlers (doGet, doPost, setup form)
  Confirmation.html    — Web app confirmation page template
  deployments/         — Per-app clasp configs (one .clasp.json per app)
```

### Editing prompts

The AI prompts are in `planning/Prompts.js`. Edit them to change how Gemini:
- Identifies relevant features from meeting summaries
- Proposes feature document changes
- Proposes task list changes

### Changing the Gemini model

Visit `?action=setup` on the web app and change the model field, or update it directly in Script Properties via the Apps Script editor.

### Changing the debounce time

The default is 10 minutes. To change it, set `CONFIG_DEBOUNCE_MINUTES` in Script Properties via the Apps Script editor (Project Settings > Script Properties).

## Task Sheet API

The web app exposes two POST endpoints for the orchestrator agent:

**Claim next task** — picks the oldest Ready task (FIFO) and sets it to Working:
```
POST <web-app-url>
{"action": "claim_next"}
```

**Finish task** — sets a task to Finished:
```
POST <web-app-url>
{"action": "finish_task", "taskId": "F1S1T1"}
```

## Manual Actions

### Process last meeting summary

From the spreadsheet: **Actions** tab > click **Run** next to "Process Last Meeting Summary"

### Process last feature document change

From the spreadsheet: **Actions** tab > click **Run** next to "Process Last Feature Document Change"

### Stop the polling trigger

From the Apps Script editor (`./deploy.sh myapp --open`): select `uninstallTrigger` and click Run.

### Restart the polling trigger

From the Apps Script editor: select `installTrigger` and click Run.

## Troubleshooting

### Check execution logs

Apps Script editor > **Executions** (left sidebar) — shows all recent runs with logs and errors.

```bash
./deploy.sh myapp --open
```

### "Drive is not defined" error

The `appsscript.json` manifest was overwritten. Restore it and deploy:

```bash
git checkout -- planning/appsscript.json
./deploy.sh myapp
```

### "Specified permissions are not sufficient" error

A new scope is needed. Add it to `appsscript.json` `oauthScopes` array, deploy, then re-authorize (see above).

### Web app returns "Invalid Request"

The deployment is stale. Run `./deploy.sh myapp` to update it.

### Web app shows setup form unexpectedly

Config was lost from Script Properties. Fill in the form again — it will restore everything.

### Proposals not generating

1. Check that feature docs are named with feature ID prefix (e.g. `F1 Feature Name`)
2. Check that meeting summaries are in the `transcripts` folder
3. Check the execution logs for errors
4. Try clicking **Run** on the Actions tab in the spreadsheet
