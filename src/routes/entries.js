import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { limits } from '../config.js';
import { entries } from '../db/index.js';
import { getTitle, parseRef } from '../providers.js';
import { buildXlsx } from '../xlsx.js';

export const STATUSES = ['watched', 'watching', 'watchlist', 'dropped'];
const SORTS = ['added', 'title', 'year', 'rating', 'watched'];

export const entriesRouter = Router();
entriesRouter.use(requireAuth);

/* ------------------------------ хелперы ----------------------------- */

function parseStatus(value, fallback = 'watched') {
  const status = String(value ?? '').trim().toLowerCase();
  return STATUSES.includes(status) ? status : fallback;
}

function parseRating(value) {
  if (value === null || value === '' || value === undefined) return null;
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) return undefined;
  return rating;
}

function parseReview(value) {
  if (value === null || value === undefined) return null;
  const review = String(value).trim();
  if (!review) return null;
  return review.slice(0, limits.reviewMax);
}

function parseWatchedOn(value) {
  if (!value) return null;
  const date = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function matchesQuery(entry, needle) {
  if (!needle) return true;
  const haystack = [entry.title, entry.originalTitle, entry.review, entry.genres.join(' ')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

const byTitle = (a, b) => a.title.localeCompare(b.title, 'ru');

function sortEntries(list, sort, direction) {
  const sorted = [...list];
  switch (sort) {
    case 'title':
      sorted.sort(byTitle);
      break;
    case 'year':
      sorted.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || byTitle(a, b));
      break;
    case 'rating':
      sorted.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byTitle(a, b));
      break;
    case 'watched':
      sorted.sort((a, b) => String(b.watchedOn ?? '').localeCompare(String(a.watchedOn ?? '')));
      break;
    default:
      sorted.sort((a, b) => b.id - a.id);
  }
  return direction === 'asc' ? sorted.reverse() : sorted;
}

/* ------------------------------ маршруты ---------------------------- */

// Жанры приходят от двух провайдеров в разном регистре и на разных языках
// («боевик» от TMDB, «Crime» от OMDb), поэтому сравниваем по нижнему
// регистру, а показываем первое встреченное написание с заглавной буквы.
function collectGenres(list) {
  const seen = new Map();
  for (const entry of list) {
    for (const genre of entry.genres) {
      const original = genre.trim();
      const key = original.toLowerCase();
      if (!key) continue;
      const known = seen.get(key);
      if (known) {
        known.count += 1;
        continue;
      }
      // Поднимаем только первую букву: «НФ и Фэнтези» должно остаться собой.
      const label = original[0].toUpperCase() + original.slice(1);
      seen.set(key, { value: key, label, count: 1 });
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'));
}

entriesRouter.get('/', async (req, res) => {
  const all = await entries.listByUser(req.user.id);

  const statusFilter = String(req.query.status ?? 'all').toLowerCase();
  const typeFilter = String(req.query.type ?? 'all').toLowerCase();
  const genreFilter = String(req.query.genre ?? '').trim().toLowerCase();
  const needle = String(req.query.q ?? '').trim().toLowerCase();
  const sort = SORTS.includes(String(req.query.sort)) ? String(req.query.sort) : 'added';
  const direction = req.query.dir === 'asc' ? 'asc' : 'desc';
  const favoritesOnly = req.query.favorite === 'true';

  const filtered = all.filter((entry) => {
    if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
    if (typeFilter !== 'all' && entry.mediaType !== typeFilter) return false;
    if (favoritesOnly && !entry.favorite) return false;
    if (genreFilter && !entry.genres.some((genre) => genre.toLowerCase() === genreFilter)) {
      return false;
    }
    return matchesQuery(entry, needle);
  });

  const counts = { all: all.length };
  for (const status of STATUSES) {
    counts[status] = all.filter((entry) => entry.status === status).length;
  }
  counts.favorite = all.filter((entry) => entry.favorite).length;

  // Список жанров строим по записям, прошедшим все фильтры кроме жанрового:
  // иначе выбор жанра схлопнул бы выпадающий список до одного пункта.
  const genreSource = all.filter((entry) => {
    if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
    if (typeFilter !== 'all' && entry.mediaType !== typeFilter) return false;
    if (favoritesOnly && !entry.favorite) return false;
    return matchesQuery(entry, needle);
  });

  res.json({
    entries: sortEntries(filtered, sort, direction),
    counts,
    genres: collectGenres(genreSource),
  });
});

const STATUS_LABELS = {
  watched: 'Просмотрено',
  watching: 'Смотрю',
  watchlist: 'Буду смотреть',
  dropped: 'Брошено',
};
const TYPE_LABELS = { movie: 'Фильм', tv: 'Сериал' };

const EXPORT_COLUMNS = [
  { header: 'Название', width: 34 },
  { header: 'Оригинальное название', width: 30 },
  { header: 'Тип', width: 10 },
  { header: 'Год', width: 8 },
  { header: 'Статус', width: 16 },
  { header: 'Оценка', width: 9 },
  { header: 'Избранное', width: 11 },
  { header: 'Дата просмотра', width: 15 },
  { header: 'Жанры', width: 28 },
  { header: 'Длительность, мин', width: 12 },
  { header: 'Заметка', width: 50 },
  { header: 'IMDb', width: 13 },
  { header: 'Добавлено', width: 12 },
];

entriesRouter.get('/export.xlsx', async (req, res) => {
  const all = sortEntries(await entries.listByUser(req.user.id), 'title', 'desc');
  const rows = all.map((entry) => [
    entry.title,
    entry.originalTitle && entry.originalTitle !== entry.title ? entry.originalTitle : null,
    TYPE_LABELS[entry.mediaType] ?? entry.mediaType,
    entry.year,
    STATUS_LABELS[entry.status] ?? entry.status,
    entry.rating,
    entry.favorite ? 'Да' : null,
    entry.watchedOn,
    entry.genres.join(', '),
    entry.runtime,
    entry.review,
    entry.imdbId,
    entry.createdAt ? entry.createdAt.slice(0, 10) : null,
  ]);

  const file = buildXlsx({ sheetName: 'Мой список', columns: EXPORT_COLUMNS, rows });
  const date = new Date().toISOString().slice(0, 10);
  const name = `Мой список фильмов ${date}.xlsx`;
  res
    .set({
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="films-${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
    })
    .send(file);
});

entriesRouter.post('/', async (req, res) => {
  const ref = String(req.body?.ref ?? '').trim();
  if (!parseRef(ref)) return res.status(400).json({ error: 'Некорректный идентификатор тайтла' });

  const rating = parseRating(req.body?.rating);
  if (rating === undefined) return res.status(400).json({ error: 'Оценка должна быть от 1 до 10' });

  const watchedOn = parseWatchedOn(req.body?.watchedOn);
  if (watchedOn === undefined) return res.status(400).json({ error: 'Дата должна быть в формате ГГГГ-ММ-ДД' });

  // Метаданные всегда берём у провайдера, а не из тела запроса,
  // чтобы в базе не оказалось произвольных строк от клиента.
  let title;
  try {
    title = await getTitle(ref);
  } catch (error) {
    const status = error.status === 404 ? 404 : 502;
    return res.status(status).json({ error: error.message || 'Не удалось получить данные о тайтле' });
  }

  const status = parseStatus(req.body?.status);
  const existing = await entries.findByRef(req.user.id, ref);

  const saved = await entries.upsert(req.user.id, {
    ref,
    mediaType: title.mediaType,
    title: title.title,
    originalTitle: title.originalTitle,
    year: title.year,
    posterUrl: title.posterUrl,
    overview: title.overview,
    genres: (title.genres || []).join(','),
    runtime: title.runtime,
    imdbId: title.imdbId ?? null,
    tmdbId: title.tmdbId ?? null,
    status,
    rating: rating ?? existing?.rating ?? null,
    review: parseReview(req.body?.review) ?? existing?.review ?? null,
    favorite: Boolean(req.body?.favorite ?? existing?.favorite ?? false),
    watchedOn:
      watchedOn ??
      existing?.watchedOn ??
      (status === 'watched' ? new Date().toISOString().slice(0, 10) : null),
  });

  res.status(existing ? 200 : 201).json({ entry: saved, updated: Boolean(existing) });
});

entriesRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });

  const patch = {};

  if (req.body?.status !== undefined) {
    const status = String(req.body.status).toLowerCase();
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Неизвестный статус' });
    patch.status = status;
    if (status === 'watched' && !req.body.watchedOn) {
      const current = await entries.findById(id, req.user.id);
      if (current && !current.watchedOn) patch.watchedOn = new Date().toISOString().slice(0, 10);
    }
  }

  if (req.body?.rating !== undefined) {
    const rating = parseRating(req.body.rating);
    if (rating === undefined) return res.status(400).json({ error: 'Оценка должна быть от 1 до 10' });
    patch.rating = rating;
  }

  if (req.body?.review !== undefined) patch.review = parseReview(req.body.review);
  if (req.body?.favorite !== undefined) patch.favorite = Boolean(req.body.favorite);

  if (req.body?.watchedOn !== undefined) {
    const watchedOn = parseWatchedOn(req.body.watchedOn);
    if (watchedOn === undefined) return res.status(400).json({ error: 'Дата должна быть в формате ГГГГ-ММ-ДД' });
    patch.watchedOn = watchedOn;
  }

  const updated = await entries.update(id, req.user.id, patch);
  if (!updated) return res.status(404).json({ error: 'Запись не найдена' });
  res.json({ entry: updated });
});

entriesRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Некорректный id' });

  const removed = await entries.remove(id, req.user.id);
  if (!removed) return res.status(404).json({ error: 'Запись не найдена' });
  res.json({ ok: true });
});

/* ------------------------------ статистика -------------------------- */

export function buildStats(list) {
  const watched = list.filter((entry) => entry.status === 'watched');
  const rated = watched.filter((entry) => typeof entry.rating === 'number');

  const genreCounts = new Map();
  for (const entry of watched) {
    for (const genre of entry.genres) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
  }

  const decadeCounts = new Map();
  for (const entry of watched) {
    if (!entry.year) continue;
    const decade = Math.floor(entry.year / 10) * 10;
    decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1);
  }

  const ratingSpread = Array.from({ length: 10 }, (_, index) => ({
    rating: index + 1,
    count: rated.filter((entry) => entry.rating === index + 1).length,
  }));

  const minutes = watched.reduce((sum, entry) => sum + (entry.runtime ?? 0), 0);

  return {
    total: list.length,
    byStatus: Object.fromEntries(
      STATUSES.map((status) => [status, list.filter((entry) => entry.status === status).length])
    ),
    movies: watched.filter((entry) => entry.mediaType === 'movie').length,
    series: watched.filter((entry) => entry.mediaType === 'tv').length,
    favorites: list.filter((entry) => entry.favorite).length,
    averageRating: rated.length
      ? Number((rated.reduce((sum, entry) => sum + entry.rating, 0) / rated.length).toFixed(2))
      : null,
    ratedCount: rated.length,
    minutes,
    hours: Math.round(minutes / 60),
    days: Number((minutes / 1440).toFixed(1)),
    topGenres: [...genreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([genre, count]) => ({ genre, count })),
    decades: [...decadeCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([decade, count]) => ({ decade, count })),
    ratingSpread,
    bestRated: [...rated].sort((a, b) => b.rating - a.rating).slice(0, 5),
  };
}

