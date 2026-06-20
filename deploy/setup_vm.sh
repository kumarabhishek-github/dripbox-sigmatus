#!/usr/bin/env bash
# Run on a fresh Debian 12 e2-micro VM as root (gcloud startup script or via SSH).
# Installs Python, Node, builds the app, and registers it as a systemd service.

set -euo pipefail

APP_DIR="/opt/dripbox"
APP_USER="dripbox"
SOURCE_DIR="${SOURCE_DIR:-/tmp/email-dripbox}"

apt-get update
apt-get install -y python3 python3-venv python3-pip git curl ca-certificates rsync

# Node 20 from NodeSource
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Service user
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$APP_USER"
fi

# Sync code from SOURCE_DIR (uploaded via gcloud scp) to APP_DIR
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude=".venv" \
  --exclude="node_modules" \
  --exclude="frontend/dist" \
  --exclude="backend/.env" \
  --exclude="backend/data/app.db" \
  --exclude="backend/data/app.log*" \
  --exclude="backend/data/backups" \
  "$SOURCE_DIR/" "$APP_DIR/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# Backend deps
sudo -u "$APP_USER" bash <<'EOSU'
set -euo pipefail
cd /opt/dripbox/backend
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
EOSU

# Frontend build
sudo -u "$APP_USER" bash <<'EOSU'
set -euo pipefail
cd /opt/dripbox/frontend
npm ci
npm run build
EOSU

# Default .env (only if missing)
if [ ! -f "$APP_DIR/backend/.env" ]; then
  cp "$APP_DIR/backend/.env.example" "$APP_DIR/backend/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/backend/.env"
fi

# systemd unit
cat > /etc/systemd/system/dripbox.service <<UNIT
[Unit]
Description=dripbox
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=$APP_DIR/backend/.env
ExecStart=$APP_DIR/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable dripbox.service
# Always restart so a code change actually takes effect (enable --now is a no-op
# if the unit is already running).
systemctl restart dripbox.service
systemctl status dripbox.service --no-pager | tail -15 || true

echo "Setup complete. App listening on port 8000."
