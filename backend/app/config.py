from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./data/app.db"
    BASE_URL: str = "http://localhost:8000"

    # SMTP (sending)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = True

    # IMAP (reply polling)
    IMAP_HOST: str = "imap.gmail.com"
    IMAP_PORT: int = 993
    IMAP_USERNAME: Optional[str] = None
    IMAP_PASSWORD: Optional[str] = None

    # From header
    SENDER_EMAIL: Optional[str] = None
    SENDER_NAME: str = "Me"

    DAILY_SEND_CAP: int = 100
    TRACKING_SECRET: str = "change-me"
    UNSUBSCRIBE_KEYWORD: str = "unsubscribe"

    # Basic auth gate for the UI + /api/*. Both blank disables it.
    BASIC_AUTH_USERNAME: str = ""
    BASIC_AUTH_PASSWORD: str = ""

    # Random delay between consecutive sends in a tick, to avoid looking automated. Set both to 0 to disable.
    SEND_JITTER_MIN_SECONDS: int = 2
    SEND_JITTER_MAX_SECONDS: int = 10
    # Per-send send_at jitter (minutes) applied at enrollment time so step send times aren't on round boundaries. 0 = no jitter.
    SEND_AT_JITTER_MINUTES: int = 30
    # Safety cap: max sends processed per tick to prevent a single tick from blocking too long.
    MAX_SENDS_PER_TICK: int = 5

    # Business-hours sending window. Sends are only dispatched within this window.
    # Reply polling is not affected.
    SEND_WINDOW_ENABLED: bool = True
    SEND_TIMEZONE: str = "Asia/Kolkata"  # IANA tz name
    SEND_HOUR_START: int = 9   # inclusive, 0-23
    SEND_HOUR_END: int = 18    # exclusive, 0-23
    SEND_WEEKDAYS_ONLY: bool = True

    # Nightly SQLite backup
    BACKUP_ENABLED: bool = True
    BACKUP_DIR: str = "data/backups"
    BACKUP_HOUR_UTC: int = 21   # 21:00 UTC = 02:30 IST
    BACKUP_RETAIN: int = 14     # keep N most recent snapshots

    @property
    def imap_username(self) -> str:
        return self.IMAP_USERNAME or self.SMTP_USERNAME

    @property
    def imap_password(self) -> str:
        return self.IMAP_PASSWORD or self.SMTP_PASSWORD

    @property
    def sender_email(self) -> str:
        return self.SENDER_EMAIL or self.SMTP_USERNAME


settings = Settings()
