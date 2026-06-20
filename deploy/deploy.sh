#!/usr/bin/env bash
# Push local code to the GCP VM and run the idempotent provisioning script.
# Safe to run repeatedly; preserves the VM's .env, SQLite db, and logs.
#
# Usage: ./deploy/deploy.sh
# Requires: gcloud authed as someone with Compute Admin on your-gcp-project.

set -euo pipefail

PROJECT="${GCP_PROJECT:-your-gcp-project}"
ZONE="${GCP_ZONE:-us-central1-a}"
INSTANCE="${GCP_INSTANCE:-dripbox}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR_NAME="$(basename "$REPO_ROOT")"
# Unique per-run filename so concurrent deployers (CI + a laptop) don't fight
# over /tmp ownership. The remote side cleans up after itself.
RUN_ID="$(date -u +%s)-$$"
TARBALL_LOCAL="/tmp/dripbox-deploy-$RUN_ID.tar.gz"
REMOTE_TARBALL_NAME="dripbox-deploy-$RUN_ID.tar.gz"

echo "==> Packaging $REPO_ROOT"
tar \
  --exclude="$REPO_DIR_NAME/backend/.venv" \
  --exclude="$REPO_DIR_NAME/backend/data/app.db" \
  --exclude="$REPO_DIR_NAME/backend/data/app.log*" \
  --exclude="$REPO_DIR_NAME/backend/data/backups" \
  --exclude="$REPO_DIR_NAME/backend/.env" \
  --exclude="$REPO_DIR_NAME/frontend/node_modules" \
  --exclude="$REPO_DIR_NAME/frontend/dist" \
  --exclude="$REPO_DIR_NAME/.git" \
  -czf "$TARBALL_LOCAL" -C "$(dirname "$REPO_ROOT")" "$REPO_DIR_NAME"

# scp into the SSH user's home dir (~). Avoids /tmp permission conflicts when
# different OS Login users (laptop vs CI service account) run deploys against
# the same VM.
echo "==> Uploading to $INSTANCE in $ZONE ($PROJECT)"
gcloud compute scp --zone="$ZONE" --project="$PROJECT" "$TARBALL_LOCAL" "$INSTANCE:~/$REMOTE_TARBALL_NAME" >/dev/null

echo "==> Running setup script on VM (this rebuilds, restarts the service)"
gcloud compute ssh "$INSTANCE" --zone="$ZONE" --project="$PROJECT" --command="
  set -e
  SRC_DIR=\$(mktemp -d -t dripbox-src.XXXXXX)
  tar -xzf ~/$REMOTE_TARBALL_NAME -C \$SRC_DIR --strip-components=1
  sudo SOURCE_DIR=\$SRC_DIR bash \$SRC_DIR/deploy/setup_vm.sh 2>&1 | tail -12
  rm -rf ~/$REMOTE_TARBALL_NAME \$SRC_DIR
"

rm -f "$TARBALL_LOCAL"

echo "==> Done."
echo "    Service: sudo systemctl status dripbox"
echo "    Logs:    tail -f /opt/dripbox/backend/data/app.log"
