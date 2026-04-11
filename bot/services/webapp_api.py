"""
Compatibility shim for legacy imports.

Historically, all WebApp handlers lived in this module. The API surface is now
split into `bot.api.*` modules. Keep `setup_routes` and a few helpers re-exported
so existing imports (and older deployments) keep working.
"""

from bot.api.common import redact_qr_data_for_log
from bot.api.routes import setup_routes


def _redact_qr_data_for_log(qr_data: str) -> str:
    return redact_qr_data_for_log(qr_data)


__all__ = ["setup_routes", "_redact_qr_data_for_log"]

