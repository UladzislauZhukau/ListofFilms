import pg from 'pg';
import { postgresSchema } from './schema.js';

// Превращает сетевые ошибки драйвера в подсказку: по голому ENOTFOUND
// неочевидно, что дело в регионах, а не в опечатке в строке подключения.
function explainConnectionError(error, connectionString) {
  const host = (() => {
    try {
      return new URL(connectionString).hostname;
    } catch {
      return 'неизвестен';
    }
  })();

  if (error.code === 'ENOTFOUND') {
    const isInternalRenderHost = /^dpg-[^.]+$/.test(host);
    return isInternalRenderHost
      ? `Хост базы "${host}" не резолвится. Это внутренний адрес Render, он ` +
          'работает только если база и веб-сервис в одном регионе. Проверьте ' +
          'регионы обоих или возьмите External Database URL.'
      : `Хост базы "${host}" не резолвится — проверьте DATABASE_URL.`;
  }

  if (error.code === 'ECONNREFUSED') {
    return `База по адресу "${host}" не принимает подключения — проверьте, что она запущена.`;
  }

  if (error.code === '28P01' || error.code === '28000') {
    return 'База отвергла логин или пароль из DATABASE_URL.';
  }

  if (error.code === '3D000') {
    return 'Базы с таким именем нет — проверьте имя в конце DATABASE_URL.';
  }

  return `Не удалось подключиться к PostgreSQL (${host}): ${error.message}`;
}

export async function createPostgresDriver(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    // Управляемый Postgres на Render отдаёт сертификат, которого нет
    // в системном хранилище контейнера, поэтому проверка отключена.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    max: 5,
  });

  try {
    await pool.query(postgresSchema);
  } catch (error) {
    await pool.end().catch(() => {});
    throw new Error(explainConnectionError(error, connectionString), { cause: error });
  }

  return {
    dialect: 'postgres',
    label: 'PostgreSQL',

    async all(text, params = []) {
      const result = await pool.query(text, params);
      return result.rows;
    },

    async close() {
      await pool.end();
    },
  };
}
