# Tenmen Process Description

## Overview

Tenmen automates the management of feature documentation and development task lists. It monitors a Google Shared Drive for meeting summaries and feature document changes, uses Gemini AI to propose updates, and routes proposals through a multi-user approval workflow before applying changes.

## ID System

### Feature ID
- **Format**: `F<number>` (e.g. `F1`, `F12`)
- **Where it appears**: As a prefix on Feature Document filenames
- **Example filename**: `F1 Teacher Support Documents`

### User Story ID
- **Format**: `F<number>S<number>` (e.g. `F1S1`, `F12S3`)
- **Where it appears**: Prefixed to each user story summary in the Feature Document
- **Example in document**: `F1S1 Teacher wants to view support documents`

### Task ID
- **Format**: `F<number>S<number>T<number>` (e.g. `F1S1T1`, `F12S3T2`)
- **Where it appears**: In the Task List spreadsheet and Task List Change Proposals
- **Relationship**: Each task maps to a user story. Simple stories have one task (`T1`). Complex stories split into multiple tasks (`T1`, `T2`, `T3`...)
- **Example**: `F1S1T1` = Feature 1, Story 1, Task 1

### Proposal ID
- **Format**: `<TYPE>-<FEATURE_ID>-<YYYYMMDD>-<SEQUENCE>`
- **Feature Document proposals**: `FD-F1-20260327-1`
- **Task List proposals**: `TK-F1-20260327-2`

## Documents

### Feature Document (Google Doc)
- **Location**: Shared Drive root
- **Filename**: `F<number> <Feature Name>` (e.g. `F1 Teacher Support Documents`)
- **Content structure**:
  ```
  F1S1 Teacher wants to view support documents
  Teacher wants to view support documents in the system so they can
  reference instructional materials during class preparation.

  Acceptance Criteria:
  - Teacher can browse a list of available support documents
  - Documents render in a readable format
  - Teacher can search for specific documents by keyword

  F1S2 Teacher wants to edit support documents
  Teacher wants to edit support documents in the system so they can
  customize instructional materials for their classes.

  Acceptance Criteria:
  - Teacher can open a document in edit mode
  - Changes are saved automatically
  - Teacher can revert to a previous version
  ```
- **Key points**:
  - Each user story is prefixed with its ID (`F1S1`, `F1S2`, etc.)
  - The summary follows the format: `<Role> wants to <perform some function>`
  - The full story follows: `<Role> wants to <function> so they can <goal>`
  - Acceptance Criteria are listed below each story

### Technical Notes Document (Google Doc)
- **Location**: Shared Drive root
- **Filename**: `F<number> Technical Notes` (e.g. `F1 Technical Notes`)
- **Auto-created**: Generated when the first meeting summary is processed for a feature
- **Content structure**:
  ```
  F1 Technical Notes
  Last updated: 3/27/2026, 5:18 PM

  F1S1T1 — Teacher wants to view support documents
  - Use existing document viewer component from the shared library
  - Documents stored in S3 with CloudFront CDN for delivery
  - Consider lazy loading for large document lists

  F1S2T1 — Teacher wants to edit support documents
  - Implement collaborative editing using Yjs CRDT library
  - Auto-save with 2-second debounce
  - Version history stored in DynamoDB

  General
  - Migrate to Node 20 before starting feature work
  - Set up staging environment with Docker Compose
  - All API endpoints need OpenAPI 3.0 specs
  ```
- **Key points**:
  - Sections are organized by task ID when content relates to a specific task
  - The "General" section holds notes that don't map to a specific task
  - Content is exclusively technical: architecture, code, infrastructure, configuration
  - Does NOT contain user stories, acceptance criteria, or product requirements
  - Continuously reorganized: General notes are moved to specific task sections when new task information allows matching

### Feature Document Change Proposal (Google Doc)
- **Location**: `proposals/` folder in Shared Drive
- **Filename**: `Proposal: F1 — Feature Document Update`
- **Content structure**:
  ```
  [  Approve  ]    [  Resubmit for Review  ]     ← styled links
  ─────────────────────────────────────────────

  Proposal: Feature Document Update for F1        ← H1
  Source: Tech Meeting - 2026/03/25
  Created: 3/27/2026, 10:00 AM
  Original document: F1 Teacher Support Documents  ← hyperlink

  Change Summary                                   ← H2
  - Added new user story F1S3 for document export
  - Modified acceptance criteria for F1S2 to include auto-save
  - Removed reference to legacy document format

  ══════════════ PAGE BREAK ══════════════════════

  Full Proposed Document                           ← H2
  F1S1 Teacher wants to view support documents
  Teacher wants to view support documents in the system so they can
  reference instructional materials during class preparation.

  Acceptance Criteria:
  - Teacher can browse a list of available support documents
  - Documents render in a readable format
  - Teacher can search for specific documents by keyword
  - [bold green] Teacher can filter documents by subject area [/bold green]

  F1S2 Teacher wants to edit support documents
  ...
  - [strikethrough red] Teacher can export to PDF [/strikethrough red]
  - [bold green] Changes are saved automatically every 2 seconds [/bold green]

  [bold green] F1S3 Teacher wants to export support documents
  Teacher wants to export support documents so they can share them
  outside the system.

  Acceptance Criteria:
  - Teacher can export to PDF format
  - Teacher can export to Word format [/bold green]
  ```
- **Key points**:
  - Approve/Resubmit links at the top point to the web app
  - Additions shown in **bold green** text
  - Removals shown in ~~strikethrough red~~ text
  - Users can edit the proposed document directly before resubmitting
  - When approved, the resolved text (additions kept, removals deleted) is written to the actual Feature Document

### Task List Change Proposal (Google Doc)
- **Location**: `proposals/` folder in Shared Drive
- **Orientation**: Landscape
- **Filename**: `Proposal: TK-F1 — Task List Update`
- **Content structure**:
  ```
  [  Approve  ]    [  Resubmit for Review  ]
  ─────────────────────────────────────────────

  Proposal: Task List Update for F1                ← H1
  Source: F1 Teacher Support Documents
  Created: 3/27/2026, 2:00 PM
  Task spreadsheet: Tenmen Tasks                   ← hyperlink

  Change Summary                                   ← H2
  - NEW: F1S3T1 Teacher wants to export documents — New user story in feature document
  - MODIFIED: F1S2T1 Teacher wants to edit documents — Auto-save requirement added
  - REMOVED: F1S1T2 Developer wants to build PDF renderer — Descoped

  Updates                                          ← H2 (only if updates exist)
  ┌──────────┬────────────────────┬──────────────────────┬─────────────────────┬──────────┐
  │ id       │ summary            │ description          │ acceptance_criteria  │ notes    │
  ├──────────┼────────────────────┼──────────────────────┼─────────────────────┼──────────┤
  │ F1S2T1   │ Teacher wants to   │ Teacher wants to     │ - Can open in edit  │ Use Yjs  │
  │          │ edit support docs  │ edit support docs so │   mode              │ CRDT for │
  │          │                    │ they can customize   │ - Auto-save every   │ collab   │
  │          │                    │ materials            │   2 seconds         │ editing  │
  │          │                    │                      │ - [Inferred] Shows  │          │
  │          │                    │                      │   save indicator    │          │
  └──────────┴────────────────────┴──────────────────────┴─────────────────────┴──────────┘

  Creates                                          ← H2 (only if creates exist)
  ┌──────────┬────────────────────┬──────────────────────┬─────────────────────┬──────────┐
  │ id       │ summary            │ description          │ acceptance_criteria  │ notes    │
  ├──────────┼────────────────────┼──────────────────────┼─────────────────────┼──────────┤
  │ F1S3T1   │ Teacher wants to   │ Teacher wants to     │ - Can export to PDF │ Use      │
  │          │ export documents   │ export support docs  │ - Can export to     │ existing │
  │          │                    │ so they can share    │   Word format       │ export   │
  │          │                    │ outside the system   │ - [Inferred] Shows  │ library  │
  │          │                    │                      │   download progress │          │
  └──────────┴────────────────────┴──────────────────────┴─────────────────────┴──────────┘

  Deletes                                          ← H2 (only if deletes exist)
  ┌──────────┬────────────────────┐
  │ id       │ summary            │
  ├──────────┼────────────────────┤
  │ F1S1T2   │ Developer wants to │
  │          │ build PDF renderer │
  └──────────┴────────────────────┘
  ```
- **Key points**:
  - Tables only appear if there are items of that type
  - `id` in Creates is auto-generated by Gemini based on existing task list state
  - `acceptance_criteria` includes explicit criteria from the Feature Document plus inferred criteria marked with `[Inferred]`
  - `notes` populated from the Technical Notes document, matched by task ID and General section relevance
  - `summary` format: `<Role> wants to <function>`. If a user story is split into multiple tasks, a qualifier is appended: `<Role> wants to <function> — <specific part>`

## Spreadsheet (Tenmen Tasks)

### Tasks Tab
| Column | Description |
|--------|-------------|
| id | Task ID (e.g. `F1S1T1`) |
| name | Task summary |
| description | Full user story text |
| acceptance_criteria | Acceptance criteria for this task |
| notes | Technical implementation notes |
| status | `To Do`, `Doing`, `Review`, `Signed Off` |
| source_doc | Source document name |
| date_created | ISO date |

**Protected statuses**: Tasks with status `Doing`, `Review`, or `Signed Off` cannot be modified or deleted by the system.

### Proposals Tab
| Column | Description |
|--------|-------------|
| proposal_id | Unique ID (e.g. `FD-F1-20260327-1`) |
| type | `user_story` or `tasks` |
| feature_id | Feature ID (e.g. `F1`) |
| status | `active` or `approved` |
| doc_id | Google Doc file ID |
| doc_link | Google Doc URL |
| created_date | ISO date |

### Approvals Tab
| Column | Description |
|--------|-------------|
| proposal_id | References Proposals tab |
| user_email | Approver email |
| status | `pending` or `approved` |
| timestamp | ISO timestamp when approved |
| doc_link | Link to proposal doc |

### Config Tab
| Key | Value | Purpose |
|-----|-------|---------|
| approvers | email1@co.com,email2@co.com | Comma-separated approver list |

### Actions Tab
| Action | Description |
|--------|-------------|
| Process Last Meeting Summary | Triggers Feature Document Change Proposal generation |
| Process Last User Story Change | Triggers Task List Change Proposal generation |

## Process Flows

### Flow 1: Meeting Summary → Feature Document Change Proposal

**Trigger**: New or modified Google Doc in the `transcripts/` folder

**Steps**:
1. Poll cycle detects change in `transcripts/` folder
2. 10-minute debounce waits for editing to stop
3. Gemini reads the meeting summary and all known Feature Documents
4. Gemini identifies which features were discussed (returns list of Feature IDs)
5. For each identified feature:
   a. Read the current Feature Document
   b. Gemini proposes changes: additions (bold), removals (strikethrough), new user stories with IDs
   c. Proposal Google Doc created in `proposals/` folder with change summary and full proposed document
   d. Proposal registered in Proposals tab
   e. Approval rows created in Approvals tab
   f. Email sent to all approvers
6. Additionally, Gemini extracts technical notes from the meeting summary and updates/creates the Technical Notes document for each feature

**Gemini input**:
- Meeting summary text
- Current Feature Document text
- Feature ID
- Known tasks (for technical notes)
- Existing technical notes (for technical notes update)

**Gemini output (Feature Doc proposal)**:
```json
{
  "changes": ["Added new user story F1S3...", "Modified AC for F1S2..."],
  "proposedDocument": "Full text with <<<BOLD>>>additions<<<ENDBOLD>>> and <<<STRIKE>>>removals<<<ENDSTRIKE>>>"
}
```

**Gemini output (Technical Notes)**:
```json
{
  "sections": [
    { "taskId": "F1S1T1", "taskSummary": "Teacher wants to view docs", "notes": ["Use S3 + CloudFront", "Lazy load large lists"] },
    { "taskId": null, "taskSummary": "General", "notes": ["Migrate to Node 20"] }
  ]
}
```

### Flow 2: Feature Document Change → Task List Change Proposal

**Trigger**: Feature Document modified (either manually or by Flow 1 approval)

**Steps**:
1. Poll cycle detects change to a Feature Document at the drive root
2. 10-minute debounce (skipped if change came from Flow 1 approval via circular trigger guard)
3. Read updated Feature Document
4. Read current Task List from spreadsheet (excluding Signed Off tasks)
5. Read Technical Notes document for the feature
6. Gemini compares Feature Document against Task List and Technical Notes
7. Gemini generates: new tasks, modified tasks, removed tasks with IDs, acceptance criteria, and technical notes
8. Task List Change Proposal Google Doc created in `proposals/` folder
9. Proposal registered, approvals initialized, emails sent

**Gemini input**:
- Updated Feature Document text
- Current task list with IDs, summaries, descriptions, acceptance criteria, notes, statuses
- Technical Notes document text
- Feature ID

**Gemini output**:
```json
{
  "changeSummary": [
    { "type": "new", "taskId": "F1S3T1", "summary": "Teacher wants to export documents", "reason": "New user story" },
    { "type": "modified", "taskId": "F1S2T1", "summary": "Teacher wants to edit documents", "reason": "AC changed" },
    { "type": "removed", "taskId": "F1S1T2", "summary": "Developer wants to build renderer", "reason": "Descoped" }
  ],
  "updates": [
    { "id": "F1S2T1", "summary": "Teacher wants to edit support documents", "description": "Full user story...", "acceptance_criteria": ["Can open in edit mode", "Auto-save every 2 seconds", "[Inferred] Shows save indicator"], "notes": "Use Yjs CRDT library for collaborative editing" }
  ],
  "creates": [
    { "id": "F1S3T1", "summary": "Teacher wants to export documents", "description": "Full user story...", "acceptance_criteria": ["Export to PDF", "Export to Word", "[Inferred] Shows download progress"], "notes": "Use existing export library" }
  ],
  "deletes": [
    { "id": "F1S1T2", "summary": "Developer wants to build PDF renderer" }
  ]
}
```

**Task splitting rules** (applied by Gemini):
- Simple user stories → one task: `F1S1T1`, summary matches user story
- Complex user stories → multiple tasks: `F1S1T1`, `F1S1T2`, etc.
- Split when: many acceptance criteria with clear groupings, flagged as complex in technical notes, or parts can be worked independently
- Don't split when: simple, small, or tightly coupled acceptance criteria
- Split task summaries: user story summary + qualifier (e.g. `Teacher wants to edit documents — basic editing`)

### Approval Process

**Unanimous approval required** — all users in the approver list must approve.

1. Approvers receive email with change summary and link to proposal doc
2. Approver opens proposal doc, reviews changes
3. **Approve**: clicks Approve link → web app records approval → if all approved, changes are applied
4. **Adjust + Resubmit**: edits the proposal doc directly, clicks Resubmit link → all approvals reset, fresh emails sent

**On approval of Feature Document proposal**:
- Proposed document text is resolved (bold text kept as plain, strikethrough text removed)
- Resolved text written directly to the actual Feature Document
- Proposal doc moved to `archive/` folder
- This Feature Document change triggers Flow 2 (Task List Change Proposal)

**On approval of Task List proposal**:
- Proposal marked as `approved` in the spreadsheet
- Proposal doc moved to `archive/` folder
- Tasks are NOT auto-applied to the Task List (manual action)

## Folder Structure

```
Shared Drive/
├── F1 Teacher Support Documents          ← Feature Document
├── F1 Technical Notes                    ← Technical Notes (auto-created)
├── F2 Student Dashboard                  ← Feature Document
├── F2 Technical Notes                    ← Technical Notes (auto-created)
├── transcripts/                          ← Meeting summaries dropped here
│   └── Tech Meeting - 2026-03-25...     ← Gemini meeting summary
├── proposals/                            ← Active proposal docs
│   ├── Proposal: F1 — Feature Doc...
│   └── Proposal: TK-F1 — Task List...
├── archive/                              ← Approved proposals moved here
│   └── Proposal: F1 — Feature Doc...
└── Tenmen Tasks                          ← Spreadsheet (Tasks, Proposals, Approvals, Config, Actions)
```
