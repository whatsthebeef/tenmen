# Tenmen — Setup, Modify & Deploy

## Prerequisites

- Node.js installed
- Google Workspace account with access to a Shared Drive
- Gemini API key from https://aistudio.google.com/apikey

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

### 3. Create the standalone script project

```bash
cd planning
npx @google/clasp create --type standalone --title "Tenmen"
```

**Important:** This overwrites `appsscript.json` with defaults. After running, restore the correct manifest:

```bash
git checkout -- appsscript.json
npx @google/clasp push --force
```

### 4. Set the Gemini API key

Edit `planning/Config.js` and set `CONFIG.GEMINI_API_KEY` to your key:

```js
GEMINI_API_KEY: 'your-key-here',
```

Then push:

```bash
npx @google/clasp push --force
```

### 5. Run setup in the Apps Script editor

```bash
npx @google/clasp open
```

This opens the Apps Script editor in your browser.

1. Select `setup` from the function dropdown and click **Run**
2. Accept the permissions prompt (you may need to click Advanced > Go to Tenmen)
3. Check the execution log — it lists your Shared Drives with IDs
4. Select `selectDrive` from the dropdown — but since it needs a parameter, add this temporarily at the end of `setup()` in the editor:

```js
selectDrive('YOUR_SHARED_DRIVE_ID');
```

5. Run `setup` again. It will:
   - Create the **Tenmen Tasks** spreadsheet in the Shared Drive
   - Create `proposals/`, `archive/` folders
   - Initialize spreadsheet tabs (Tasks, Proposals, Approvals, Config)
   - Install the 1-minute polling trigger

6. Remove the `selectDrive(...)` line after running.

### 6. Deploy as web app

In the Apps Script editor:

1. Click **Deploy > New deployment**
2. Select type: **Web app**
3. Execute as: **User accessing the web app**
4. Who has access: **Anyone within [your organization]**
5. Click **Deploy**
6. Copy the web app URL

Then in the Apps Script editor, run:

```js
setWebAppUrl('YOUR_WEB_APP_URL')
```

This saves the URL and creates an **Actions** tab in the spreadsheet with trigger links.

### 7. Configure approvers

Open the **Tenmen Tasks** spreadsheet > **Config** tab. Add a row:

| key | value |
|-----|-------|
| approvers | alice@example.com,bob@example.com |

### 8. Prepare your Shared Drive

- User story documents at the root, named with epic ID prefix: `0001 Feature Name`
- Create a `transcripts` folder for meeting summaries
- Drop Gemini meeting summaries into the `transcripts` folder

## Modifying Code

### File structure

```
planning/
  appsscript.json      — Manifest (scopes, services, web app config)
  Code.js              — Setup, triggers, poll cycle, flow dispatch
  Config.js            — Constants, script properties helpers
  Drive.js             — Shared Drive operations, doc read/write
  Sheets.js            — Spreadsheet CRUD, approvals, config
  Debounce.js          — 10-min debounce for change detection
  Gemini.js            — Gemini API wrapper
  Prompts.js           — AI prompt templates (edit these to tune output)
  Proposals.js         — Google Doc proposal creation with rich text
  Approvals.js         — Approval logic, apply approved changes
  Email.js             — Email notifications
  Archive.js           — Move approved proposals to archive folder
  WebApp.js            — Web app doGet handler for approve/resubmit
  Confirmation.html    — Web app confirmation page template
```

### Editing prompts

The AI prompts are in `planning/Prompts.js`. Edit them to change how Gemini:
- Identifies relevant epics from meeting summaries
- Proposes user story document changes
- Proposes task list changes

### Editing the Gemini model

In `planning/Config.js`, change `CONFIG.GEMINI_MODEL`:

```js
GEMINI_MODEL: 'gemini-2.5-flash',  // or 'gemini-2.5-pro', etc.
```

### Changing the debounce time

In `planning/Config.js`:

```js
DEBOUNCE_MINUTES: 10,  // change to desired minutes
```

## Deploying Changes

### Push code changes

```bash
cd planning
npx @google/clasp push --force
```

This updates the script but **does not** update the live web app deployment.

### Update the web app deployment

To update the existing deployment (keeps the same URL):

```bash
npx @google/clasp deploy -i YOUR_DEPLOYMENT_ID -d "Description of changes"
```

Find your deployment ID with:

```bash
npx @google/clasp deployments
```

### Push and deploy in one command

```bash
cd planning
npx @google/clasp push --force && npx @google/clasp deploy -i YOUR_DEPLOYMENT_ID -d "Description"
```

### When redeployment is needed

- **Always needed** when changing code used by the web app (WebApp.js, Approvals.js, Confirmation.html, or any function called from doGet)
- **Not needed** when changes only affect the poll cycle (Code.js trigger logic, Prompts.js, Gemini.js) — these run from the time-based trigger which always uses the latest pushed code

### Re-authorization

If you add new OAuth scopes to `appsscript.json`, users need to re-authorize:

1. Go to https://myaccount.google.com/permissions
2. Find "Tenmen" and remove access
3. Open the Apps Script editor, run any function — it will prompt for new permissions

## Manual Actions

### Process last meeting summary

From the spreadsheet: **Actions** tab > click **Run** next to "Process Last Meeting Summary"

Or from the Apps Script editor: select `processLastSummary` and click Run.

### Process last user story change

From the spreadsheet: **Actions** tab > click **Run** next to "Process Last User Story Change"

### Stop the polling trigger

From the Apps Script editor: select `uninstallTrigger` and click Run.

### Restart the polling trigger

From the Apps Script editor: select `installTrigger` and click Run.

## Troubleshooting

### Check execution logs

Apps Script editor > **Executions** (left sidebar) — shows all recent runs with logs and errors.

### "Drive is not defined" error

The `appsscript.json` manifest was overwritten. Restore it and push:

```bash
git checkout -- planning/appsscript.json
npx @google/clasp push --force
```

### "Specified permissions are not sufficient" error

A new scope is needed. Add it to `appsscript.json` `oauthScopes` array, push, then re-authorize (see above).

### Web app returns "Invalid Request"

The deployment is stale. Redeploy with `npx @google/clasp deploy -i DEPLOYMENT_ID`.

### Proposals not generating

1. Check that epic docs are named with numeric prefix (e.g. `0001 Feature Name`)
2. Check that meeting summaries are in the `transcripts` folder
3. Check the execution logs for errors
4. Try running `processLastSummary` manually from the editor
