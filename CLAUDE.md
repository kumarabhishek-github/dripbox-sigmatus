# dripbox — CLAUDE.md

FastAPI + React self-hosted email outreach tool. Sends via SMTP (e.g. Gmail App Password), detects replies via IMAP, tracks opens/clicks, and manages a CRM pipeline. SQLite-backed, single process.

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI, SQLite (SQLAlchemy), APScheduler, Jinja2 |
| Frontend | React + Vite + TypeScript + Tailwind |
| Mail | SMTP (send) + IMAP (reply polling) |

## Project Structure

```
dripbox/
├── backend/
│   ├── app/
│   │   ├── api/          # Route handlers (campaigns, contacts, templates, settings, crm, stats, tracking, auth)
│   │   ├── campaigns/    # Send logic, scheduler, enrollment, rendering, send window
│   │   ├── crm/          # CRM stage auto-advance logic
│   │   ├── gmail/        # SMTP send + IMAP poll
│   │   ├── tracking/     # Open/click tracking endpoints
│   │   ├── models.py     # SQLAlchemy models
│   │   ├── schemas.py    # Pydantic schemas
│   │   ├── db.py         # DB session
│   │   └── main.py       # FastAPI app entry point
│   ├── templates/        # Jinja2 HTML email templates  ← ADD NEW TEMPLATES HERE
│   ├── data/             # SQLite DB + logs (gitignored)
│   └── requirements.txt
├── frontend/
│   └── src/
├── deploy/               # Example VM / Caddy / CI deploy scripts
└── docker-compose.yml
```

## Commands

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev          # localhost:5173
npm run build        # outputs to frontend/dist (served by backend at /)
```

### Docker
```bash
docker compose up --build   # whole app on localhost:8000
```

## Key Models

| Model | Key fields |
|-------|-----------|
| `Template` | `name`, `file_path` (relative to `backend/templates/`), `subject_template` (Jinja2) |
| `Campaign` | `name`, `status`, `thread_emails`, steps (linked `CampaignStep`s) |
| `CampaignStep` | `campaign_id`, `template_id`, `day_offset`, `subject_template` |
| `Contact` | `email`, `name`, `stage`, `unsubscribed`, `custom_fields` |
| `Enrollment` | links Contact ↔ Campaign, tracks per-step state and recipient stage |

## Templates

HTML/plaintext email templates live in `backend/templates/` and use Jinja2 syntax.

**Required merge fields** (always include both):
- `{{ name }}` — recipient's display name
- `{{ unsubscribe_keyword }}` — populated from `UNSUBSCRIBE_KEYWORD` (default: `unsubscribe`)

**Optional fields**: any contact `custom_fields` key, available as `{{ that_key }}`.

After dropping a new `.html` file into `backend/templates/`, register it via the **Templates** page (name + subject line). Default examples (`intro.html`, `followup.html`, `breakup.html`) are seeded on first run by `app/seed.py`.

There's a Claude Code skill at `skills/email-template-writer/` for authoring human-sounding templates.

## Stages

Two deliberately separate stage concepts:

- **Recipient stage** (`Enrollment.stage`, enum `RecipientStage`): engagement state for *this campaign*. `pending → sent → opened → replied`. Auto-advances on send/open/reply. `replied` stops this enrollment's pending sends only; other active enrollments for the same contact keep running.
- **Contact CRM stage** (`Contact.stage`, enum `ContactStage`): `new → contacted → opened → replied → interested → registered → lost`. Auto-advances on the same events for early stages; `interested`/`registered`/`lost` are manual-only and stop auto-advance. Moving a contact to `registered`/`lost` — or unsubscribing — cascade-stops every active enrollment.

## Settings (DB-backed)

Most operational config lives in `Setting` rows (key/value JSON), editable from the Settings page, each falling back to the matching env var then to `config.Settings` defaults:

- Email creds (SMTP/IMAP/sender) — `settings_store.resolve_email_creds`.
- Sending schedule — `settings_store.resolve_scheduling` (`send_window_enabled`, `send_timezone`, `send_hour_start/end`, `send_weekdays_only`, `send_at_jitter_minutes`).
- Misc — `base_url`, `daily_send_cap`, `unsubscribe_keyword`.

## Unsubscribe

Contact-level only (`Contact.unsubscribed: bool`). Set when:
- A reply contains a line whose entire content equals the unsubscribe keyword (`gmail/replies.py`, after quote-stripping).
- Manually toggled from the Contacts page or the campaign Recipients table — both call `PATCH /api/contacts/{id}`, which also stops all active enrollments for that contact.

No `List-Unsubscribe` header / one-click link yet (see roadmap in README).

## Environment Variables

Critical `backend/.env` keys (full reference in `README.md` → Configuration):

```
SMTP_USERNAME=you@example.com
SMTP_PASSWORD=<16-char app password>
SENDER_NAME=Your Name
BASE_URL=http://localhost:8000   # public URL for tracking links
TRACKING_SECRET=<rotate this>
```
