#!/usr/bin/env bash
set -euo pipefail

# Deploy the Tenmen Apps Script project.
#
# Usage:
#   ./deploy.sh                # Push code and update deployment
#   ./deploy.sh create <name>  # Create a new Apps Script project
#   ./deploy.sh open           # Open the Apps Script editor

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
PLANNING_DIR="$REPO_ROOT/appscript"
DEPLOYMENTS_DIR="$PLANNING_DIR/deployments"
DEPLOY_CONFIG="$PLANNING_DIR/.deploy-config"

# --- Parse arguments ---

ACTION="deploy"
CREATE_NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    create|--create) ACTION="create"; CREATE_NAME="${2:?create requires a name}"; shift 2 ;;
    open|--open)     ACTION="open"; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Load or prompt for domain ---

if [ -f "$DEPLOY_CONFIG" ]; then
  source "$DEPLOY_CONFIG"
fi

if [ -z "${DOMAIN:-}" ]; then
  read -p "Google Workspace domain (e.g. thepocketlab.com), or leave blank for personal account: " DOMAIN
  echo "DOMAIN=\"$DOMAIN\"" > "$DEPLOY_CONFIG"
  echo "Saved to $DEPLOY_CONFIG"
fi

# --- Helper: find the single clasp config ---

find_clasp_config() {
  if [ ! -d "$DEPLOYMENTS_DIR" ] || ! ls "$DEPLOYMENTS_DIR"/*.clasp.json &>/dev/null; then
    echo "Error: No Apps Script project. Create one with: ./deploy.sh --create <name>" >&2
    exit 1
  fi
  local count
  count=$(ls "$DEPLOYMENTS_DIR"/*.clasp.json 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -ne 1 ]; then
    echo "Error: Expected exactly one project, found $count in $DEPLOYMENTS_DIR" >&2
    exit 1
  fi
  echo "$DEPLOYMENTS_DIR"/*.clasp.json
}

# --- Helper to build web app URL from deployment ID ---

build_url() {
  local deploy_id="$1"
  if [ -n "$DOMAIN" ]; then
    echo "https://script.google.com/a/macros/$DOMAIN/s/$deploy_id/exec"
  else
    echo "https://script.google.com/macros/s/$deploy_id/exec"
  fi
}

# --- Create a new project ---

if [ "$ACTION" = "create" ]; then
  CLASP_FILE="$DEPLOYMENTS_DIR/$CREATE_NAME.clasp.json"
  if [ -f "$CLASP_FILE" ]; then
    echo "Project '$CREATE_NAME' already exists at $CLASP_FILE"
    exit 1
  fi

  mkdir -p "$DEPLOYMENTS_DIR"
  cd "$PLANNING_DIR"

  echo "Creating Apps Script project: $CREATE_NAME..."
  npx clasp create-script --type standalone --title "Tenmen — $CREATE_NAME"

  mv .clasp.json "$CLASP_FILE"
  echo "Saved project config to $CLASP_FILE"

  git checkout -- appsscript.json

  echo ""
  echo "Project '$CREATE_NAME' created. Deploy with: ./deploy.sh"
  exit 0
fi

# --- Open editor ---

if [ "$ACTION" = "open" ]; then
  CLASP_FILE=$(find_clasp_config)
  cd "$PLANNING_DIR"
  cp "$CLASP_FILE" .clasp.json
  npx clasp open-script
  rm -f .clasp.json
  exit 0
fi

# --- Deploy ---

CLASP_FILE=$(find_clasp_config)
APP_NAME=$(basename "$CLASP_FILE" .clasp.json)

cd "$PLANNING_DIR"
cp "$CLASP_FILE" .clasp.json
trap 'rm -f "$PLANNING_DIR/.clasp.json"' EXIT

echo "Deploying '$APP_NAME'..."
echo ""

echo "Pushing to Apps Script..."
npx clasp push --force

echo "Checking existing deployments..."
DEPLOY_OUTPUT=$(npx clasp list-deployments 2>&1)

DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | grep -v '@HEAD' | grep -oE '^\- [^ ]+' | sed 's/^- //' | head -1 || true)

if [ -n "$DEPLOY_ID" ]; then
  echo "Updating deployment $DEPLOY_ID..."
  npx clasp create-deployment -i "$DEPLOY_ID" -d "$APP_NAME $(date '+%Y-%m-%d %H:%M')"
else
  echo "Creating first deployment..."
  DEPLOY_OUTPUT=$(npx clasp create-deployment -d "$APP_NAME $(date '+%Y-%m-%d %H:%M')" 2>&1)
  echo "$DEPLOY_OUTPUT"
  DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | grep -oE '^\- [^ ]+' | sed 's/^- //' | head -1 || true)
fi

if [ -n "$DEPLOY_ID" ]; then
  URL=$(build_url "$DEPLOY_ID")
  echo "$URL" > "$DEPLOYMENTS_DIR/webapp-url"
  echo ""
  echo "Web app URL: $URL"
else
  echo ""
  echo "Warning: Could not determine deployment ID."
fi

echo ""
echo "Done."
