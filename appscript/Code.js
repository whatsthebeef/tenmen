// ============================================================
// Tenmen — Entry points, setup, and orchestration
// ============================================================

const EPIC_PATTERN = /EPIC:\s*(\d+)/i;

// ============================================================
// Menu and sidebar
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tenmen')
    .addItem('Review Current Proposal', 'showSidebar')
    .addSeparator()
    .addItem('Setup', 'setup')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Tenmen');
  SpreadsheetApp.getUi().showSidebar(html);
}

// ============================================================
// Setup
// ============================================================

function setup() {
  const drives = listSharedDrives();
  if (!drives.length) {
    Logger.log('No Shared Drives found. Make sure your account has access to at least one.');
    return;
  }

  Logger.log('=== Available Shared Drives ===');
  drives.forEach((d, i) => Logger.log(`  ${i + 1}. ${d.name} (${d.id})`));
  Logger.log('');
  Logger.log('Copy the ID of the Shared Drive you want to monitor,');
  Logger.log('then run selectDrive("DRIVE_ID_HERE") from the editor.');
}

function selectDrive(driveId) {
  if (!driveId) {
    Logger.log('Usage: selectDrive("YOUR_SHARED_DRIVE_ID")');
    return;
  }

  if (!CONFIG.GEMINI_API_KEY) {
    Logger.log('ERROR: Set CONFIG.GEMINI_API_KEY in Config.js before running setup.');
    return;
  }

  setProp('SHARED_DRIVE_ID', driveId);
  Logger.log('Shared Drive ID saved: ' + driveId);

  Logger.log('Initializing sheet structure...');
  initializeSheet();
  Logger.log('Tabs created: Tasks, Approvals, Config');

  // Set initial last run time
  setLastRunTime(new Date());

  // Install trigger
  installTrigger();

  Logger.log('');
  Logger.log('Setup complete!');
  Logger.log('Next steps:');
  Logger.log('  1. Add approvers in Config tab: key="approvers", value="email1@co.com,email2@co.com"');
  Logger.log('  2. Add epic-doc mappings in Config tab: key="epic_map_0001", value="<google doc file ID>"');
  Logger.log('  3. Tenmen will check for changes every minute.');
}

// ============================================================
// Trigger management
// ============================================================

function installTrigger() {
  // Remove existing triggers
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'pollCycle') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('pollCycle')
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log('Trigger installed: pollCycle every 1 minute');
}

function uninstallTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'pollCycle') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  Logger.log('Trigger removed.');
}

// ============================================================
// Main poll cycle
// ============================================================

function pollCycle() {
  const driveId = getSharedDriveId();
  if (!driveId) {
    Logger.log('Not configured. Run setup() first.');
    return;
  }

  const lastRun = getLastRunTime();
  if (!lastRun) {
    setLastRunTime(new Date());
    return;
  }

  const runTime = new Date();

  // 1. Detect changes and feed into debounce
  _detectAndDebounce(driveId, lastRun);

  // 2. Process stable files (debounce expired)
  _processStableFiles(driveId);

  // 3. Check for stale approvals needing reminders
  _sendStaleReminders();

  // 4. Clean up orphaned approval rows
  cleanupOrphanedApprovals();

  // 5. Update last run time
  setLastRunTime(runTime);
}

// ============================================================
// Change detection → debounce
// ============================================================

function _detectAndDebounce(driveId, lastRun) {
  // Detect changed transcripts
  const transcripts = getChangedTranscripts(driveId, lastRun);
  transcripts.forEach(t => {
    recordFileChange(t.fileId, 'transcript', t.fileName);
  });

  // Detect changed user story docs
  const userStoryDocs = getChangedUserStoryDocs(driveId, lastRun);
  userStoryDocs.forEach(d => {
    recordFileChange(d.fileId, 'user_story', d.fileName);
  });
}

// ============================================================
// Process stable (debounced) files
// ============================================================

function _processStableFiles(driveId) {
  const stableFiles = getStableFiles(CONFIG.DEBOUNCE_MINUTES);

  // Process at most one per cycle to stay within 6-min limit
  for (const file of stableFiles) {
    try {
      if (file.fileType === 'transcript') {
        _processStableTranscript(file, driveId);
      } else if (file.fileType === 'user_story') {
        _processStableUserStoryDoc(file, driveId);
      }
      clearDebounce(file.fileId);
      return; // one per cycle
    } catch (err) {
      Logger.log('Error processing ' + file.fileName + ': ' + err.message);
      clearDebounce(file.fileId);
    }
  }
}

// ============================================================
// Flow 1: Transcript → User Story Proposal
// ============================================================

function _processStableTranscript(file, driveId) {
  Logger.log('Processing transcript: ' + file.fileName);

  // Read and preprocess transcript
  const rawContent = readDocContent(file.fileId);
  if (!rawContent.trim()) {
    Logger.log('Empty transcript: ' + file.fileName);
    return;
  }
  const transcript = preprocessTranscript(rawContent);

  // Determine epic ID from transcript content
  const epicMatch = transcript.match(EPIC_PATTERN);
  if (!epicMatch) {
    Logger.log('No EPIC: XXXX found in transcript: ' + file.fileName);
    return;
  }
  const epicId = epicMatch[1];

  // Check for existing active proposal for this epic
  if (hasActiveProposal(epicId, 'user_story')) {
    Logger.log('Active user story proposal already exists for EPIC ' + epicId + ', skipping');
    return;
  }

  // Find the user story doc
  const docInfo = findUserStoryDocForEpic(driveId, epicId);
  if (!docInfo) {
    Logger.log('No user story doc found for EPIC ' + epicId);
    return;
  }
  const userStoryContent = readDocContent(docInfo.fileId);

  // Call Gemini
  const result = callGeminiForUserStoryProposal(transcript, userStoryContent, epicId);

  // Create proposal tab
  const proposalId = createUserStoryProposal(epicId, result, file.fileName);

  // Initialize approvals and send emails
  const approvers = getApproverEmails();
  if (!approvers.length) {
    Logger.log('WARNING: No approvers configured. Proposal created but no emails sent.');
    return;
  }

  initApprovals(proposalId, approvers);
  const changeSummary = result.changes || [];
  sendProposalEmail(proposalId, 'user_story', epicId, changeSummary, approvers);

  Logger.log('Created user story proposal: ' + proposalId);
}

// ============================================================
// Flow 2: User Story Doc → Task Proposal
// ============================================================

function _processStableUserStoryDoc(file, driveId) {
  Logger.log('Processing user story doc: ' + file.fileName);

  const content = readDocContent(file.fileId);
  if (!content.trim()) {
    Logger.log('Empty document: ' + file.fileName);
    return;
  }

  // Determine epic ID
  const epicMatch = content.match(EPIC_PATTERN);
  if (!epicMatch) {
    Logger.log('No EPIC: XXXX found in: ' + file.fileName);
    return;
  }
  const epicId = epicMatch[1];

  // Check circular trigger guard — skip debounce check but still proceed
  const guardKey = 'last_applied_doc_change_' + epicId;
  const guardTime = getProp(guardKey);
  if (guardTime) {
    const guardDate = new Date(guardTime);
    const docModified = getDocLastModifiedTime(file.fileId);
    // If doc was modified within 2 minutes of our last write, this came from Flow 1
    if (Math.abs(docModified - guardDate) < 120000) {
      Logger.log('Change from Flow 1 approval detected for EPIC ' + epicId);
      deleteProp(guardKey); // clear the guard
    }
  }

  // Check for existing active task proposal for this epic
  if (hasActiveProposal(epicId, 'tasks')) {
    Logger.log('Active task proposal already exists for EPIC ' + epicId + ', skipping');
    return;
  }

  // Get current tasks (excluding Signed Off)
  const currentTasks = getAllTasks(epicId, true);

  // Call Gemini
  const result = callGeminiForTaskProposal(content, currentTasks, epicId);

  // Create proposal tab
  const proposalId = createTaskProposal(epicId, result, file.fileName);

  // Initialize approvals and send emails
  const approvers = getApproverEmails();
  if (!approvers.length) {
    Logger.log('WARNING: No approvers configured. Proposal created but no emails sent.');
    return;
  }

  initApprovals(proposalId, approvers);
  const changeSummary = (result.changeSummary || []).map(c => {
    const ref = c.taskId ? ' (' + c.taskId + ')' : '';
    return c.type.toUpperCase() + ': ' + c.name + ref + ' — ' + c.reason;
  });
  sendProposalEmail(proposalId, 'tasks', epicId, changeSummary, approvers);

  Logger.log('Created task proposal: ' + proposalId);
}

// ============================================================
// Stale approval reminders
// ============================================================

function _sendStaleReminders() {
  const stale = getStaleApprovals(CONFIG.REMINDER_HOURS);
  stale.forEach(({ proposalId, pendingEmails }) => {
    const status = getApprovalStatus(proposalId);
    sendReminderEmail(proposalId, pendingEmails, status.approvers.length);
    Logger.log('Sent reminder for ' + proposalId + ' to ' + pendingEmails.join(', '));
  });
}
