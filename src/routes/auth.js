import { Router } from 'express';
import {
  clearSession,
  hashPassword,
  issueSession,
  publicUser,
  requireAuth,
  validatePassword,
  validateUsername,
  verifyPassword,
} from '../auth.js';
import { users } from '../db/index.js';

export const authRouter = Router();

authRouter.get('/me', (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRouter.post('/register', async (req, res) => {
  const checkedName = validateUsername(req.body?.username);
  if (checkedName.error) return res.status(400).json({ error: checkedName.error });

  const checkedPassword = validatePassword(req.body?.password);
  if (checkedPassword.error) return res.status(400).json({ error: checkedPassword.error });

  const existing = await users.findByUsername(checkedName.username);
  if (existing) return res.status(409).json({ error: 'Этот ник уже занят' });

  let user;
  try {
    user = await users.create({
      username: checkedName.username,
      passwordHash: await hashPassword(checkedPassword.password),
    });
  } catch (error) {
    // Ник заняли между проверкой выше и вставкой — обычная гонка, не сбой.
    if (error.status === 409) return res.status(409).json({ error: error.message });
    throw error;
  }

  issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');

  const user = await users.findByUsername(username);
  // Одинаковый текст для неверного ника и неверного пароля,
  // чтобы не подсказывать, какие ники существуют.
  const invalid = { error: 'Неверный ник или пароль' };
  if (!user) return res.status(401).json(invalid);
  if (!(await verifyPassword(password, user.passwordHash))) return res.status(401).json(invalid);

  issueSession(res, user);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.delete('/account', requireAuth, async (req, res) => {
  const password = String(req.body?.password ?? '');
  if (!(await verifyPassword(password, req.user.passwordHash))) {
    return res.status(403).json({ error: 'Неверный пароль' });
  }
  await users.remove(req.user.id);
  clearSession(res);
  res.json({ ok: true });
});
