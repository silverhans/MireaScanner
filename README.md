# MireaScanner

Telegram Mini App для студентов МИРЭА.

<img width="177" height="381" alt="Главная" src="https://github.com/user-attachments/assets/a18cb1ba-23bb-4edf-916c-95ba4bffdc3e" />
<img width="177" height="381" alt="БРС" src="https://github.com/user-attachments/assets/4992eae7-e6f8-4e82-8fb3-f0b0e2da9140" />
<img width="177" height="381" alt="Расписание" src="https://github.com/user-attachments/assets/c6f0385a-b175-4c5a-88c1-88e4ae34dc53" />

## Возможности

- **Сканер QR** — отметка посещаемости за себя и до 20 друзей одним сканом
- **Расписание** — поиск по группе, преподавателю, аудитории
- **БРС** — баллы по дисциплинам, режим «Идеальная посещаемость», детальная посещаемость
- **Пропуск** — события входа/выхода через турникеты за день (ACS)
- **Карты** — интерактивные схемы корпусов с поиском аудиторий
- **Киберзона** — бронирование места в компьютерном зале
- **Друзья** — совместная отметка, профили, заявки

## Стек

- **Backend:** Python 3.11+, aiogram, aiohttp, SQLAlchemy (async)
- **Database:** SQLite (по умолчанию) или PostgreSQL
- **Frontend:** React 18 + Vite (Telegram Mini App)
- **Cache/queue:** Redis (опционально, для multi-worker режима)
- **C++ модули:** опциональные бинарники для ускорения парсинга protobuf/UUID/зон

## Структура репозитория

```
bot/              — Telegram-бот и HTTP API (/api/*)
webapp/           — Mini App (React/Vite)
attendance_core/  — C++ модуль расчёта потолка посещаемости
uuid_core/        — C++ модуль извлечения UUID из protobuf
zone_core/        — C++ модуль классификации зон ACS
protobuf_core/    — C++ модуль парсинга protobuf-полей
scripts/          — деплой, rollback, миграции, smoke-тесты, backup
ops/systemd/      — systemd unit/timer для backup
```

---

## Self-hosting

### Требования

- Python 3.11+
- Node.js 20+
- Telegram Bot Token ([получить у @BotFather](https://t.me/BotFather))
- Публичный HTTPS домен (Telegram требует HTTPS для Mini App)

### 1. Клонирование и настройка окружения

```bash
git clone https://github.com/silverhans/MireaScanner.git
cd MireaScanner

python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Конфигурация

```bash
cp .env.example .env
```

Минимальный `.env` для запуска:

```env
BOT_TOKEN=your_telegram_bot_token
WEBAPP_URL=https://your-domain.com
SESSION_KEYS=your_random_secret_32chars
```

Полный список переменных — в `.env.example`.

### 3. База данных

По умолчанию используется SQLite — ничего дополнительно настраивать не нужно.

```bash
python scripts/db_migrate.py --apply
```

Для PostgreSQL добавь в `.env`:

```env
DATABASE_URL=postgresql+asyncpg://user:password@localhost/dbname
```

### 4. Сборка webapp

```bash
cd webapp
npm install
npm run build
cd ..
```

Собранные файлы окажутся в `webapp/dist/`.

### 5. Запуск

```bash
python -m bot.main
```

Бот запустится и поднимет HTTP API на `http://0.0.0.0:8080`.

---

## Настройка nginx + SSL

Пример конфига `/etc/nginx/sites-available/mireascanner`:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Mini App (статика)
    location / {
        root /path/to/MireaScanner/webapp/dist;
        try_files $uri $uri/ /index.html;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
```

SSL через Certbot:

```bash
certbot --nginx -d your-domain.com
```

---

## Systemd (автозапуск)

```ini
# /etc/systemd/system/mireascanner.service
[Unit]
Description=MireaScanner Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/MireaScanner
ExecStart=/path/to/MireaScanner/venv/bin/python -m bot.main
EnvironmentFile=/path/to/MireaScanner/.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now mireascanner
```

---

## Multi-worker режим (опционально)

Для production при высокой нагрузке можно запустить несколько воркеров с Redis-очередью:

```env
REDIS_URL=redis://localhost:6379/0
WORKER_COUNT=3
```

Каждый воркер запускается на отдельном порту (8080, 8081, 8082). Nginx балансирует между ними через `upstream`.

---

## C++ модули (опционально)

Ускоряют парсинг protobuf и классификацию зон ACS. Python-фолбек всегда активен — без них всё работает.

**Сборка:**

```bash
# Требуется g++ с поддержкой C++17
make build
```

`make build` автоматически скачивает `nlohmann/json` и компилирует все модули.
Для очистки: `make clean`.

**Включение в `.env`:**

```env
ATTENDANCE_CORE_ENABLED=true
ATTENDANCE_CORE_BIN=./attendance_core/attendance_core_cpp

UUID_CORE_ENABLED=true
UUID_CORE_BIN=./uuid_core/uuid_core

ZONE_CORE_ENABLED=true
ZONE_CORE_BIN=./zone_core/zone_core

PROTOBUF_CORE_ENABLED=true
PROTOBUF_CORE_BIN=./protobuf_core/protobuf_core
```

---

## Деплой скриптами

В `scripts/` есть скрипты для zero-downtime деплоя с автобэкапом:

```bash
# Деплой
QRS_HOST=your-server-ip bash scripts/remote_deploy.sh

# Откат к предыдущей версии
QRS_HOST=your-server-ip bash scripts/remote_rollback.sh latest
```

---

## Безопасность

- Сессии МИРЭА хранятся в БД **в зашифрованном виде** (`SESSION_KEYS`)
- Пароли **не хранятся** — используются только для получения cookies, затем удаляются
- Поддержка ротации ключей шифрования
- Все запросы к API проходят верификацию Telegram `initData` через HMAC-SHA256

---

## Лицензия

[MIT](LICENSE) © silverhans
