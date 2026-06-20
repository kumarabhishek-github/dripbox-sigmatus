# dripbox

Self-hosted, multi-step email outreach with open/click/reply tracking and a built-in CRM pipeline. Sends over plain **SMTP** (e.g. a Gmail App Password) and detects replies via **IMAP** polling. No OAuth, no third-party sending service — your mailbox, your data, one SQLite file.

> Think drip campaigns + a lightweight sales CRM you can run on a $0 VM.

## Features

- **Multi-step campaigns** with day-offset scheduling (intro → follow-up → break-up, etc.)
- **SMTP sending** using a Gmail/Workspace App Password (or any SMTP server)
- **Open & click tracking** (1×1 pixel for HTML; "view online" footer link for plaintext)
- **Reply detection** via IMAP polling, matched on `In-Reply-To` / `References` headers
- **Optional email threading** — follow-ups chain onto the original thread
- **Unsubscribe** via a reply keyword (cascade-stops every active enrollment for that contact)
- **CRM pipeline** — `new → contacted → opened → replied → interested → registered → lost`, auto-advancing on send/open/reply events
- **Per-campaign stats** — open / click / reply / unsubscribe rates, plus per-step and per-recipient drill-down
- **HTML *and* plaintext templates**, authored in-app with Jinja2 merge fields
- **Send pacing** — daily cap, per-send jitter, per-tick cap, and a business-hours window
- **Nightly SQLite backups** with retention

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI · SQLAlchemy · SQLite · APScheduler · Jinja2 |
| Frontend | React · Vite · TypeScript · Tailwind |
| Mail | SMTP (send) + IMAP (reply detection) |

## Quick start

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then edit .env (see Configuration)
uvicorn app.main:app --reload --port 8000
```

Verify the mail connection:

```bash
curl http://localhost:8000/api/health/email
# {"smtp_ok": true, "imap_ok": true, ...}
```

### Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173 (proxies /api to :8000)
```

For production, `npm run build` emits `frontend/dist`, which the backend serves at `/` automatically — so a single process serves both the API and the UI on port 8000.

### Docker

```bash
cp backend/.env.example backend/.env   # edit it first
docker compose up --build              # serves the whole app on http://localhost:8000
```

The SQLite database and backups persist in a named volume (`dripbox-data`).

## Gmail App Password setup

dripbox sends over SMTP — no OAuth. On the Google account you'll send from:

1. Enable **2-Factor Authentication**.
2. Go to <https://myaccount.google.com/apppasswords>, generate a 16-character app password, and put it in `.env`:
   ```
   SMTP_USERNAME=you@example.com
   SMTP_PASSWORD=your-16-char-app-password
   SENDER_EMAIL=you@example.com        # or an alias if "Send mail as" is configured
   SENDER_NAME=Your Name
   ```
3. The same credentials are reused for IMAP unless you set `IMAP_USERNAME` / `IMAP_PASSWORD` explicitly.

Any SMTP/IMAP provider works — just point the `SMTP_*` / `IMAP_*` keys at it.

## Deliverability (custom domains)

If you send from a custom domain, publish standard authentication records so mail doesn't land in spam:

- **SPF** (TXT at the apex): `v=spf1 include:_spf.google.com ~all` (adjust the `include:` for your provider)
- **DKIM**: enable in your mail provider's admin console and publish the TXT record it gives you
- **DMARC** (TXT at `_dmarc.yourdomain`): start in monitor mode — `v=DMARC1; p=none; rua=mailto:postmaster@yourdomain`

After sending a test, open Gmail's **Show original** and confirm SPF, DKIM, and DMARC all `PASS`.

## Usage walkthrough

1. Configure `backend/.env` with SMTP/IMAP credentials.
2. Start the app; in **Settings**, confirm the email connection is green. (Most settings are also editable from the UI.)
3. On **Templates**, create a template (HTML or plaintext) with Jinja2 fields — `{{ name }}`, `{{ unsubscribe_keyword }}`, plus any custom contact fields.
4. On **Campaigns**, create a campaign and add steps (template + day offset between each).
5. On **Contacts**, add contacts (manually or via the API) and enroll them in a campaign.
6. The scheduler ticks every minute and sends within the configured window. Watch results on the **Campaign Detail** page — per-recipient timelines show every send, open, click, and reply.

## Configuration

All keys live in `backend/.env` (see `backend/.env.example`).

### SMTP / IMAP

| Key | Default | Notes |
| --- | --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` | |
| `SMTP_PORT` | `587` | STARTTLS |
| `SMTP_USERNAME` | _(none)_ | Sending mailbox |
| `SMTP_PASSWORD` | _(none)_ | App password / SMTP password |
| `SMTP_USE_TLS` | `true` | |
| `IMAP_HOST` | `imap.gmail.com` | |
| `IMAP_PORT` | `993` | |
| `IMAP_USERNAME` | _(falls back to `SMTP_USERNAME`)_ | |
| `IMAP_PASSWORD` | _(falls back to `SMTP_PASSWORD`)_ | |
| `SENDER_EMAIL` | _(falls back to `SMTP_USERNAME`)_ | Use an alias if "Send mail as" is set up |
| `SENDER_NAME` | `Me` | Display name in the `From` header |

### App

| Key | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./data/app.db` | |
| `BASE_URL` | `http://localhost:8000` | Public base used for tracking links — must be reachable by recipients for opens/clicks to register |
| `TRACKING_SECRET` | `change-me` | HMAC secret for signed redirect links — **rotate this** |
| `UNSUBSCRIBE_KEYWORD` | `unsubscribe` | Must be the entire content of a line in the *new* reply text (after quote stripping) |
| `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` | _(blank)_ | Optional Basic-Auth gate for the UI + API. Tracking endpoints stay public. Both blank = disabled |

### Send pacing

| Key | Default | Notes |
| --- | --- | --- |
| `DAILY_SEND_CAP` | `100` | Max emails per UTC day across all campaigns |
| `MAX_SENDS_PER_TICK` | `5` | Keeps a single scheduler tick short |
| `SEND_JITTER_MIN_SECONDS` | `2` | Min delay between consecutive sends in a tick |
| `SEND_JITTER_MAX_SECONDS` | `10` | Max delay between consecutive sends in a tick |
| `SEND_AT_JITTER_MINUTES` | `30` | Per-contact `send_at` jitter applied at enrollment time |

### Business hours

| Key | Default | Notes |
| --- | --- | --- |
| `SEND_WINDOW_ENABLED` | `true` | If false, sends fire any time |
| `SEND_TIMEZONE` | `America/New_York` | IANA timezone name |
| `SEND_HOUR_START` | `9` | Inclusive, 0–23 |
| `SEND_HOUR_END` | `18` | Exclusive, 0–23 |
| `SEND_WEEKDAYS_ONLY` | `true` | Mon–Fri only when true |

Reply polling is not affected by the business-hours window. To disable pacing entirely, set the jitter values to `0` and `SEND_WINDOW_ENABLED=false`.

### Backups

| Key | Default | Notes |
| --- | --- | --- |
| `BACKUP_ENABLED` | `true` | Nightly snapshot of `app.db` |
| `BACKUP_DIR` | `data/backups` | Relative to the backend cwd |
| `BACKUP_HOUR_UTC` | `21` | Hour (0–23, UTC) the cron fires |
| `BACKUP_RETAIN` | `14` | Most recent N snapshots kept |

Snapshots use SQLite's online backup API, so they're consistent even mid-write.

## How tracking works

- **Opens (HTML)** — a 1×1 pixel is embedded at the end of the body.
- **Opens (plaintext)** — pixels can't render, so a "View this email online" link is appended; clicking it records an open and 302-redirects to `BASE_URL`.
- **Clicks** — outbound links (HTML `<a href>` or bare `https://` URLs in plaintext) are rewritten to signed redirect URLs that record the click before forwarding.
- **Replies** — IMAP is polled every 5 minutes; inbound messages are matched to tracked outbound `Message-ID`s via `In-Reply-To` / `References` and advance the enrollment/contact stage.
- **Unsubscribe** — the quoted original is stripped from the reply, then `UNSUBSCRIBE_KEYWORD` must be the entire content of a line in what the recipient actually typed (avoids false positives from your own footer).

## Stages

Two deliberately separate stage concepts:

- **Recipient stage** (`Enrollment.stage`): engagement state for *one* campaign — `pending → sent → opened → replied`. `replied` stops that enrollment's remaining sends; other campaigns for the same contact keep running.
- **Contact CRM stage** (`Contact.stage`): `new → contacted → opened → replied → interested → registered → lost`. Auto-advances on the early events; `interested` / `registered` / `lost` are manual-only and stop auto-advance. Moving a contact to `registered`/`lost`, or unsubscribing, cascade-stops every active enrollment.

## Sending limits

Gmail/Workspace SMTP is capped at roughly 500–2,000 recipients/day depending on account type. The default `DAILY_SEND_CAP=100` keeps you well under that and reduces spam-flag risk on a warming domain. An App Password doesn't change the underlying quota.

## Deployment

The whole app is one process (FastAPI serving the API + built frontend on port 8000), so it runs comfortably on a small VM or any container host.

- **Docker** — `docker compose up --build` (see [Docker](#docker) above). Simplest option.
- **Bare VM** — the scripts in [`deploy/`](deploy/) are an example for a single Debian VM:
  - `deploy/setup_vm.sh` — idempotent provisioner: installs Python + Node, builds the app, registers a `dripbox` systemd service.
  - `deploy/setup_caddy.sh` — installs Caddy as a reverse proxy with automatic Let's Encrypt TLS: `sudo DOMAIN=mail.example.com bash deploy/setup_caddy.sh`.
  - `deploy/deploy.sh` — example GCP Compute Engine push-deploy (override `GCP_PROJECT` / `GCP_ZONE` / `GCP_INSTANCE`).
  - `.github/workflows/deploy.yml` — an example GitHub Actions deploy, **manual-trigger only**; `deploy/setup_github_actions.sh` provisions the deploy service account.

Whatever you choose, set `BASE_URL` to the public URL (tracking links must resolve for recipients) and rotate `TRACKING_SECRET`.

## Project structure

```
dripbox/
├── backend/
│   ├── app/
│   │   ├── api/          # Route handlers
│   │   ├── campaigns/    # Send logic + scheduler
│   │   ├── crm/          # CRM stage logic
│   │   ├── gmail/        # SMTP send + IMAP poll
│   │   ├── tracking/     # Open/click endpoints
│   │   ├── models.py     # SQLAlchemy models
│   │   └── main.py       # FastAPI entry point
│   ├── templates/        # Jinja2 HTML email templates
│   └── requirements.txt
├── frontend/             # React + Vite app
├── deploy/               # Example VM / Caddy / CI deploy scripts
└── docker-compose.yml
```

## Roadmap / out of scope

- A/B testing
- Multi-user auth & roles
- Attachments
- Webhooks
- `List-Unsubscribe` one-click header
- Bounce processing / auto-suppression
- Mailbox rotation

## License

[MIT](LICENSE)
