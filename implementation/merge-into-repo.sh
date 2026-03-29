#!/usr/bin/env bash
set -euo pipefail

# Merges the implementation Claude Code config into a target repo.
# - Copies agents, docs, skills, memory (won't overwrite existing docs files)
# - Deep-merges settings.json (adds MCP servers, dedupes permission allow lists)
# - Appends CLAUDE.md content under a marker so it doesn't overwrite existing content
#
# Usage: ./merge-into-repo.sh /path/to/target-repo

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_CLAUDE="$SCRIPT_DIR/.claude"
SOURCE_CLAUDEMD="$SCRIPT_DIR/CLAUDE.md"

TARGET="${1:?Usage: $0 /path/to/target-repo}"
TARGET_CLAUDE="$TARGET/.claude"
TARGET_CLAUDEMD="$TARGET/CLAUDE.md"
TARGET_SETTINGS="$TARGET_CLAUDE/settings.json"

# --- 1. Copy agents, skills, memory (overwrite) and docs (don't overwrite) ---

echo "Copying agents, skills, memory..."
rsync -av \
  --exclude='settings.json' \
  --exclude='docs/' \
  "$SOURCE_CLAUDE/" "$TARGET_CLAUDE/"

# Copy docs without overwriting existing files (target repo may have its own)
echo "Copying docs (skip existing)..."
mkdir -p "$TARGET_CLAUDE/agents/docs"
rsync -av --ignore-existing \
  "$SOURCE_CLAUDE/agents/docs/" "$TARGET_CLAUDE/agents/docs/"

# --- 2. Merge settings.json ---

echo "Merging settings.json..."
SOURCE_SETTINGS="$SOURCE_CLAUDE/settings.json"

if [ ! -f "$TARGET_SETTINGS" ]; then
  cp "$SOURCE_SETTINGS" "$TARGET_SETTINGS"
  echo "  Created new settings.json"
else
  # Deep merge: combine mcpServers, dedupe permissions.allow, preserve target's other fields
  python3 -c "
import json, sys

with open('$SOURCE_SETTINGS') as f:
    src = json.load(f)
with open('$TARGET_SETTINGS') as f:
    tgt = json.load(f)

# Merge mcpServers (source wins on conflict)
tgt.setdefault('mcpServers', {})
for k, v in src.get('mcpServers', {}).items():
    if k not in tgt['mcpServers']:
        tgt['mcpServers'][k] = v
        print(f'  Added MCP server: {k}')
    else:
        print(f'  Skipped MCP server (already exists): {k}')

# Merge permissions.allow (dedupe)
tgt.setdefault('permissions', {})
tgt_allow = set(tgt['permissions'].get('allow', []))
src_allow = set(src.get('permissions', {}).get('allow', []))
new_perms = src_allow - tgt_allow
if new_perms:
    tgt['permissions']['allow'] = sorted(tgt_allow | src_allow)
    print(f'  Added {len(new_perms)} new permission(s)')
else:
    print('  No new permissions to add')

# Preserve target's deny, defaultMode, sandbox if not set
for key in ['deny', 'defaultMode']:
    if key in src.get('permissions', {}) and key not in tgt['permissions']:
        tgt['permissions'][key] = src['permissions'][key]

if 'sandbox' in src and 'sandbox' not in tgt:
    tgt['sandbox'] = src['sandbox']

with open('$TARGET_SETTINGS', 'w') as f:
    json.dump(tgt, f, indent=2)
    f.write('\n')

print('  settings.json merged')
"
fi

# --- 3. Merge CLAUDE.md ---

MARKER="<!-- implementation-agent-system -->"

echo "Merging CLAUDE.md..."
if [ ! -f "$TARGET_CLAUDEMD" ]; then
  cp "$SOURCE_CLAUDEMD" "$TARGET_CLAUDEMD"
  echo "  Created new CLAUDE.md"
elif grep -qF "$MARKER" "$TARGET_CLAUDEMD"; then
  # Replace existing block between markers
  python3 -c "
import sys

marker = '$MARKER'
marker_end = '<!-- /implementation-agent-system -->'

with open('$TARGET_CLAUDEMD') as f:
    content = f.read()
with open('$SOURCE_CLAUDEMD') as f:
    insert = f.read()

start = content.find(marker)
end = content.find(marker_end)
if start != -1 and end != -1:
    end += len(marker_end)
    content = content[:start] + marker + '\n' + insert + '\n' + marker_end + content[end:]
    print('  Replaced existing implementation agent section')
else:
    # Only start marker found, append end
    content = content[:start] + marker + '\n' + insert + '\n' + marker_end + content[start + len(marker):]
    print('  Rewrapped implementation agent section')

with open('$TARGET_CLAUDEMD', 'w') as f:
    f.write(content)
"
else
  # Append with markers
  printf '\n%s\n' "$MARKER" >> "$TARGET_CLAUDEMD"
  cat "$SOURCE_CLAUDEMD" >> "$TARGET_CLAUDEMD"
  printf '\n%s\n' "<!-- /implementation-agent-system -->" >> "$TARGET_CLAUDEMD"
  echo "  Appended implementation agent section"
fi

echo "Done."
