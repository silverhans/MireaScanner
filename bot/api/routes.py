from __future__ import annotations

from aiohttp import web

from bot.api.acs import handle_get_acs_events
from bot.api.attendance import handle_mark_attendance
from bot.api.auth import (
    handle_auth_2fa,
    handle_auth_login,
    handle_auth_logout,
    handle_auth_status,
    handle_delete_account,
)
from bot.api.esports import (
    handle_esports_book,
    handle_esports_bookings,
    handle_esports_cancel,
    handle_esports_config,
    handle_esports_login,
    handle_esports_logout,
    handle_esports_slots,
    handle_esports_status,
)
from bot.api.friends import (
    handle_accept_friend,
    handle_get_friend_profile,
    handle_get_friends,
    handle_get_pending_friends,
    handle_reject_friend,
    handle_remove_friend,
    handle_send_friend_request,
    handle_toggle_friend_favorite,
)
from bot.api.attendance_detail import handle_get_attendance_detail
from bot.api.grades import handle_get_grades
from bot.api.health import handle_health, handle_health_details
from bot.api.profile import (
    handle_get_profile,
    handle_profile_connection_check,
    handle_update_profile_settings,
)
from bot.api.schedule import (
    handle_get_pulse_schedule,
    handle_get_schedule,
    handle_search_classrooms,
    handle_search_groups,
    handle_search_teachers,
)


def setup_routes(app: web.Application):
    """Настройка роутов API."""

    app.router.add_get("/api/health", handle_health)
    app.router.add_get("/api/health/details", handle_health_details)
    app.router.add_post("/api/attendance/mark", handle_mark_attendance)

    app.router.add_get("/api/profile", handle_get_profile)
    app.router.add_post("/api/profile/settings", handle_update_profile_settings)
    app.router.add_post("/api/profile/check-connection", handle_profile_connection_check)

    app.router.add_get("/api/auth/status", handle_auth_status)
    app.router.add_post("/api/auth/login", handle_auth_login)
    app.router.add_post("/api/auth/2fa", handle_auth_2fa)
    app.router.add_post("/api/auth/logout", handle_auth_logout)
    app.router.add_post("/api/auth/delete-account", handle_delete_account)

    app.router.add_get("/api/grades", handle_get_grades)
    app.router.add_get("/api/attendance/detail", handle_get_attendance_detail)

    app.router.add_get("/api/schedule", handle_get_schedule)
    app.router.add_get("/api/schedule/pulse", handle_get_pulse_schedule)
    app.router.add_get("/api/groups/search", handle_search_groups)
    app.router.add_get("/api/teachers/search", handle_search_teachers)
    app.router.add_get("/api/classrooms/search", handle_search_classrooms)

    app.router.add_get("/api/acs/events", handle_get_acs_events)

    app.router.add_get("/api/esports/status", handle_esports_status)
    app.router.add_post("/api/esports/login", handle_esports_login)
    app.router.add_post("/api/esports/logout", handle_esports_logout)
    app.router.add_get("/api/esports/config", handle_esports_config)
    app.router.add_get("/api/esports/slots", handle_esports_slots)
    app.router.add_post("/api/esports/book", handle_esports_book)
    app.router.add_get("/api/esports/bookings", handle_esports_bookings)
    app.router.add_post("/api/esports/cancel", handle_esports_cancel)

    app.router.add_get("/api/friends", handle_get_friends)
    app.router.add_get("/api/friends/profile", handle_get_friend_profile)
    app.router.add_get("/api/friends/pending", handle_get_pending_friends)
    app.router.add_post("/api/friends/send", handle_send_friend_request)
    app.router.add_post("/api/friends/accept", handle_accept_friend)
    app.router.add_post("/api/friends/reject", handle_reject_friend)
    app.router.add_post("/api/friends/remove", handle_remove_friend)
    app.router.add_post("/api/friends/toggle-favorite", handle_toggle_friend_favorite)
