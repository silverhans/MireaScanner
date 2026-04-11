from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from urllib.parse import quote

import httpx
from aiohttp import web
from sqlalchemy import select

from bot.api.common import persist_session_if_current, verify_telegram_webapp_data
from bot.config import settings
from bot.database import async_session
from bot.database.models import User
from bot.services.crypto import get_crypto
from bot.services.mirea_grades import MireaGrades
from bot.utils.cache import cache
from bot.utils.upstreams import get_breaker

logger = logging.getLogger(__name__)


def _unfold_ical_lines(text: str) -> list[str]:
    lines = text.splitlines()
    unfolded: list[str] = []
    for line in lines:
        if line.startswith((" ", "\t")) and unfolded:
            unfolded[-1] += line[1:]
        else:
            unfolded.append(line)
    return unfolded


def _parse_ical_datetime(value: str) -> datetime | None:
    if not value:
        return None
    val = value.strip()
    if val.endswith("Z"):
        val = val[:-1]
    try:
        if "T" in val:
            return datetime.strptime(val, "%Y%m%dT%H%M%S")
        return datetime.strptime(val, "%Y%m%d")
    except Exception:
        return None


def _parse_ical_events(text: str) -> list[dict]:
    lines = _unfold_ical_lines(text)
    events: list[dict] = []
    current: dict | None = None

    for line in lines:
        if line == "BEGIN:VEVENT":
            current = {}
            continue
        if line == "END:VEVENT":
            if current:
                events.append(current)
            current = None
            continue
        if not current or ":" not in line:
            continue

        key, value = line.split(":", 1)
        key = key.split(";", 1)[0].upper()
        value = value.replace("\\n", "\n").strip()
        current[key] = value

    return events


SCHEDULE_API_BASE = "https://app-api.mirea.ninja"

_EXT_HTTP_LIMITS = httpx.Limits(max_connections=30, max_keepalive_connections=15, keepalive_expiry=10.0)


def _ext_client(timeout_s: float) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(float(timeout_s), connect=min(8.0, float(timeout_s))),
        transport=httpx.AsyncHTTPTransport(retries=2, limits=_EXT_HTTP_LIMITS),
    )


async def _schedule_get(url: str, *, params: dict | None = None, headers: dict | None = None, timeout_s: float = 30.0):
    """
    External schedule fetch wrapper with circuit breaker.
    Returns (response, error_message).
    """
    breaker = get_breaker("schedule_api")
    decision = await breaker.allow()
    if not decision.allowed:
        retry_after = decision.retry_after_s or 5
        return None, f"Расписание временно недоступно. Попробуйте через {retry_after} сек."

    try:
        async with _ext_client(timeout_s) as client:
            response = await client.get(url, params=params, headers=headers)
        if 500 <= int(response.status_code) <= 599:
            await breaker.record_failure()
        else:
            await breaker.record_success()
        return response, None
    except httpx.TimeoutException:
        await breaker.record_failure()
        return None, "Сервис расписания не отвечает"
    except Exception:
        await breaker.record_failure()
        return None, "Ошибка сервиса расписания"


def _extract_group_info(item) -> dict | None:
    if isinstance(item, dict):
        name = item.get("name") or item.get("group") or item.get("title") or item.get("value")
        uid = item.get("uid") or item.get("id") or item.get("group_id")
        if name:
            return {"name": name, "uid": str(uid) if uid is not None else None}
    if isinstance(item, str):
        return {"name": item, "uid": None}
    return None


async def _search_groups(query: str) -> list[dict]:
    """Поиск групп по названию через university-app API."""

    cache_key = f"groups_search:{query}"
    cached = await cache.get(cache_key)
    if cached is not None:
        return cached

    results: list[dict] = []
    try:
        response, _err = await _schedule_get(
            f"{SCHEDULE_API_BASE}/api/v1/schedule/search/groups",
            params={"query": query},
            headers={"Accept": "application/json"},
            timeout_s=15.0,
        )
        if response is None:
            return results
        if response.status_code == 200:
            data = response.json()
            items = data.get("results", []) if isinstance(data, dict) else []
            for item in items:
                info = _extract_group_info(item)
                if info:
                    results.append(info)

        await cache.set(cache_key, results, ttl_seconds=3600)
    except Exception:
        pass
    return results


def _extract_classroom_info(item) -> dict | None:
    """Extract classroom info including campus (when present)."""
    if isinstance(item, dict):
        base = _extract_group_info(item)
        if not base:
            return None
        campus = item.get("campus")
        if isinstance(campus, dict):
            campus_name = campus.get("name")
            campus_short = campus.get("short_name")
            if campus_name or campus_short:
                base["campus"] = {
                    "name": campus_name,
                    "short_name": campus_short,
                }
        return base
    if isinstance(item, str):
        return {"name": item, "uid": None}
    return None


async def _search_teachers(query: str) -> list[dict]:
    """Поиск преподавателей по имени через university-app API."""
    results: list[dict] = []
    try:
        response, _err = await _schedule_get(
            f"{SCHEDULE_API_BASE}/api/v1/schedule/search/teachers",
            params={"query": query},
            headers={"Accept": "application/json"},
            timeout_s=15.0,
        )
        if response is None:
            return results
        if response.status_code == 200:
            data = response.json()
            items = data.get("results", []) if isinstance(data, dict) else []
            for item in items:
                info = _extract_group_info(item)
                if info:
                    results.append(info)
    except Exception:
        pass
    return results


async def _search_classrooms(query: str) -> list[dict]:
    """Поиск аудиторий по названию через university-app API."""
    results: list[dict] = []
    try:
        response, _err = await _schedule_get(
            f"{SCHEDULE_API_BASE}/api/v1/schedule/search/classrooms",
            params={"query": query},
            headers={"Accept": "application/json"},
            timeout_s=15.0,
        )
        if response is None:
            return results
        if response.status_code == 200:
            data = response.json()
            items = data.get("results", []) if isinstance(data, dict) else []
            for item in items:
                info = _extract_classroom_info(item)
                if info:
                    results.append(info)
    except Exception:
        pass
    return results


async def handle_search_groups(request: web.Request) -> web.Response:
    """Поиск групп по названию."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    if not settings.feature_schedule_enabled:
        return web.json_response({"success": True, "groups": []})

    query = (request.rel_url.query.get("q") or "").strip().upper()
    if len(query) < 2:
        return web.json_response({"success": True, "groups": []})

    groups = await _search_groups(query)
    return web.json_response({"success": True, "groups": groups})


async def handle_search_teachers(request: web.Request) -> web.Response:
    """Поиск преподавателей по имени."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    if not settings.feature_schedule_enabled:
        return web.json_response({"success": True, "teachers": []})

    query = (request.rel_url.query.get("q") or "").strip()
    if len(query) < 2:
        return web.json_response({"success": True, "teachers": []})

    teachers = await _search_teachers(query)
    return web.json_response({"success": True, "teachers": teachers})


async def handle_search_classrooms(request: web.Request) -> web.Response:
    """Поиск аудиторий по названию."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    if not settings.feature_schedule_enabled:
        return web.json_response({"success": True, "classrooms": []})

    query = (request.rel_url.query.get("q") or "").strip()
    if len(query) < 1:
        return web.json_response({"success": True, "classrooms": []})

    classrooms = await _search_classrooms(query)
    return web.json_response({"success": True, "classrooms": classrooms})


def _parse_dt(value: str | int | float | None) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        ts = value / 1000 if value > 1e12 else value
        try:
            return datetime.fromtimestamp(ts)
        except Exception:
            return None
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except Exception:
            pass
        for fmt in ("%Y-%m-%d %H:%M", "%d.%m.%Y %H:%M", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(raw, fmt)
            except Exception:
                continue
    return None


def _combine_date_time(date_str: str | None, time_str: str | None) -> datetime | None:
    if not date_str or not time_str:
        return None
    date_val = _parse_dt(date_str)
    if not date_val:
        for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d-%m-%Y"):
            try:
                date_val = datetime.strptime(date_str, fmt)
                break
            except Exception:
                continue
    if not date_val:
        return None
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            time_val = datetime.strptime(time_str, fmt).time()
            return datetime.combine(date_val.date(), time_val)
        except Exception:
            continue
    return None


def _extract_events(payload: dict | list) -> list[dict]:
    events: list[dict] = []

    def normalize_lesson(lesson: dict, day_date: str | None = None):
        if not isinstance(lesson, dict):
            return
        summary = (
            lesson.get("name")
            or lesson.get("title")
            or lesson.get("subject")
            or lesson.get("discipline")
            or lesson.get("summary")
            or "Занятие"
        )
        location = (
            lesson.get("location")
            or lesson.get("room")
            or lesson.get("auditory")
            or lesson.get("auditorium")
            or lesson.get("classroom")
        )
        teacher = lesson.get("teacher") or lesson.get("lecturer") or lesson.get("instructor")
        description = lesson.get("description") or ""
        if teacher and teacher not in description:
            description = f"{description}\n{teacher}".strip()

        start_raw = lesson.get("start") or lesson.get("start_time") or lesson.get("startTime")
        end_raw = lesson.get("end") or lesson.get("end_time") or lesson.get("endTime")
        date_raw = lesson.get("date") or lesson.get("day") or lesson.get("lesson_date") or day_date

        dt_start = _parse_dt(start_raw)
        dt_end = _parse_dt(end_raw)
        if not dt_start:
            dt_start = _combine_date_time(date_raw, start_raw)
        if not dt_end:
            dt_end = _combine_date_time(date_raw, end_raw)
        if not dt_start:
            return

        events.append(
            {
                "start": dt_start.isoformat(),
                "end": dt_end.isoformat() if dt_end else None,
                "summary": summary,
                "location": location,
                "description": description.strip() if description else "",
            }
        )

    def normalize_mirea_ninja_item(item: dict):
        if not isinstance(item, dict):
            return
        dates = item.get("dates") or []
        bells = item.get("lesson_bells") or {}
        start_time = bells.get("start_time")
        end_time = bells.get("end_time")
        subject = item.get("subject") or "Занятие"
        lesson_type = item.get("lesson_type")
        summary = f"{subject} ({lesson_type})" if lesson_type else subject

        teachers = []
        for teacher in item.get("teachers") or []:
            name = teacher.get("name") if isinstance(teacher, dict) else str(teacher)
            if name:
                teachers.append(name)

        rooms = []
        for room in item.get("classrooms") or []:
            if isinstance(room, dict):
                room_name = room.get("name")
                campus = room.get("campus", {})
                campus_name = None
                if isinstance(campus, dict):
                    campus_name = campus.get("short_name") or campus.get("name")
                if room_name:
                    rooms.append(f"{room_name} ({campus_name})" if campus_name else room_name)
            elif room:
                rooms.append(str(room))

        description = ""
        if teachers:
            description = "Преподаватели: " + ", ".join(teachers)

        for date_str in dates:
            dt_start = _combine_date_time(date_str, start_time)
            if not dt_start:
                continue
            dt_end = _combine_date_time(date_str, end_time)
            events.append(
                {
                    "start": dt_start.isoformat(),
                    "end": dt_end.isoformat() if dt_end else None,
                    "summary": summary,
                    "location": ", ".join(rooms) if rooms else None,
                    "description": description,
                }
            )

    def walk(obj):
        if isinstance(obj, list):
            for item in obj:
                walk(item)
            return
        if not isinstance(obj, dict):
            return
        if "lessons" in obj and isinstance(obj["lessons"], list):
            day_date = obj.get("date") or obj.get("day")
            for lesson in obj["lessons"]:
                normalize_lesson(lesson, day_date)
            return
        if "pairs" in obj and isinstance(obj["pairs"], list):
            day_date = obj.get("date") or obj.get("day")
            for lesson in obj["pairs"]:
                normalize_lesson(lesson, day_date)
            return
        if "data" in obj and isinstance(obj["data"], list):
            for item in obj["data"]:
                normalize_mirea_ninja_item(item)
            return
        if obj.get("type") == "__lesson_schedule__":
            normalize_mirea_ninja_item(obj)
            return
        if any(k in obj for k in ("start", "start_time", "startTime")):
            normalize_lesson(obj)
            return
        for key in ("schedule", "lessons", "days", "data", "items"):
            if key in obj:
                walk(obj[key])

    walk(payload)
    events.sort(key=lambda x: x["start"])
    return events


async def handle_get_schedule(request: web.Request) -> web.Response:
    """Получить расписание по группе / преподавателю / аудитории."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    if not settings.feature_schedule_enabled:
        return web.json_response({"success": False, "message": "Расписание временно отключено. Попробуйте позже."}, status=503)

    def derive_entity_name(kind: str, payload: dict) -> str | None:
        if not isinstance(payload, dict):
            return None
        data = payload.get("data")
        if not isinstance(data, list) or not data:
            return None
        for item in data:
            if not isinstance(item, dict):
                continue
            if kind == "teacher":
                teachers = item.get("teachers") or []
                for t in teachers:
                    if isinstance(t, dict) and t.get("name"):
                        return str(t.get("name"))
                    if isinstance(t, str) and t.strip():
                        return t.strip()
            if kind == "classroom":
                rooms = item.get("classrooms") or []
                for r in rooms:
                    if isinstance(r, dict) and r.get("name"):
                        return str(r.get("name"))
                    if isinstance(r, str) and r.strip():
                        return r.strip()
            if kind == "group":
                groups = item.get("groups") or []
                for g in groups:
                    if isinstance(g, str) and g.strip():
                        return g.strip()
        return None

    params = request.rel_url.query
    schedule_type = (params.get("type") or "group").strip().lower()
    url = (params.get("url") or "").strip()
    group_id = (params.get("group_id") or "").strip()
    uid = (params.get("uid") or "").strip()
    q = (params.get("q") or "").strip()
    group_query = (params.get("group") or params.get("group_name") or "").strip().upper()
    institute_id = (params.get("institute_id") or "auto").strip().lower()

    if url.startswith("webcal://"):
        url = "https://" + url[len("webcal://") :]

    if url:
        try:
            async with _ext_client(30.0) as client:
                response = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; MireaScanner/1.0)"})
            if response.status_code != 200:
                return web.json_response(
                    {"success": False, "message": f"Не удалось получить расписание (HTTP {response.status_code})"}
                )

            events_raw = _parse_ical_events(response.text)
            events: list[dict] = []
            for event in events_raw:
                dt_start = _parse_ical_datetime(event.get("DTSTART"))
                if not dt_start:
                    continue
                dt_end = _parse_ical_datetime(event.get("DTEND"))
                events.append(
                    {
                        "start": dt_start.isoformat(),
                        "end": dt_end.isoformat() if dt_end else None,
                        "summary": event.get("SUMMARY", ""),
                        "location": event.get("LOCATION", ""),
                        "description": event.get("DESCRIPTION", ""),
                    }
                )

            events.sort(key=lambda x: x["start"])
            return web.json_response({"success": True, "events": events, "source": url})
        except Exception:
            return web.json_response({"success": False, "message": "Ошибка получения расписания"})

    if schedule_type in ("", "group") and not group_query and not q and group_id and group_id.isdigit():
        inst = institute_id if institute_id.isdigit() else "1"
        url = f"https://english.mirea.ru/schedule/api/ical/{inst}/{group_id}"
        try:
            async with _ext_client(30.0) as client:
                response = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (compatible; MireaScanner/1.0)"})
            if response.status_code != 200:
                return web.json_response(
                    {"success": False, "message": f"Не удалось получить расписание (HTTP {response.status_code})"}
                )
            events_raw = _parse_ical_events(response.text)
            events: list[dict] = []
            for event in events_raw:
                dt_start = _parse_ical_datetime(event.get("DTSTART"))
                if not dt_start:
                    continue
                dt_end = _parse_ical_datetime(event.get("DTEND"))
                events.append(
                    {
                        "start": dt_start.isoformat(),
                        "end": dt_end.isoformat() if dt_end else None,
                        "summary": event.get("SUMMARY", ""),
                        "location": event.get("LOCATION", ""),
                        "description": event.get("DESCRIPTION", ""),
                    }
                )
            events.sort(key=lambda x: x["start"])
            return web.json_response({"success": True, "events": events, "source": url})
        except Exception:
            return web.json_response({"success": False, "message": "Ошибка получения расписания"})

    if schedule_type not in ("group", "teacher", "classroom"):
        return web.json_response({"success": False, "message": "Bad schedule type"}, status=400)

    try:
        resolved_name: str | None = None
        resolved_uid: str | None = uid or None
        resolved_campus: dict | None = None

        if schedule_type == "group":
            query_value = (group_query or q).strip().upper()
            if not resolved_uid and not query_value:
                return web.json_response({"success": False, "message": "Укажи название группы"}, status=400)

            if not resolved_uid:
                groups = await _search_groups(query_value)
                if not groups:
                    return web.json_response(
                        {
                            "success": False,
                            "message": "Группа не найдена. Проверь название (например ИКБО-01-23)",
                        },
                        status=404,
                    )

                normalized_query = query_value.replace(" ", "")
                for candidate in groups:
                    name = candidate.get("name") if isinstance(candidate, dict) else None
                    cand_uid = candidate.get("uid") if isinstance(candidate, dict) else None
                    if name and name.replace(" ", "").upper() == normalized_query:
                        resolved_name = name
                        resolved_uid = cand_uid
                        break
                if not resolved_uid:
                    first = groups[0]
                    if isinstance(first, dict):
                        resolved_name = first.get("name") or query_value
                        resolved_uid = first.get("uid")
                    else:
                        resolved_name = str(first)
                        resolved_uid = None
            else:
                resolved_name = query_value or None

            encoded_uid = quote(resolved_uid or resolved_name or "")
            response, err = await _schedule_get(
                f"{SCHEDULE_API_BASE}/api/v1/schedule/group/{encoded_uid}",
                headers={"Accept": "application/json"},
                timeout_s=30.0,
            )
            if response is None:
                return web.json_response({"success": False, "message": err or "Ошибка сервиса расписания"}, status=503)

        elif schedule_type == "teacher":
            query_value = (params.get("teacher") or q).strip()
            if not resolved_uid and not query_value:
                return web.json_response({"success": False, "message": "Укажи преподавателя"}, status=400)
            if not resolved_uid:
                teachers = await _search_teachers(query_value)
                if not teachers:
                    return web.json_response({"success": False, "message": "Преподаватель не найден"}, status=404)
                normalized_query = query_value.replace(" ", "").lower()
                for candidate in teachers:
                    name = candidate.get("name") if isinstance(candidate, dict) else None
                    cand_uid = candidate.get("uid") if isinstance(candidate, dict) else None
                    if name and name.replace(" ", "").lower() == normalized_query:
                        resolved_name = name
                        resolved_uid = cand_uid
                        break
                if not resolved_uid:
                    first = teachers[0]
                    if isinstance(first, dict):
                        resolved_name = first.get("name") or query_value
                        resolved_uid = first.get("uid")
                    else:
                        resolved_name = str(first)
                        resolved_uid = None
            else:
                resolved_name = query_value or None

            encoded_uid = quote(resolved_uid or resolved_name or "")
            response, err = await _schedule_get(
                f"{SCHEDULE_API_BASE}/api/v1/schedule/teacher/{encoded_uid}",
                headers={"Accept": "application/json"},
                timeout_s=30.0,
            )
            if response is None:
                return web.json_response({"success": False, "message": err or "Ошибка сервиса расписания"}, status=503)

        else:  # classroom
            query_value = (params.get("classroom") or params.get("room") or q).strip()
            if not resolved_uid and not query_value:
                return web.json_response({"success": False, "message": "Укажи аудиторию"}, status=400)
            if not resolved_uid:
                classrooms = await _search_classrooms(query_value)
                if not classrooms:
                    return web.json_response({"success": False, "message": "Аудитория не найдена"}, status=404)
                normalized_query = query_value.replace(" ", "").lower()
                for candidate in classrooms:
                    name = candidate.get("name") if isinstance(candidate, dict) else None
                    cand_uid = candidate.get("uid") if isinstance(candidate, dict) else None
                    if name and name.replace(" ", "").lower() == normalized_query:
                        resolved_name = name
                        resolved_uid = cand_uid
                        resolved_campus = candidate.get("campus") if isinstance(candidate, dict) else None
                        break
                if not resolved_uid:
                    first = classrooms[0]
                    if isinstance(first, dict):
                        resolved_name = first.get("name") or query_value
                        resolved_uid = first.get("uid")
                        resolved_campus = first.get("campus")
                    else:
                        resolved_name = str(first)
                        resolved_uid = None
            else:
                resolved_name = query_value or None

            encoded_uid = quote(resolved_uid or resolved_name or "")
            response, err = await _schedule_get(
                f"{SCHEDULE_API_BASE}/api/v1/schedule/classroom/{encoded_uid}",
                headers={"Accept": "application/json"},
                timeout_s=30.0,
            )
            if response is None:
                return web.json_response({"success": False, "message": err or "Ошибка сервиса расписания"}, status=503)

        if response.status_code != 200:
            return web.json_response(
                {"success": False, "message": f"Не удалось получить расписание (HTTP {response.status_code})"}
            )

        payload = response.json()
        events = _extract_events(payload)

        if not resolved_name:
            resolved_name = derive_entity_name(schedule_type, payload) or None

        entity: dict = {
            "type": schedule_type,
            "name": resolved_name,
            "uid": resolved_uid,
        }
        if resolved_campus:
            entity["campus"] = resolved_campus

        return web.json_response(
            {
                "success": True,
                "type": schedule_type,
                "entity": entity,
                "group": resolved_name if schedule_type == "group" else None,
                "events": events,
                "raw": payload if not events else None,
            }
        )

    except Exception:
        return web.json_response({"success": False, "message": "Ошибка получения расписания"})


# In-memory schedule cache: user_id -> (expire_ts, json_dict)
_schedule_cache: dict[int, tuple[float, dict]] = {}
_SCHEDULE_CACHE_TTL = 3600  # 1 hour


async def handle_get_pulse_schedule(request: web.Request) -> web.Response:
    """GET /api/schedule/pulse — расписание из Pulse (gRPC, авторизованное)."""

    init_data = request.headers.get("X-Telegram-Init-Data", "")
    user_data = verify_telegram_webapp_data(init_data, settings.bot_token)
    if not user_data:
        return web.json_response({"success": False, "message": "Unauthorized"}, status=401)

    tg_user = json.loads(user_data.get("user", "{}"))
    telegram_id = tg_user.get("id")

    async with async_session() as session:
        result = await session.execute(select(User).where(User.telegram_id == telegram_id))
        user = result.scalar_one_or_none()

        if not user or not user.mirea_session:
            return web.json_response(
                {"success": False, "message": "МИРЭА не подключена"},
                status=400,
            )

        crypto = get_crypto()
        stored_session = user.mirea_session
        cookies, rotated_session = crypto.decrypt_session_for_db(stored_session)
        session_blob_for_update = stored_session
        if rotated_session and rotated_session != stored_session:
            try:
                rotated_saved = await persist_session_if_current(
                    session,
                    user_id=user.id,
                    previous_session=stored_session,
                    updated_session=rotated_session,
                )
                if rotated_saved:
                    session_blob_for_update = rotated_session
                    await session.commit()
            except Exception:
                try:
                    await session.rollback()
                except Exception:
                    pass

        if not cookies:
            return web.json_response(
                {"success": False, "message": "Сессия МИРЭА истекла"},
                status=401,
            )

        days = int(request.rel_url.query.get("days", "7"))
        days = max(1, min(days, 14))

        # Check cache
        cached = _schedule_cache.get(user.id)
        if cached:
            expire_ts, cached_resp = cached
            if time.time() < expire_ts:
                return web.json_response(cached_resp)

        cookies_before = dict(cookies)
        svc = MireaGrades(cookies)
        schedule_result = await svc.get_schedule(days=days)
        await svc.close()

        # Persist updated cookies if changed
        if cookies != cookies_before:
            updated_session = crypto.encrypt_session(cookies)
            saved = await persist_session_if_current(
                session,
                user_id=user.id,
                previous_session=session_blob_for_update,
                updated_session=updated_session,
            )
            if saved:
                await session.commit()

        if not schedule_result.success:
            return web.json_response(
                {"success": False, "message": schedule_result.message}
            )

        events = []
        for lesson in (schedule_result.lessons or []):
            desc_parts = []
            if lesson.lesson_type:
                type_map = {"ПР": "Практика", "ЛЕК": "Лекция", "ЛАБ": "Лабораторная"}
                desc_parts.append(type_map.get(lesson.lesson_type, lesson.lesson_type))
            if lesson.teacher:
                desc_parts.append(lesson.teacher)
            if lesson.subgroup:
                desc_parts.append(lesson.subgroup)

            ev: dict = {
                "summary": lesson.name,
                "location": lesson.room,
                "description": "\n".join(desc_parts),
            }
            if lesson.start_epoch:
                ev["start"] = datetime.fromtimestamp(lesson.start_epoch, tz=timezone.utc).isoformat()
            else:
                ev["start"] = ""
            if lesson.end_epoch:
                ev["end"] = datetime.fromtimestamp(lesson.end_epoch, tz=timezone.utc).isoformat()
            events.append(ev)

        resp_data = {"success": True, "events": events}
        _schedule_cache[user.id] = (time.time() + _SCHEDULE_CACHE_TTL, resp_data)
        return web.json_response(resp_data)
