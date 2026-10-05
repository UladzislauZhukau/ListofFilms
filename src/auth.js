import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config, limits } from './config.js';
import { users } from './db/index.js';

const USERNAME_PATTERN = /^[a-zA-Z0-9а-яА-ЯёЁ_.-]+$/u;

export function validateUsername(raw) {
  const username = String(raw ?? '').trim();
  if (username.length < limits.usernameMin || username.length > limits.usernameMax) {
    return {
      error: `Ник должен быть от ${limits.usernameMin} до ${limits.usernameMax} символов`,
    };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return { error: 'Ник может содержать только буквы, цифры и символы _ . -' };
  }
  return { username };
}

export function validatePassword(raw) {
  const password = String(raw ?? '');
  if (password.length < limits.passwordMin || password.length > limits.passwordMax) {
    return { error: `Пароль должен быть не короче ${limits.passwordMin} символов` };
  }
  return { password };
}

export function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function issueSession(res, user) {
  const token = jwt.sign({ sub: String(user.id), username: user.username }, config.sessionSecret, {
    expiresIn: `${config.sessionTtlDays}d`,
  });
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(config.cookieName, { path: '/' });
}

// Подкладывает req.user, если куки валидны. Не блокирует запрос.
export async function attachUser(req, _res, next) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.sessionSecret);
    req.user = await users.findById(Number(payload.sub));
  } catch {
    req.user = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Нужно войти в аккаунт' });
  next();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    createdAt: user.createdAt,
  };
}
