import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { entries } from '../db/index.js';
import { getTitle, providerStatus, searchTitles } from '../providers.js';

export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get('/', async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  const type = ['movie', 'tv'].includes(String(req.query.type)) ? String(req.query.type) : 'all';

  if (query.length < 2) {
    return res.json({ results: [], providers: providerStatus(), query });
  }

  try {
    const [{ results, providers }, mine] = await Promise.all([
      searchTitles(query, type),
      entries.listByUser(req.user.id),
    ]);

    // Помечаем то, что уже есть в списке, чтобы не добавлять дважды.
    const byRef = new Map(mine.map((entry) => [entry.ref, entry]));
    const byImdb = new Map(mine.filter((e) => e.imdbId).map((entry) => [entry.imdbId, entry]));

    const enriched = results.map((item) => {
      const saved = byRef.get(item.ref) || (item.imdbId ? byImdb.get(item.imdbId) : null);
      return {
        ...item,
        inList: Boolean(saved),
        savedStatus: saved ? saved.status : null,
        savedId: saved ? saved.id : null,
      };
    });

    res.json({ results: enriched, providers, query });
  } catch (error) {
    res.status(502).json({ error: error.message || 'Провайдеры поиска недоступны' });
  }
});

searchRouter.get('/title/:ref', async (req, res) => {
  try {
    const title = await getTitle(req.params.ref);
    const saved = await entries.findByRef(req.user.id, title.ref);
    res.json({ title, entry: saved });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message || 'Не удалось загрузить тайтл' });
  }
});
