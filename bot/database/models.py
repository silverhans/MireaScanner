from datetime import datetime
from sqlalchemy import BigInteger, Boolean, String, ForeignKey, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bot.database import Base


class User(Base):
    """Пользователь бота"""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str] = mapped_column(String(255))

    # Данные авторизации МИРЭА (зашифрованные)
    mirea_session: Mapped[str | None] = mapped_column(Text, nullable=True)
    mirea_login: Mapped[str | None] = mapped_column(String(255), nullable=True)
    share_mirea_login: Mapped[bool] = mapped_column(Boolean, default=False)
    # Время последней подтвержденной успешной синхронизации с сервисами МИРЭА.
    last_mirea_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Esports (киберзона) JWT-сессия (зашифрованная)
    esports_session: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Персональные настройки поведения в мини-приложении.
    mark_with_friends_default: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_select_favorites: Mapped[bool] = mapped_column(Boolean, default=True)
    haptics_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    light_theme_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    theme_mode: Mapped[str | None] = mapped_column(String(20), nullable=True, default=None)
    visible_tabs: Mapped[str | None] = mapped_column(String(500), nullable=True, default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Friend(Base):
    """Связь друзей для совместной отметки (макс 20 человек)"""
    __tablename__ = "friends"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Кто отправил запрос
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # Кому отправлен запрос
    friend_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # Статус: pending, accepted, rejected
    status: Mapped[str] = mapped_column(String(20), default="pending")
    # Избранный друг (автоматически включается при отметке)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Связи
    user: Mapped["User"] = relationship(foreign_keys=[user_id], backref="sent_friend_requests")
    friend: Mapped["User"] = relationship(foreign_keys=[friend_id], backref="received_friend_requests")


class AttendanceLog(Base):
    """Лог отметок посещаемости"""
    __tablename__ = "attendance_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    qr_data: Mapped[str] = mapped_column(Text)  # Данные из QR-кода
    success: Mapped[bool] = mapped_column(default=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
