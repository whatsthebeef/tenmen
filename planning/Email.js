// ============================================================
// Email — notifications for proposals
// ============================================================

function sendProposalEmail(proposalId, proposalType, featureId, changeSummary, recipientEmails) {
  var record = getProposalRecord(proposalId);
  var url = record ? record.docLink : '';
  var typeLabel = proposalType === 'user_story' ? 'Feature Document Update' : 'Task List Update';

  var changesHtml = changeSummary.map(function(c) {
    if (typeof c === 'string') {
      return '<li>' + _escapeHtml(c) + '</li>';
    }
    // Structured change object
    var type = (c.type || 'modified').toUpperCase();
    var html = '<li><strong>' + type + ': ' + _escapeHtml(c.location || '') + '</strong>';
    if (c.original) {
      html += '<br><span style="color:#cf222e;text-decoration:line-through;">' + _escapeHtml(c.original) + '</span>';
    }
    if (c.proposed) {
      html += '<br><span style="color:#1a7f37;">' + _escapeHtml(c.proposed) + '</span>';
    }
    if (c.reason) {
      html += '<br><span style="color:#666;">Reason: ' + _escapeHtml(c.reason) + '</span>';
    }
    if (c.source) {
      html += '<br><span style="color:#666;">Source: ' + _escapeHtml(c.source) + '</span>';
    }
    html += '</li>';
    return html;
  }).join('\n');

  var body = '<h2>New Patch for Review</h2>' +
    '<p>A new <strong>' + typeLabel + '</strong> patch has been created for <strong>' + _escapeHtml(featureId) + '</strong>.</p>' +
    '<h3>Change Summary</h3>' +
    '<ul>' + changesHtml + '</ul>' +
    '<p><a href="' + url + '" style="display:inline-block;padding:10px 20px;background:#1a73e8;color:white;text-decoration:none;border-radius:4px;">Open Patch Doc</a></p>' +
    '<p>Use the links at the top of the patch doc to approve or request changes.</p>' +
    '<p style="color:#666;font-size:12px;margin-top:24px;padding-top:16px;border-top:1px solid #eee;">Ensure you have access to the Shared Drive to view documents.</p>' +
    '<p style="color:#666;font-size:12px;">This email was sent by Tenmen.</p>';

  var subject = '[Tenmen] Review Patch: ' + proposalId;

  recipientEmails.forEach(function(email) {
    GmailApp.sendEmail(email, subject, '', { htmlBody: body });
  });
}

function sendResubmitEmail(proposalId, recipientEmails) {
  var record = getProposalRecord(proposalId);
  var url = record ? record.docLink : '';

  var body = '<h2>Patch Updated</h2>' +
    '<p>The patch <strong>' + _escapeHtml(proposalId) + '</strong> has been adjusted and resubmitted for review.</p>' +
    '<p>All previous approvals have been reset. Please review the updated patch.</p>' +
    '<p><a href="' + url + '" style="display:inline-block;padding:10px 20px;background:#1a73e8;color:white;text-decoration:none;border-radius:4px;">Open Patch Doc</a></p>' +
    '<p style="color:#666;font-size:12px;margin-top:24px;padding-top:16px;border-top:1px solid #eee;">Ensure you have access to the Shared Drive to view documents.</p>' +
    '<p style="color:#666;font-size:12px;">This email was sent by Tenmen.</p>';

  var subject = '[Tenmen] Updated: ' + proposalId + ' — Re-review Required';

  recipientEmails.forEach(function(email) {
    GmailApp.sendEmail(email, subject, '', { htmlBody: body });
  });
}

function sendPatchNotificationEmail(featureId, patchFileName, changeSummary, recipientEmails, docUrl) {
  var changesHtml = changeSummary.map(function(c) {
    var type = (c.type || 'modified').toUpperCase();
    var html = '<li><strong>' + type + ': ' + _escapeHtml(c.location || '') + '</strong>';
    if (c.original) {
      html += '<br><span style="color:#cf222e;text-decoration:line-through;">' + _escapeHtml(c.original) + '</span>';
    }
    if (c.proposed) {
      html += '<br><span style="color:#1a7f37;">' + _escapeHtml(c.proposed) + '</span>';
    }
    if (c.reason) {
      html += '<br><span style="color:#666;">Reason: ' + _escapeHtml(c.reason) + '</span>';
    }
    html += '</li>';
    return html;
  }).join('\n');

  var body = '<h2>Feature Document Patches Available</h2>' +
    '<p>New patches have been generated for <strong>' + _escapeHtml(featureId) + '</strong>.</p>' +
    '<h3>Proposed Changes</h3>' +
    '<ul>' + changesHtml + '</ul>' +
    '<p><a href="' + docUrl + '" style="display:inline-block;padding:10px 20px;background:#1a73e8;color:white;text-decoration:none;border-radius:4px;">Open Feature Document</a></p>' +
    '<p>Open the feature document in Chrome with the Tenmen extension to review and apply patches.</p>' +
    '<p style="color:#666;font-size:12px;">This email was sent by Tenmen. Patch file: ' + _escapeHtml(patchFileName) + '</p>';

  var subject = '[Tenmen] Patches available for ' + featureId;

  recipientEmails.forEach(function(email) {
    GmailApp.sendEmail(email, subject, '', { htmlBody: body });
  });
}

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
