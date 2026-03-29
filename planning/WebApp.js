// ============================================================
// Web App — doGet handler for approve/resubmit/trigger actions
// ============================================================

function doGet(e) {
  var action = e.parameter.action;

  // Trigger actions (no proposalId needed)
  if (action === 'process_last_summary') {
    return _handleProcessLastSummary();
  }
  if (action === 'process_last_user_story') {
    return _handleProcessLastUserStory();
  }

  // Proposal actions (need proposalId)
  var proposalId = e.parameter.proposalId;

  if (!action || !proposalId) {
    return _buildConfirmationPage({
      title: 'Invalid Request',
      message: 'Missing action or proposal ID.',
      icon: 'error',
    });
  }

  var record = getProposalRecord(proposalId);
  if (!record) {
    return _buildConfirmationPage({
      title: 'Proposal Not Found',
      message: 'The proposal "' + proposalId + '" was not found.',
      icon: 'error',
    });
  }

  if (record.status !== 'active') {
    // Link to the relevant output rather than the archived proposal
    var resolvedLink = record.docLink;
    var resolvedLinkText = 'View Proposal';
    if (record.type === 'user_story') {
      var featureDoc = findFeatureDocById(getSharedDriveId(), getProposalFeatureId(proposalId));
      if (featureDoc) {
        resolvedLink = 'https://docs.google.com/document/d/' + featureDoc.fileId + '/edit';
        resolvedLinkText = 'View Feature Document';
      }
    } else if (record.type === 'tasks') {
      resolvedLink = 'https://docs.google.com/spreadsheets/d/' + getSpreadsheetId() + '/edit';
      resolvedLinkText = 'View Task List';
    }
    return _buildConfirmationPage({
      title: 'Proposal Already Resolved',
      message: 'This proposal has already been ' + record.status + '.',
      icon: 'info',
      docLink: resolvedLink,
      linkText: resolvedLinkText,
    });
  }

  var userEmail = Session.getActiveUser().getEmail();
  if (!userEmail) {
    return _buildConfirmationPage({
      title: 'Authentication Required',
      message: 'Could not determine your email address. Please ensure you are signed in.',
      icon: 'error',
    });
  }

  var status = getApprovalStatus(proposalId);
  var isApprover = status.approvers.some(function(a) { return a.email === userEmail; });
  if (!isApprover) {
    return _buildConfirmationPage({
      title: 'Not Authorized',
      message: 'You (' + userEmail + ') are not on the approver list for this proposal.',
      icon: 'error',
    });
  }

  if (action === 'approve') {
    recordApproval(proposalId, userEmail);
    var result = checkAndApply(proposalId);

    var link = record.docLink;
    var linkLabel = 'Back to Proposal Doc';

    if (result.applied) {
      if (result.redirectUrl) {
        link = result.redirectUrl;
        linkLabel = record.type === 'user_story' ? 'View Updated Feature Document' : 'View Task List';
      } else {
        // Merge may have failed but status was updated — link to spreadsheet
        link = 'https://docs.google.com/spreadsheets/d/' + getSpreadsheetId() + '/edit';
        linkLabel = 'View Tenmen Tasks';
      }
    }

    return _buildConfirmationPage({
      title: 'Approval Recorded',
      message: result.applied
        ? 'All approvers have approved. Changes have been applied.'
        : 'Your approval has been recorded. Waiting for other approvers.',
      icon: 'success',
      docLink: link,
      linkText: linkLabel,
    });

  } else if (action === 'resubmit') {
    resetApprovals(proposalId);
    var approvers = getApproverEmails();
    sendResubmitEmail(proposalId, approvers);

    return _buildConfirmationPage({
      title: 'Resubmitted for Review',
      message: 'All approvals have been reset. Approvers have been notified.',
      icon: 'info',
      docLink: record.docLink,
    });

  } else {
    return _buildConfirmationPage({
      title: 'Unknown Action',
      message: 'The action "' + action + '" is not recognized.',
      icon: 'error',
    });
  }
}

// ============================================================
// Trigger handlers
// ============================================================

function _handleProcessLastSummary() {
  try {
    processLastSummary();
    return _buildConfirmationPage({
      title: 'Processing Started',
      message: 'The last meeting summary is being processed. Proposal(s) will appear shortly.',
      icon: 'success',
      docLink: 'https://docs.google.com/spreadsheets/d/' + getSpreadsheetId() + '/edit',
    });
  } catch (err) {
    return _buildConfirmationPage({
      title: 'Processing Failed',
      message: 'Error: ' + err.message,
      icon: 'error',
    });
  }
}

function _handleProcessLastUserStory() {
  try {
    var driveId = getSharedDriveId();
    if (!driveId) throw new Error('Not configured. Run setup() first.');

    // Find the most recently modified feature doc at the drive root
    var docs = discoverFeatureDocs(driveId);
    if (!docs.length) throw new Error('No feature docs found at the drive root. Name them like "F1 Feature Name".');

    // Get modification times and find the most recent
    var latest = null;
    var latestTime = null;
    for (var i = 0; i < docs.length; i++) {
      var modTime = getDocLastModifiedTime(docs[i].fileId);
      if (!latestTime || modTime > latestTime) {
        latestTime = modTime;
        latest = docs[i];
      }
    }

    if (!latest) throw new Error('Could not determine the most recent user story doc.');

    Logger.log('Processing last modified user story: ' + latest.fileName);

    // Process it directly (bypass debounce)
    _processStableUserStoryDoc({ fileId: latest.fileId, fileName: latest.fileName }, driveId);

    return _buildConfirmationPage({
      title: 'Processing Started',
      message: 'Task proposal for "' + latest.fileName + '" is being generated.',
      icon: 'success',
      docLink: 'https://docs.google.com/spreadsheets/d/' + getSpreadsheetId() + '/edit',
    });
  } catch (err) {
    return _buildConfirmationPage({
      title: 'Processing Failed',
      message: 'Error: ' + err.message,
      icon: 'error',
    });
  }
}

function _buildConfirmationPage(data) {
  var template = HtmlService.createTemplateFromFile('Confirmation');
  template.data = data;
  return template.evaluate()
    .setTitle('Tenmen — ' + data.title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
