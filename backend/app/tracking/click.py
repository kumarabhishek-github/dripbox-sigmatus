from __future__ import annotations

from itsdangerous import URLSafeTimedSerializer, BadSignature

from ..config import settings


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.TRACKING_SECRET, salt="click")


def sign_url(url: str) -> str:
    return _serializer().dumps(url)


def unsign_url(signed: str, max_age: int = 60 * 60 * 24 * 365) -> str:
    try:
        return _serializer().loads(signed, max_age=max_age)
    except BadSignature as e:
        raise ValueError("Invalid signature") from e
