import pg from 'pg';
import { postgresSchema } from './schema.js';

export async function createPostgresDriver(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    // Управляемый Postgres на Render отдаёт сертификат, которого нет
    // в системном хранилище контейнера, поэтому проверка отключена.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    max: 5,
  });

  await pool.query(postgresSchema);

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
