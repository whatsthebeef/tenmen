// ============================================================
// Email — notifications for proposals and reminders
// ============================================================

/**
 * Send proposal notification email to all approvers.
 */
function sendProposalEmail(proposalId, proposalType, epicId, changeSummary, recipientEmails) {
  const url = buildProposalUrl(proposalId);
  const typeLabel = proposalType === 'user_story' ? 'User Story Update' : 'Task List Update';

  const changesHtml = changeSummary.map(c => '<li>' + _escapeHtml(c) + '</li>').join('\n');

  const body = `
    <h2>New Proposal for Review</h2>
    <p>A new <strong>${typeLabel}</strong> proposal has been created for <strong>EPIC ${_escapeHtml(epicId)}</strong>.</p>

    <h3>Change Summary</h3>
    <ul>
      ${changesHtml}
    </ul>

    <p><a href="${url}" style="display:inline-block;padding:10px 20px;background:#1a73e8;color:white;text-decoration:none;border-radius:4px;">Open Proposal in Spreadsheet</a></p>
    <p>Use the sidebar (<strong>Tenmen &gt; Review Current Proposal</strong>) to approve or adjust.</p>

    <p style="color:#666;font-size:12px;">This email was sent by Tenmen. You are receiving this because you are on the approver list.</p>
  `;

  const subject = '[Tenmen] Review Proposal: ' + proposalId;

  recipientEmails.forEach(email => {
    GmailApp.sendEmail(email, subject, '', { htmlBody: body });
  });
}

/**
 * Send reminder email for stale pending approvals.
 */
function sendReminderEmail(proposalId, pendingEmails, totalApprovers) {
  const url = buildProposalUrl(proposalId);
  const approvedCount = totalApprovers - pendingEmails.length;

  const body = `
    <h2>Approval Reminder</h2>
    <p>The following proposal is awaiting your review:</p>
    <p><strong>${_escapeHtml(proposalId)}</strong></p>
    <p>Current status: <strong>${approvedCount} of ${totalApprovers}</strong> approvals received.</p>

    <p><a href="${url}" style="display:inline-block;padding:10px 20px;background:#1a73e8;color:white;text-decoration:none;border-radius:4px;">Open Proposal</a></p>

    <p style="color:#666;font-size:12px;">This is an automated reminder from Tenmen.</p>
  `;

  const subject = '[Tenmen] Reminder: Pending approval for ' + proposalId;

  pendingEmails.forEach(email => {
    GmailApp.sendEmail(email, subject, '', { htmlBody: body });
  });
}

/**
 * Send resubmit notification email to all approvers.
 */
function sendResubmitEmail(proposalId, recipientEmails) {
  const url = buildProposalUrl(proposalId);

  const body = `
    <h2>Proposal Updated</h2>
    <p>The proposal <strong>${_escapeHtml(proposalId)}</strong> has been adjusted and resubmitted for review.</p>
    <p>All previous approvals have been reset. Please review the updated proposal.</p>

    <p><a href="${url}" style="display:inline-block;padding:10px 20px;background:#1a73e8;color:white;text-decoration:none;border-radius:4px;">Open Updated Proposal</a></p>

    <p style="color:#666;font-size:12px;">This email was sent by Tenmen.</p>
  `;

  const subject = '[Tenmen] Updated: ' + proposalId + ' — Re-review Required';

  recipientEmails.forEach(email => {
    GmailApp.sendEmail(email, subject, '', { htmlBody: body });
  });
}

/**
 * Build URL to open the spreadsheet at the specific proposal tab.
 */
function buildProposalUrl(proposalId) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(proposalId);
  if (!sheet) return ss.getUrl();
  return ss.getUrl() + '#gid=' + sheet.getSheetId();
}

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
