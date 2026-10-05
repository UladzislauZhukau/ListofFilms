import { config } from './config.js';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';
const OMDB_BASE = 'https://www.omdbapi.com/';
const REQUEST_TIMEOUT_MS = 8000;

/* ------------------------------- кэш -------------------------------- */

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map();

function cached(key, producer) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = producer().catch((error) => {
    cache.delete(key);
    throw error;
  });

  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/* ------------------------------ запросы ----------------------------- */

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const error = new Error(`Провайдер ответил ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/* ---------------------------- нормализация -------------------------- */

function parseYear(value) {
  const match = String(value ?? '').match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function parseMinutes(value) {
  const match = String(value ?? '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

function tmdbPoster(posterPath, size = 'w342') {
  return posterPath ? `${TMDB_IMAGE}/${size}${posterPath}` : null;
}

function cleanText(value) {
  return value && value !== 'N/A' ? String(value).trim() : null;
}

function fromTmdb(item) {
  const mediaType = item.media_type === 'tv' || item.first_air_date ? 'tv' : 'movie';
  const title = item.title || item.name || item.original_title || item.original_name;
  if (!title) return null;
  return {
    ref: `tmdb:${mediaType}:${item.id}`,
    source: 'tmdb',
    mediaType,
    title,
    originalTitle: item.original_title || item.original_name || null,
    year: parseYear(item.release_date || item.first_air_date),
    posterUrl: tmdbPoster(item.poster_path),
    overview: cleanText(item.overview),
    tmdbRating: item.vote_average ? Number(item.vote_average.toFixed(1)) : null,
  };
}

function fromOmdb(item) {
  if (!item || !item.Title) return null;
  return {
    ref: `imdb:${item.imdbID}`,
    source: 'omdb',
    mediaType: item.Type === 'series' ? 'tv' : 'movie',
    title: item.Title,
    originalTitle: null,
    year: parseYear(item.Year),
    posterUrl: cleanText(item.Poster),
    overview: cleanText(item.Plot),
    imdbId: item.imdbID,
    imdbRating: cleanText(item.imdbRating) ? Number(item.imdbRating) : null,
  };
}

/* ------------------------------- поиск ------------------------------ */

async function searchTmdb(query, type) {
  if (!config.tmdbApiKey) return [];
  const endpoint = type === 'movie' ? 'search/movie' : type === 'tv' ? 'search/tv' : 'search/multi';
  const url = new URL(`${TMDB_BASE}/${endpoint}`);
  url.searchParams.set('api_key', config.tmdbApiKey);
  url.searchParams.set('query', query);
  url.searchParams.set('language', 'ru-RU');
  url.searchParams.set('include_adult', 'false');

  const data = await fetchJson(url);
  return (data.results || [])
    .filter((item) => item.media_type !== 'person')
    .map(fromTmdb)
    .filter(Boolean);
}

async function searchOmdb(query, type) {
  if (!config.omdbApiKey) return [];
  const url = new URL(OMDB_BASE);
  url.searchParams.set('apikey', config.omdbApiKey);
  url.searchParams.set('s', query);
  if (type === 'movie') url.searchParams.set('type', 'movie');
  if (type === 'tv') url.searchParams.set('type', 'series');

  const data = await fetchJson(url);
  if (data.Response === 'False') return [];
  return (data.Search || []).map(fromOmdb).filter(Boolean);
}

const dedupeKey = (item) => {
  const slug = String(item.title).toLowerCase().replace(/[^0-9a-zа-яё]+/giu, '');
  return `${slug}|${item.year ?? ''}`;
};

/**
 * Ищет в TMDB и OMDb одновременно. TMDB идёт первым (русские названия
 * и постеры), OMDb добавляет то, чего в TMDB не нашлось.
 */
export function searchTitles(query, type = 'all') {
  const trimmed = query.trim();
  if (!trimmed) return Promise.resolve({ results: [], providers: {} });

  return cached(`search:${type}:${trimmed.toLowerCase()}`, async () => {
    const [tmdb, omdb] = await Promise.allSettled([
      searchTmdb(trimmed, type),
      searchOmdb(trimmed, type),
    ]);

    const providers = {
      tmdb: tmdb.status === 'fulfilled' ? 'ok' : 'error',
      omdb: omdb.status === 'fulfilled' ? 'ok' : 'error',
    };

    const results = [];
    const seen = new Set();
    const lists = [
      tmdb.status === 'fulfilled' ? tmdb.value : [],
      omdb.status === 'fulfilled' ? omdb.value : [],
    ];
    for (const list of lists) {
      for (const item of list) {
        const key = dedupeKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(item);
      }
    }

    return { results: results.slice(0, 40), providers };
  });
}

/* ---------------------------- детали тайтла ------------------------- */

export function parseRef(ref) {
  const parts = String(ref || '').split(':');
  if (parts[0] === 'tmdb' && (parts[1] === 'movie' || parts[1] === 'tv') && /^\d+$/.test(parts[2])) {
    return { source: 'tmdb', mediaType: parts[1], id: parts[2] };
  }
  if (parts[0] === 'imdb' && /^tt\d+$/.test(parts[1])) {
    return { source: 'imdb', id: parts[1] };
  }
  return null;
}

async function tmdbDetails(mediaType, id) {
  const url = new URL(`${TMDB_BASE}/${mediaType}/${id}`);
  url.searchParams.set('api_key', config.tmdbApiKey);
  url.searchParams.set('language', 'ru-RU');
  url.searchParams.set('append_to_response', 'external_ids');

  const data = await fetchJson(url);
  const episodeRuntime = Array.isArray(data.episode_run_time) ? data.episode_run_time[0] : null;

  return {
    ref: `tmdb:${mediaType}:${id}`,
    source: 'tmdb',
    mediaType,
    title: data.title || data.name,
    originalTitle: data.original_title || data.original_name || null,
    year: parseYear(data.release_date || data.first_air_date),
    posterUrl: tmdbPoster(data.poster_path, 'w500'),
    overview: cleanText(data.overview),
    genres: (data.genres || []).map((genre) => genre.name),
    runtime: data.runtime || episodeRuntime || null,
    tmdbId: Number(id),
    imdbId: data.imdb_id || (data.external_ids && data.external_ids.imdb_id) || null,
    tmdbRating: data.vote_average ? Number(data.vote_average.toFixed(1)) : null,
    seasons: data.number_of_seasons ?? null,
    episodes: data.number_of_episodes ?? null,
  };
}

async function omdbDetails(imdbId) {
  const url = new URL(OMDB_BASE);
  url.searchParams.set('apikey', config.omdbApiKey);
  url.searchParams.set('i', imdbId);
  url.searchParams.set('plot', 'full');

  const data = await fetchJson(url);
  if (data.Response === 'False') {
    const error = new Error(data.Error || 'Тайтл не найден в OMDb');
    error.status = 404;
    throw error;
  }

  return {
    ref: `imdb:${imdbId}`,
    source: 'omdb',
    mediaType: data.Type === 'series' ? 'tv' : 'movie',
    title: data.Title,
    originalTitle: null,
    year: parseYear(data.Year),
    posterUrl: cleanText(data.Poster),
    overview: cleanText(data.Plot),
    genres: cleanText(data.Genre) ? data.Genre.split(',').map((genre) => genre.trim()) : [],
    runtime: parseMinutes(data.Runtime),
    tmdbId: null,
    imdbId,
    imdbRating: cleanText(data.imdbRating) ? Number(data.imdbRating) : null,
    director: cleanText(data.Director),
    actors: cleanText(data.Actors),
  };
}

export function getTitle(ref) {
  const parsed = parseRef(ref);
  if (!parsed) {
    const error = new Error('Некорректный идентификатор тайтла');
    error.status = 400;
    return Promise.reject(error);
  }

  return cached(`title:${ref}`, async () => {
    if (parsed.source === 'tmdb') {
      if (!config.tmdbApiKey) throw new Error('TMDB_API_KEY не настроен');
      const details = await tmdbDetails(parsed.mediaType, parsed.id);
      // Подмешиваем данные IMDb, если TMDB отдал imdb_id.
      if (details.imdbId && config.omdbApiKey) {
        try {
          const extra = await omdbDetails(details.imdbId);
          details.imdbRating = extra.imdbRating;
          details.director = extra.director;
          details.actors = extra.actors;
          if (!details.overview) details.overview = extra.overview;
          if (!details.genres.length) details.genres = extra.genres;
        } catch {
          /* OMDb необязателен — молча пропускаем */
        }
      }
      return details;
    }

    if (!config.omdbApiKey) throw new Error('OMDB_API_KEY не настроен');
    return omdbDetails(parsed.id);
  });
}

export function providerStatus() {
  return { tmdb: Boolean(config.tmdbApiKey), omdb: Boolean(config.omdbApiKey) };
}
