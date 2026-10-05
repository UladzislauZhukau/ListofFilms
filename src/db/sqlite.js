import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sqliteSchema } from './schema.js';

// Переписывает $1, $2 ... в анонимные ? и выстраивает значения
// в порядке появления, чтобы повторное использование $1 работало.
function toSqlitePlaceholders(text, params) {
  const ordered = [];
  const rewritten = text.replace(/\$(\d+)/g, (_, index) => {
    ordered.push(params[Number(index) - 1]);
    return '?';
  });
  return { rewritten, ordered };
}

function normalizeBinding(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export async function createSqliteDriver(filePath) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });

  const db = new DatabaseSync(absolute);
  db.exec(sqliteSchema);

  return {
    dialect: 'sqlite',
    label: `SQLite (${absolute})`,

    async all(text, params = []) {
      const { rewritten, ordered } = toSqlitePlaceholders(text, params);
      const statement = db.prepare(rewritten);
      const bindings = ordered.map(normalizeBinding);
      if (/^\s*(insert|update|delete)/i.test(rewritten) && !/returning/i.test(rewritten)) {
        statement.run(...bindings);
        return [];
      }
      return statement.all(...bindings);
    },

    async close() {
      db.close();
    },
  };
}
