#!/usr/bin/env bash
set -euo pipefail

# Deploy a named Tenmen app. Each app is a separate Apps Script project
# with its own deployment, Script Properties, and configuration.
#
# Usage:
#   ./deploy.sh <name>                    # Deploy (or create) an app
#   ./deploy.sh <name> --create           # Create a new app project
#   ./deploy.sh <name> --merge /path      # Deploy and merge config into repo
#   ./deploy.sh <name> --open             # Open the Apps Script editor

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
PLANNING_DIR="$REPO_ROOT/planning"
DEPLOYMENTS_DIR="$PLANNING_DIR/deployments"
DEPLOY_CONFIG="$PLANNING_DIR/.deploy-config"

# --- Parse arguments ---

APP_NAME="${1:-}"
if [ -z "$APP_NAME" ]; then
  echo "Usage: ./deploy.sh <name> [--create] [--merge /path] [--open]"
  echo ""
  if [ -d "$DEPLOYMENTS_DIR" ] && ls "$DEPLOYMENTS_DIR"/*.clasp.json &>/dev/null; then
    echo "Available apps:"
    for f in "$DEPLOYMENTS_DIR"/*.clasp.json; do
      echo "  $(basename "$f" .clasp.json)"
    done
  else
    echo "No apps configured yet. Create one with: ./deploy.sh <name> --create"
  fi
  exit 1
fi
shift

ACTION="deploy"
MERGE_TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --create) ACTION="create"; shift ;;
    --merge)  MERGE_TARGET="${2:?--merge requires a path}"; shift 2 ;;
    --open)   ACTION="open"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

CLASP_FILE="$DEPLOYMENTS_DIR/$APP_NAME.clasp.json"

# --- Load or prompt for domain (shared across all apps) ---

if [ -f "$DEPLOY_CONFIG" ]; then
  source "$DEPLOY_CONFIG"
fi

if [ -z "${DOMAIN:-}" ]; then
  read -p "Google Workspace domain (e.g. thepocketlab.com), or leave blank for personal account: " DOMAIN
  echo "DOMAIN=\"$DOMAIN\"" > "$DEPLOY_CONFIG"
  echo "Saved to $DEPLOY_CONFIG"
fi

# --- Helper to build web app URL from deployment ID ---

build_url() {
  local deploy_id="$1"
  if [ -n "$DOMAIN" ]; then
    echo "https://script.google.com/a/macros/$DOMAIN/s/$deploy_id/exec"
  else
    echo "https://script.google.com/macros/s/$deploy_id/exec"
  fi
}

# --- Create a new app ---

if [ "$ACTION" = "create" ]; then
  if [ -f "$CLASP_FILE" ]; then
    echo "App '$APP_NAME' already exists at $CLASP_FILE"
    exit 1
  fi

  mkdir -p "$DEPLOYMENTS_DIR"
  cd "$PLANNING_DIR"

  echo "Creating Apps Script project: $APP_NAME..."
  npx @google/clasp create --type standalone --title "Tenmen — $APP_NAME"

  # clasp create overwrites .clasp.json in the current dir — move it
  mv .clasp.json "$CLASP_FILE"
  echo "Saved project config to $CLASP_FILE"

  # Restore appsscript.json (clasp create overwrites it with defaults)
  git checkout -- appsscript.json

  echo ""
  echo "App '$APP_NAME' created. Deploy it with: ./deploy.sh $APP_NAME"
  exit 0
fi

# --- Check app exists ---

if [ ! -f "$CLASP_FILE" ]; then
  echo "App '$APP_NAME' not found. Create it first: ./deploy.sh $APP_NAME --create"
  exit 1
fi

# --- Open editor ---

if [ "$ACTION" = "open" ]; then
  cd "$PLANNING_DIR"
  cp "$CLASP_FILE" .clasp.json
  npx @google/clasp open
  rm -f .clasp.json
  exit 0
fi

# --- Deploy ---

cd "$PLANNING_DIR"

# Use the app's clasp config
cp "$CLASP_FILE" .clasp.json
trap 'rm -f "$PLANNING_DIR/.clasp.json"' EXIT

echo "Deploying '$APP_NAME'..."
echo ""

echo "Pushing to Apps Script..."
npx @google/clasp push --force

echo "Checking existing deployments..."
DEPLOY_OUTPUT=$(npx @google/clasp deployments 2>&1)

# Find the first non-HEAD deployment ID
DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | grep -v '@HEAD' | grep -oE '^\- [^ ]+' | sed 's/^- //' | head -1 || true)

if [ -n "$DEPLOY_ID" ]; then
  echo "Updating deployment $DEPLOY_ID..."
  npx @google/clasp deploy -i "$DEPLOY_ID" -d "$APP_NAME $(date '+%Y-%m-%d %H:%M')"
else
  echo "Creating first deployment..."
  DEPLOY_OUTPUT=$(npx @google/clasp deploy -d "$APP_NAME $(date '+%Y-%m-%d %H:%M')" 2>&1)
  echo "$DEPLOY_OUTPUT"
  DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | grep -oE '^\- [^ ]+' | sed 's/^- //' | head -1 || true)
fi

URL=""
if [ -n "$DEPLOY_ID" ]; then
  URL=$(build_url "$DEPLOY_ID")
  echo ""
  echo "Web app URL: $URL"
  echo "Opening..."
  open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || true
else
  echo ""
  echo "Done. Could not determine deployment ID."
fi

# --- Merge into target repo if requested ---

if [ -n "$MERGE_TARGET" ]; then
  echo ""
  echo "Merging implementation config into $MERGE_TARGET..."
  "$REPO_ROOT/implementation/merge-into-repo.sh" "$MERGE_TARGET"

  if [ -n "$URL" ]; then
    MEMORY_DIR="$MERGE_TARGET/.claude/memory"
    mkdir -p "$MEMORY_DIR"
    cat > "$MEMORY_DIR/task_api_url.md" <<EOF
---
name: Task API URL
description: Web app URL for the Tenmen task sheet API (claim_next, finish_task endpoints)
type: reference
---

$URL
EOF
    echo "Wrote task API URL to $MEMORY_DIR/task_api_url.md"

    MEMORY_INDEX="$MEMORY_DIR/MEMORY.md"
    if [ -f "$MEMORY_INDEX" ]; then
      if ! grep -qF "task_api_url.md" "$MEMORY_INDEX"; then
        echo "- [Task API URL](task_api_url.md) — Web app URL for the Tenmen task sheet API" >> "$MEMORY_INDEX"
      fi
    else
      echo "# Memory Index" > "$MEMORY_INDEX"
      echo "" >> "$MEMORY_INDEX"
      echo "- [Task API URL](task_api_url.md) — Web app URL for the Tenmen task sheet API" >> "$MEMORY_INDEX"
    fi
  fi
fi

echo ""
echo "Done."
