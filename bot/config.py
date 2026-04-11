from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    bot_token: str
    webapp_url: str
    database_url: str = "sqlite+aiosqlite:///./data/bot.db"
    # Bind address for the internal HTTP API server.
    # In production behind Nginx, prefer 127.0.0.1 to avoid exposing the port publicly.
    api_bind_host: str = "0.0.0.0"
    api_port: int = 8080
    # Прокси для всех запросов к МИРЭА (мобильный IP)
    mirea_proxy: str | None = None
    # Secret key for JWT tokens (used by jwt_auth utilities).
    jwt_secret: str | None = None
    # Secret(s) for encrypting user sessions in the DB (recommended).
    # Comma-separated values; first is used for encryption, all are tried for decryption.
    session_keys: str | None = None
    # Global throttling for attendance marking (protects service during peaks).
    # "Concurrent" limits in-flight mark operations to MIREA. "RPS" smooths bursts.
    attendance_max_concurrent: int = 150
    attendance_max_rps: float = 25.0
    # Max time to wait in the global queue before failing fast (seconds).
    attendance_queue_timeout_s: float = 55.0
    # Per-request parallelism when marking for friends (inside one scan request).
    attendance_per_request_concurrent: int = 8
    # Optional Rust attendance core integration for attendance cap estimation.
    # Safe defaults: disabled, Python logic remains primary.
    attendance_core_enabled: bool = False
    # If enabled + shadow mode, Rust result is computed only for comparison/logging.
    attendance_core_shadow: bool = True
    attendance_core_bin: str = "./attendance_core/attendance_core_cpp"
    attendance_core_timeout_s: float = 1.2
    # Optional C++ protobuf field parser.
    protobuf_core_enabled: bool = False
    protobuf_core_bin: str = "./protobuf_core/protobuf_core"
    protobuf_core_timeout_s: float = 0.5
    # Optional C++ UUID extractor.
    uuid_core_enabled: bool = False
    uuid_core_bin: str = "./uuid_core/uuid_core"
    uuid_core_timeout_s: float = 0.5
    # Optional C++ zone classifier.
    zone_core_enabled: bool = False
    zone_core_bin: str = "./zone_core/zone_core"
    zone_core_timeout_s: float = 0.8
    # Optional token for accessing detailed health metrics.
    # If unset, /api/health/details will be disabled (404).
    health_details_token: str | None = None
    # Redis URL for shared throttle and session cache (optional).
    # If unset, falls back to in-process throttle (single-worker mode).
    redis_url: str | None = None
    # Number of aiohttp worker processes (1 = single process, no Redis needed).
    worker_count: int = 1
    # Feature flags (kill-switches) for external modules.
    feature_grades_enabled: bool = True
    feature_acs_enabled: bool = True
    feature_schedule_enabled: bool = True

    class Config:
        env_file = ".env"


settings = Settings()
