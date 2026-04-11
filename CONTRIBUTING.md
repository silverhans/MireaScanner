# Contributing to MireaScanner

## Быстрый старт

### 1. Fork и клонирование

```bash
git clone https://github.com/YOUR_USERNAME/MireaScanner.git
cd MireaScanner
```

### 2. Локальный запуск

```bash
# Backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Заполни BOT_TOKEN, WEBAPP_URL, SESSION_KEYS в .env

python scripts/db_migrate.py --apply
python -m bot.main
```

```bash
# Frontend (отдельный терминал)
cd webapp
npm install
npm run dev
```

### 3. C++ модули (опционально)

```bash
# Требуется g++ с поддержкой C++17
make build
```

### 4. Тесты

```bash
python -m pytest tests/
```

## Как отправить Pull Request

1. Создай ветку от `main`:
   ```bash
   git checkout -b fix/description
   # или
   git checkout -b feat/description
   ```
2. Внеси изменения
3. Убедись что тесты проходят: `python -m pytest tests/`
4. Убедись что frontend собирается: `cd webapp && npm run build`
5. Запушь ветку и открой PR на GitHub

## Соглашения

- **Коммиты:** `feat:`, `fix:`, `chore:`, `docs:` префиксы
- **Python:** следуй существующему стилю, без лишних зависимостей
- **Frontend:** компоненты в `webapp/src/components/`, хуки в `webapp/src/hooks/`
- **Секреты:** никогда не коммить `.env`, токены, пароли

## Об уязвимостях

Не создавай публичный issue — напиши напрямую согласно [SECURITY.md](SECURITY.md).

## Что можно улучшить

- Поддержка других университетов (не только МИРЭА)
- Покрытие тестами новых модулей
- Документация API
- Docker Compose для локальной разработки
