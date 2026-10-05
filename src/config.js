import crypto from 'node:crypto';

const isProd = process.env.NODE_ENV === 'production';

function requiredInProd(name, fallback) {
  const value = process.env[name];
  if (value) return value;
  if (isProd) {
    throw new Error(
      `Переменная окружения ${name} обязательна в production. ` +
        'Добавьте её в Environment на render.com.'
    );
  }
  return fallback;
}

export const config = {
  isProd,
  port: Number(process.env.PORT) || 3000,

  // В dev секрет генерируется на лету: сессии переживают только один запуск.
  sessionSecret: requiredInProd('SESSION_SECRET', crypto.randomBytes(32).toString('hex')),
  sessionTtlDays: 30,
  cookieName: 'lof_session',

  databaseUrl: process.env.DATABASE_URL || null,
  sqlitePath: process.env.SQLITE_PATH || './data/listoffilms.sqlite',

  tmdbApiKey: process.env.TMDB_API_KEY || '',
  omdbApiKey: process.env.OMDB_API_KEY || '',
};

export const limits = {
  usernameMin: 3,
  usernameMax: 24,
  passwordMin: 6,
  passwordMax: 200,
  displayNameMax: 48,
  bioMax: 500,
  reviewMax: 2000,
};
