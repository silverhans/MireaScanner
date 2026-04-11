"""Async helper for calling C++ binary modules via stdin/stdout JSON."""

from __future__ import annotations

import asyncio
import json
import logging

logger = logging.getLogger(__name__)


async def run_cpp_module(
    bin_path: str,
    payload: dict,
    *,
    timeout_s: float = 1.0,
    label: str = "cpp_module",
) -> dict | None:
    """Run a C++ binary, send *payload* as JSON on stdin, return parsed JSON from stdout.

    Returns None on any error (timeout, non-zero exit, parse failure) so callers
    can transparently fall back to the Python implementation.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            bin_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdin_data = json.dumps(payload).encode()
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(stdin_data), timeout=timeout_s
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            logger.warning("%s: timed out after %.1fs", label, timeout_s)
            return None

        if proc.returncode != 0:
            logger.warning(
                "%s: exited with code %d: %s",
                label,
                proc.returncode,
                stderr.decode(errors="replace")[:200],
            )
            return None

        return json.loads(stdout)
    except FileNotFoundError:
        logger.warning("%s: binary not found: %s", label, bin_path)
        return None
    except Exception as exc:
        logger.warning("%s: unexpected error: %s", label, exc)
        return None
