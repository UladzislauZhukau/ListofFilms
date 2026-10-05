import { Router } from 'express';
import {
  hashPassword,
  publicUser,
  requireAuth,
  validatePassword,
  verifyPassword,
} from '../auth.js';
import { limits } from '../config.js';
import { entries, users } from '../db/index.js';
import { buildStats } from './entries.js';

export const profileRouter = Router();

/* --------------------------- свой профиль --------------------------- */

profileRouter.get('/stats', requireAuth, async (req, res) => {
  const list = await entries.listByUser(req.user.id);
  res.json({ stats: buildStats(list) });
});

profileRouter.patch('/me', requireAuth, async (req, res) => {
  const displayName = String(req.body?.displayName ?? '').trim().slice(0, limits.displayNameMax);
  const bio = String(req.body?.bio ?? '').trim().slice(0, limits.bioMax);

  const updated = await users.updateProfile(req.user.id, {
    displayName: displayName || null,
    bio: bio || null,
  });
  res.json({ user: publicUser(updated) });
});

profileRouter.post('/password', requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword ?? '');
  if (!(await verifyPassword(current, req.user.passwordHash))) {
    return res.status(403).json({ error: 'Текущий пароль неверный' });
  }

  const checked = validatePassword(req.body?.newPassword);
  if (checked.error) return res.status(400).json({ error: checked.error });

  await users.updatePassword(req.user.id, await hashPassword(checked.password));
  res.json({ ok: true });
});

/* -------------------------- публичный профиль ------------------------ */

// Открыт без авторизации: ссылкой /u/<ник> можно поделиться списком.
profileRouter.get('/public/:username', async (req, res) => {
  const user = await users.findByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'Профиль не найден' });

  const list = await entries.listByUser(user.id);
  const visible = list
    .filter((entry) => entry.status !== 'watchlist')
    .sort((a, b) => b.id - a.id);

  res.json({
    user: publicUser(user),
    stats: buildStats(list),
    entries: visible,
    isOwner: req.user?.id === user.id,
  });
});
