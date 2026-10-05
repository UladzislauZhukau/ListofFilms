import { config } from '../config.js';
import { createPostgresDriver } from './postgres.js';
import { createSqliteDriver } from './sqlite.js';

let driver = null;

export async function initDb() {
  if (driver) return driver;
  driver = config.databaseUrl
    ? await createPostgresDriver(config.databaseUrl)
    : await createSqliteDriver(config.sqlitePath);
  return driver;
}

export async function closeDb() {
  if (!driver) return;
  await driver.close();
  driver = null;
}

export function dbLabel() {
  return driver ? driver.label : 'не инициализирована';
}

function db() {
  if (!driver) throw new Error('База данных ещё не инициализирована');
  return driver;
}

const nowIso = () => new Date().toISOString();

function toIso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

/* ------------------------------- users ------------------------------- */

const USER_COLUMNS = 'id, username, username_key, password_hash, display_name, bio, created_at';

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    usernameKey: row.username_key,
    passwordHash: row.password_hash,
    displayName: row.display_name || null,
    bio: row.bio || null,
    createdAt: toIso(row.created_at),
  };
}

// Два драйвера сообщают о нарушении UNIQUE по-разному: PostgreSQL кодом
// 23505, SQLite — текстом ошибки.
export function isUsernameTaken(error) {
  return error?.code === '23505' || /UNIQUE constraint failed/i.test(error?.message ?? '');
}

export const users = {
  // Проверки занятости ника в маршруте мало: два одновременных запроса
  // успевают пройти её оба, и спасает только UNIQUE в схеме. Переводим его
  // нарушение в ту же ошибку, что и обычный дубль.
  async create({ username, passwordHash }) {
    try {
      const rows = await db().all(
        `INSERT INTO users (username, username_key, password_hash)
         VALUES ($1, $2, $3)
         RETURNING ${USER_COLUMNS}`,
        [username, normalizeUsername(username), passwordHash]
      );
      return mapUser(rows[0]);
    } catch (error) {
      if (!isUsernameTaken(error)) throw error;
      const taken = new Error('Этот ник уже занят');
      taken.status = 409;
      throw taken;
    }
  },

  async findByUsername(username) {
    const rows = await db().all(
      `SELECT ${USER_COLUMNS} FROM users WHERE username_key = $1`,
      [normalizeUsername(username)]
    );
    return mapUser(rows[0]);
  },

  async findById(id) {
    const rows = await db().all(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return mapUser(rows[0]);
  },

  async updateProfile(id, { displayName, bio }) {
    const rows = await db().all(
      `UPDATE users SET display_name = $1, bio = $2 WHERE id = $3
       RETURNING ${USER_COLUMNS}`,
      [displayName, bio, id]
    );
    return mapUser(rows[0]);
  },

  async updatePassword(id, passwordHash) {
    await db().all('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
  },

  async remove(id) {
    await db().all('DELETE FROM users WHERE id = $1', [id]);
  },
};

/* ------------------------------ entries ------------------------------ */

const ENTRY_COLUMNS = `id, user_id, ref, media_type, title, original_title, year, poster_url,
  overview, genres, runtime, imdb_id, tmdb_id, status, rating, review, favorite,
  watched_on, created_at, updated_at`;

function mapEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    ref: row.ref,
    mediaType: row.media_type,
    title: row.title,
    originalTitle: row.original_title || null,
    year: row.year ?? null,
    posterUrl: row.poster_url || null,
    overview: row.overview || null,
    genres: row.genres ? String(row.genres).split(',').filter(Boolean) : [],
    runtime: row.runtime ?? null,
    imdbId: row.imdb_id || null,
    tmdbId: row.tmdb_id ?? null,
    status: row.status,
    rating: row.rating ?? null,
    review: row.review || null,
    favorite: Boolean(row.favorite),
    watchedOn: row.watched_on || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export const entries = {
  async listByUser(userId) {
    const rows = await db().all(
      `SELECT ${ENTRY_COLUMNS} FROM entries WHERE user_id = $1 ORDER BY id DESC`,
      [userId]
    );
    return rows.map(mapEntry);
  },

  async findById(id, userId) {
    const rows = await db().all(
      `SELECT ${ENTRY_COLUMNS} FROM entries WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return mapEntry(rows[0]);
  },

  async findByRef(userId, ref) {
    const rows = await db().all(
      `SELECT ${ENTRY_COLUMNS} FROM entries WHERE user_id = $1 AND ref = $2`,
      [userId, ref]
    );
    return mapEntry(rows[0]);
  },

  // Повторное добавление того же фильма не плодит дубли, а обновляет запись.
  async upsert(userId, entry) {
    const stamp = nowIso();
    const rows = await db().all(
      `INSERT INTO entries (
         user_id, ref, media_type, title, original_title, year, poster_url, overview,
         genres, runtime, imdb_id, tmdb_id, status, rating, review, favorite, watched_on,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)
       ON CONFLICT (user_id, ref) DO UPDATE SET
         media_type = $3, title = $4, original_title = $5, year = $6, poster_url = $7,
         overview = $8, genres = $9, runtime = $10, imdb_id = $11, tmdb_id = $12,
         status = $13, rating = $14, review = $15, favorite = $16, watched_on = $17,
         updated_at = $18
       RETURNING ${ENTRY_COLUMNS}`,
      [
        userId,
        entry.ref,
        entry.mediaType,
        entry.title,
        entry.originalTitle,
        entry.year,
        entry.posterUrl,
        entry.overview,
        entry.genres,
        entry.runtime,
        entry.imdbId,
        entry.tmdbId,
        entry.status,
        entry.rating,
        entry.review,
        entry.favorite,
        entry.watchedOn,
        stamp,
      ]
    );
    return mapEntry(rows[0]);
  },

  async update(id, userId, patch) {
    const fields = {
      status: patch.status,
      rating: patch.rating,
      review: patch.review,
      favorite: patch.favorite,
      watched_on: patch.watchedOn,
    };

    const sets = [];
    const params = [];
    for (const [column, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) return this.findById(id, userId);

    params.push(nowIso());
    sets.push(`updated_at = $${params.length}`);
    params.push(id, userId);

    const rows = await db().all(
      `UPDATE entries SET ${sets.join(', ')}
       WHERE id = $${params.length - 1} AND user_id = $${params.length}
       RETURNING ${ENTRY_COLUMNS}`,
      params
    );
    return mapEntry(rows[0]);
  },

  async remove(id, userId) {
    const rows = await db().all(
      'DELETE FROM entries WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    return rows.length > 0;
  },
};
