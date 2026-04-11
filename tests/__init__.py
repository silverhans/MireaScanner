"""Unit tests for qrscaner.

Keep tests small, offline, and deterministic.
"""

import os

# Ensure Settings() can be constructed during imports.
os.environ.setdefault("BOT_TOKEN", "test-bot-token")
os.environ.setdefault("WEBAPP_URL", "https://example.test")

