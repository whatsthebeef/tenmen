# Tenmen — Setup, Modify & Deploy

## Prerequisites

- Node.js installed
- Google Workspace account with access to a Shared Drive
- Gemini API key from https://aistudio.google.com/apikey

## Initial Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Login to clasp

```bash
cd appscript
npx clasp login
```

This opens a browser to authenticate with your Google account.

### 3. Create the Apps Script project

```bash
./deploy.sh create myapp
```

This creates a new Apps Script project named "Tenmen — myapp" and saves the project config to `appscript/deployments/myapp.clasp.json`.

On first run you'll be prompted for your Google Workspace domain (or leave blank for a personal account). This is saved to `appscript/.deploy-config`.

### 4. Deploy

```bash
./deploy.sh
```

This pushes the code and creates the first web app deployment. The web app URL is saved to `appscript/deployments/webapp-url`.

### 5. Install the Chrome extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" and select the `extension/` directory

### 6. Configure via the extension

1. Open the side panel (click the extension icon)
2. Paste the web app URL (from `./deploy.sh` output) and click Save
3. Click **Settings** to configure:
   - **Gemini API Key** — from https://aistudio.google.com/apikey
   - **Gemini Model** — defaults to `gemini-3-pro-preview`
4. Click **Add Project** to register a project:
   - **Project Name** — name of the code project
   - **Shared Drive ID** — from the Shared Drive URL: `drive.google.com/drive/folders/THIS_ID`

Adding a project automatically creates:
- The **Tenmen Tasks** spreadsheet in the Shared Drive
- `proposals/`, `archive/`, `technical_notes/`, `patches/` folders
- The 1-minute polling trigger

### 7. Prepare your Shared Drive

- Feature documents at the root, named with feature ID prefix: `F1 Feature Name`
- Create a `formulation` folder for meeting summaries (or let the system create it)
- Drop meeting summaries into the `formulation` folder

## Deploying Changes

### Push and deploy

```bash
./deploy.sh
```

This pushes the code and updates the existing deployment (same URL). Config stored in Script Properties is not affected.

### Open the Apps Script editor

```bash
./deploy.sh open
```

### When redeployment is needed

- **Always needed** when changing code used by the web app (WebApp.js, or any function called from doGet/doPost)
- **Not needed** when changes only affect the poll cycle (Code.js trigger logic, Prompts.js, Gemini.js) — these run from the time-based trigger which always uses the latest pushed code

### Re-authorization

If you add new OAuth scopes to `appsscript.json`, you need to re-authorize:

1. Go to https://myaccount.google.com/permissions
2. Find "Tenmen — myapp" and remove access
3. Visit the web app URL — it will prompt for new permissions

## File Structure

```
appscript/
  appsscript.json      — Manifest (scopes, services, web app config)
  Code.js              — Setup, triggers, poll cycle, flow dispatch
  Config.js            — Script Properties config, getters, defaults
  Drive.js             — Shared Drive operations, doc read/write
  Sheets.js            — Spreadsheet CRUD
  Debounce.js          — 10-min debounce for change detection
  Gemini.js            — Gemini API wrapper
  Prompts.js           — AI prompt templates (edit these to tune output)
  Proposals.js         — Google Doc proposal creation
  Approvals.js         — Approval logic, apply approved changes
  PatchApply.js        — Story-level patch application via Docs API
  DocStructure.js      — Document structure extraction
  Archive.js           — Move approved proposals to archive folder
  WebApp.js            — Web app handlers (doGet, doPost, setup form)
  deployments/         — Clasp config and deployment URL

extension/
  manifest.json        — Chrome extension manifest
  background.js        — Service worker, badge, API proxy
  sidepanel.html       — Side panel markup
  sidepanel.js         — Side panel logic
  sidepanel.css        — Side panel styles
  content.js           — Content script for Google Docs
```

### Editing prompts

The AI prompts are in `appscript/Prompts.js`. Edit them to change how Gemini:
- Identifies relevant features from meeting summaries
- Proposes feature document changes
- Proposes task list changes

## Task Sheet API

The web app exposes POST endpoints for the orchestrator agent:

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

## Troubleshooting

### Check execution logs

Apps Script editor > **Executions** (left sidebar) — shows all recent runs with logs and errors.

```bash
./deploy.sh open
```

### "Drive is not defined" error

The `appsscript.json` manifest was overwritten. Restore it and deploy:

```bash
git checkout -- appscript/appsscript.json
./deploy.sh
```

### "Specified permissions are not sufficient" error

A new scope is needed. Add it to `appsscript.json` `oauthScopes` array, deploy, then re-authorize (see above).

### Web app returns "Invalid Request"

The deployment is stale. Run `./deploy.sh` to update it.

### Proposals not generating

1. Check that feature docs are named with feature ID prefix (e.g. `F1 Feature Name`)
2. Check that meeting summaries are in the `formulation` folder
3. Check the execution logs for errors
4. Try "Process Last Meeting Summary" from the extension actions panel
