#!/usr/bin/env bash
# Install Caddy and configure it as a reverse proxy with auto Let's Encrypt TLS.
# Usage:  sudo DOMAIN=mail.example.com bash deploy/setup_caddy.sh

set -euo pipefail

DOMAIN="${DOMAIN:?DOMAIN env var required (e.g. mail.example.com)}"
UPSTREAM="${UPSTREAM:-127.0.0.1:8000}"

if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

cat > /etc/caddy/Caddyfile <<CADDYFILE
$DOMAIN {
  encode gzip
  reverse_proxy $UPSTREAM
}
CADDYFILE

systemctl reload caddy || systemctl restart caddy
systemctl enable caddy
systemctl status caddy --no-pager | tail -10 || true

echo "Caddy is provisioning a Let's Encrypt cert for $DOMAIN."
echo "First-time issuance can take 30-60s. Watch:  sudo journalctl -u caddy -f"
