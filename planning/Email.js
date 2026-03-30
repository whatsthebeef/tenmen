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

  var body = '<h2>New Proposal for Review</h2>' +
    '<p>A new <strong>' + typeLabel + '</strong> proposal has been created for <strong>' + _escapeHtml(featureId) + '</strong>.</p>' +
    '<h3>Change Summary</h3>' +
    '<ul>' + changesHtml + '</ul>' +
    '<p><a href="' + url + '" style="display:inline-block;padding:10px 20px;background:#1a73e8;color:white;text-decoration:none;border-radius:4px;">Open Proposal Doc</a></p>' +
    '<p>Use the links at the top of the proposal doc to approve or request changes.</p>' +
    '<p style="color:#666;font-size:12px;margin-top:24px;padding-top:16px;border-top:1px solid #eee;">First-time approvers will be prompted to grant permissions when clicking approve or resubmit. Ensure you have access to the Shared Drive to view proposal docs.</p>' +
    '<p style="color:#666;font-size:12px;">This email was sent by Tenmen.</p>';

  var subject = '[Tenmen] Review Proposal: ' + proposalId;

  recipientEmails.forEach(function(email) {
    GmailApp.sendEmail(email, subject, '', { htmlBody: body });
  });
}

function sendResubmitEmail(proposalId, recipientEmails) {
  var record = getProposalRecord(proposalId);
  var url = record ? record.docLink : '';

  var body = '<h2>Proposal Updated</h2>' +
    '<p>The proposal <strong>' + _escapeHtml(proposalId) + '</strong> has been adjusted and resubmitted for review.</p>' +
    '<p>All previous approvals have been reset. Please review the updated proposal.</p>' +
    '<p><a href="' + url + '" style="display:inline-block;padding:10px 20px;background:#1a73e8;color:white;text-decoration:none;border-radius:4px;">Open Proposal Doc</a></p>' +
    '<p style="color:#666;font-size:12px;margin-top:24px;padding-top:16px;border-top:1px solid #eee;">First-time approvers will be prompted to grant permissions when clicking approve or resubmit. Ensure you have access to the Shared Drive to view proposal docs.</p>' +
    '<p style="color:#666;font-size:12px;">This email was sent by Tenmen.</p>';

  var subject = '[Tenmen] Updated: ' + proposalId + ' — Re-review Required';

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
