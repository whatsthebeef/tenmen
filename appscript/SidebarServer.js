// ============================================================
// Sidebar server-side functions (called via google.script.run)
// ============================================================

/**
 * Get sidebar data based on the currently active sheet tab.
 */
function getSidebarData() {
  const ss = getSpreadsheet();
  const activeSheet = ss.getActiveSheet();
  const tabName = activeSheet.getName();
  const proposalType = getProposalType(tabName);

  if (!proposalType) {
    const proposals = listActiveProposals();
    return {
      isProposal: false,
      proposals: proposals.map(p => ({
        proposalId: p.proposalId,
        type: p.type,
        epicId: p.epicId,
        url: buildProposalUrl(p.proposalId),
      })),
    };
  }

  const epicId = getProposalEpicId(tabName);
  const changeSummary = getProposalChangeSummary(tabName);
  const approvalStatus = getApprovalStatus(tabName);
  const currentUser = Session.getActiveUser().getEmail();

  return {
    isProposal: true,
    proposalId: tabName,
    proposalType: proposalType,
    epicId: epicId,
    changeSummary: changeSummary,
    approvers: approvalStatus.approvers,
    allApproved: approvalStatus.allApproved,
    currentUserEmail: currentUser,
  };
}

/**
 * Record approval for the current user on the active proposal.
 */
function sidebarApprove() {
  const ss = getSpreadsheet();
  const tabName = ss.getActiveSheet().getName();
  const currentUser = Session.getActiveUser().getEmail();

  if (!currentUser) {
    return { error: 'Could not determine your email address.' };
  }

  recordApproval(tabName, currentUser);

  const applied = checkAndApply(tabName);

  const status = getApprovalStatus(tabName);
  return {
    success: true,
    applied: applied,
    approvers: status.approvers,
    allApproved: status.allApproved,
  };
}

/**
 * Reset all approvals and notify everyone (after adjustment).
 */
function sidebarResubmit() {
  const ss = getSpreadsheet();
  const tabName = ss.getActiveSheet().getName();

  resetApprovals(tabName);

  const approvers = getApproverEmails();
  sendResubmitEmail(tabName, approvers);

  const status = getApprovalStatus(tabName);
  return {
    success: true,
    approvers: status.approvers,
    allApproved: false,
  };
}
