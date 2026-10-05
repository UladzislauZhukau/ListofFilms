import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import { attachUser } from './src/auth.js';
import { config } from './src/config.js';
import { closeDb, dbLabel, initDb } from './src/db/index.js';
import { providerStatus } from './src/providers.js';
import { authRouter } from './src/routes/auth.js';
import { entriesRouter } from './src/routes/entries.js';
import { profileRouter } from './src/routes/profile.js';
import { searchRouter } from './src/routes/search.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, 'public');

/* --------------------- простой лимитер попыток ---------------------- */

const attempts = new Map();

function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const bucket = attempts.get(key)?.resetAt > now ? attempts.get(key) : { count: 0, resetAt: now + windowMs };

    bucket.count += 1;
    attempts.set(key, bucket);

    if (attempts.size > 5000) {
      for (const [entryKey, value] of attempts) {
        if (value.resetAt <= now) attempts.delete(entryKey);
      }
    }

    if (bucket.count > max) {
      const seconds = Math.ceil((bucket.resetAt - now) / 1000);
      return res.status(429).json({ error: `Слишком много попыток. Повторите через ${seconds} с.` });
    }
    next();
  };
}

/* ------------------------------ приложение -------------------------- */

const app = express();

// Render проксирует запросы: без этого req.ip и secure-куки работают неверно.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use(attachUser);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: dbLabel(), providers: providerStatus() });
});

app.use('/api/auth/login', rateLimit({ windowMs: 10 * 60 * 1000, max: 20 }));
app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }));

app.use('/api/auth', authRouter);
app.use('/api/entries', entriesRouter);
app.use('/api/search', searchRouter);
app.use('/api/profile', profileRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Неизвестный метод API' }));

app.use(express.static(publicDir, { maxAge: config.isProd ? '1h' : 0, index: 'index.html' }));

// Любой не-API путь отдаёт SPA, чтобы работали ссылки вида /u/<ник>.
app.get(/.*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use((error, _req, res, _next) => {
  console.error('[ошибка]', error);
  const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
  res.status(status).json({ error: status === 500 ? 'Внутренняя ошибка сервера' : error.message });
});

/* ------------------------------- запуск ----------------------------- */

const server = await (async () => {
  // На Render эти переменные подставляет платформа. Печатаем их первой
  // строкой, чтобы по логу было видно, какому именно сервису он принадлежит:
  // при нескольких сервисах из одного репозитория иначе легко перепутать.
  if (process.env.RENDER_SERVICE_NAME) {
    const commit = (process.env.RENDER_GIT_COMMIT || '').slice(0, 7);
    console.log(`[сервис] ${process.env.RENDER_SERVICE_NAME}${commit ? ` @ ${commit}` : ''}`);
  }

  try {
    await initDb();
  } catch (error) {
    // Падаем осознанно: без базы приложение молча ушло бы на SQLite внутри
    // контейнера и теряло бы все данные при каждом редеплое.
    console.error(`[бд] ${error.message}`);
    process.exit(1);
  }
  console.log(`[бд] ${dbLabel()}`);

  const providers = providerStatus();
  if (!providers.tmdb) console.warn('[провайдеры] TMDB_API_KEY не задан — поиск по TMDB отключён');
  if (!providers.omdb) console.warn('[провайдеры] OMDB_API_KEY не задан — поиск по OMDb отключён');

  return app.listen(config.port, () => {
    console.log(`[сервер] http://localhost:${config.port}`);
  });
})();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
  });
}
