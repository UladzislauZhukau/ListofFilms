# ListOfFilms

Трекер просмотренных фильмов и сериалов. Поиск тайтлов идёт одновременно по
**TMDB** (русские названия, постеры, описания) и **OMDb** (рейтинги IMDb,
режиссёр, актёры). Регистрация — только ник и пароль, без почты.

## Что умеет

- Поиск фильмов и сериалов по двум базам сразу, с дедупликацией результатов
- Четыре статуса: просмотрено / смотрю / буду смотреть / брошено
- Оценка 1–10, текстовая заметка, дата просмотра, избранное
- Фильтры по статусу, типу, жанру и тексту; сортировка по дате, оценке, году, названию
- Статистика: часы просмотра, средняя оценка, любимые жанры, десятилетия
- Публичная страница списка по адресу `/u/<ник>` (планы к просмотру скрыты)
- Смена пароля и удаление аккаунта вместе со всеми записями

## Стек

| Слой | Решение |
| --- | --- |
| Сервер | Node.js 22+, Express 5 |
| Хранилище | PostgreSQL в продакшене, SQLite (встроенный `node:sqlite`) локально |
| Сессии | JWT в httpOnly-куке, пароли — bcrypt |
| Клиент | Ванильный JS, без сборки и зависимостей |

Драйвер базы выбирается автоматически: есть `DATABASE_URL` → PostgreSQL,
нет → файловый SQLite. Таблицы создаются при старте, миграции не нужны.

## Локальный запуск

```bash
npm install
npm run dev              # http://localhost:3000
```

Файл `.env` с ключами TMDB и OMDb лежит в репозитории, так что отдельная
настройка для локального запуска не нужна. Ключи от бесплатных тарифов и
намеренно открыты; при перевыпуске их надо поменять в `.env` и `render.yaml`.

Переменные окружения:

| Переменная | Обязательна | Описание |
| --- | --- | --- |
| `TMDB_API_KEY` | да | ключ v3 с themoviedb.org |
| `OMDB_API_KEY` | да | ключ с omdbapi.com |
| `SESSION_SECRET` | в продакшене | длинная случайная строка для подписи сессий |
| `DATABASE_URL` | в продакшене | строка подключения к PostgreSQL |
| `SQLITE_PATH` | нет | путь к файлу SQLite локально |
| `PORT` | нет | порт, по умолчанию 3000 |

Сгенерировать секрет:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Деплой на render.com

Сервис собирается из `Dockerfile`, блюпринт `render.yaml` поднимает его
вместе с бесплатным PostgreSQL одной кнопкой.

1. Запушить репозиторий на GitHub.
2. Render → **Blueprints** → **New Blueprint Instance** → выбрать репозиторий.
3. Render спросит значения `TMDB_API_KEY` и `OMDB_API_KEY` — ввести их.
   `SESSION_SECRET` и `DATABASE_URL` подставятся сами.
4. Дождаться сборки образа. Проверка живости — `GET /api/health`.

Без блюпринта (вручную): **New → Web Service**, Language/Runtime — **Docker**,
Dockerfile Path `./Dockerfile`, Health Check Path `/api/health`. Отдельно
создать PostgreSQL и прописать все переменные из таблицы выше.

### Docker локально

```bash
docker build -t listoffilms .
docker run --rm -p 3000:3000 \
  -e SESSION_SECRET=любая-длинная-строка \
  -e TMDB_API_KEY=... \
  -e OMDB_API_KEY=... \
  listoffilms
```

Без `DATABASE_URL` контейнер пишет в SQLite внутри `/app/data` — данные
исчезнут вместе с контейнером. Чтобы сохранить их, примонтируйте том
(`-v lof-data:/app/data`) или передайте `DATABASE_URL`.

Образ запускает `node server.js` напрямую, поэтому процесс получает SIGTERM
от Render и закрывает сервер и пул соединений штатно.

> Бесплатный веб-сервис Render засыпает после 15 минут простоя — первый
> запрос после сна открывается ~30 секунд. Бесплатный PostgreSQL на Render
> живёт ограниченный срок, после чего базу нужно пересоздать.

## API

Все ответы — JSON. Авторизация по куке `lof_session`.

| Метод | Путь | Назначение |
| --- | --- | --- |
| `POST` | `/api/auth/register` | регистрация по нику и паролю |
| `POST` | `/api/auth/login` | вход |
| `POST` | `/api/auth/logout` | выход |
| `GET` | `/api/auth/me` | текущий пользователь |
| `DELETE` | `/api/auth/account` | удалить аккаунт (нужен пароль) |
| `GET` | `/api/search?q=&type=` | поиск по TMDB + OMDb |
| `GET` | `/api/search/title/:ref` | детали тайтла |
| `GET` | `/api/entries` | список с фильтрами и сортировкой |
| `POST` | `/api/entries` | добавить или обновить запись |
| `PATCH` | `/api/entries/:id` | изменить статус, оценку, заметку |
| `DELETE` | `/api/entries/:id` | удалить запись |
| `GET` | `/api/profile/stats` | статистика |
| `PATCH` | `/api/profile/me` | имя и описание профиля |
| `POST` | `/api/profile/password` | смена пароля |
| `GET` | `/api/profile/public/:username` | публичный профиль |

`ref` — идентификатор тайтла вида `tmdb:movie:603`, `tmdb:tv:1399` или
`imdb:tt0133093`. Метаданные при сохранении всегда берутся у провайдера,
а не из тела запроса.

## Структура

```
Dockerfile             образ для Render: npm ci отдельным слоем, запуск от node
render.yaml            блюпринт: веб-сервис на Docker + PostgreSQL
server.js              запуск, middleware, роутинг верхнего уровня
src/config.js          переменные окружения и лимиты
src/auth.js            сессии, bcrypt, валидация ника и пароля
src/providers.js       клиенты TMDB и OMDb, нормализация и кэш
src/db/index.js        репозитории users и entries
src/db/{sqlite,postgres}.js  драйверы
src/routes/            auth, entries, search, profile
public/                index.html, styles.css, app.js
```
