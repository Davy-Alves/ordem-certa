import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const root = path.resolve(import.meta.dirname, '..');
export function config() {
  const file = process.env.OC_CONFIG || path.join(root, 'servidor.json');
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!c.internalKey || c.internalKey.length < 40) throw new Error('Configure internalKey com pelo menos 40 caracteres.');
  c.dataDir = path.resolve(path.dirname(file), c.dataDir || 'data');
  return c;
}
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
export async function body(req, max = 32 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > max) fail(413, 'Requisicao muito grande.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}', (key, value) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(400, 'Chave invalida.');
    return value;
  }); } catch (e) { if (e.status) throw e; fail(400, 'JSON invalido.'); }
}
export const sha = value => crypto.createHash('sha256').update(String(value)).digest('hex');
export function hash(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `pbkdf2$210000$${salt}$${crypto.pbkdf2Sync(String(secret), salt, 210000, 32, 'sha256').toString('hex')}`;
}
export function verify(secret, stored = '') {
  if (/^[a-f0-9]{64}$/i.test(stored)) return equal(sha(secret), stored.toLowerCase());
  const [type, count, salt, expected] = stored.split('$');
  if (type !== 'pbkdf2' || !/^[a-f0-9]{64}$/i.test(expected || '') || !salt || +count < 1 || +count > 1000000) return false;
  return equal(crypto.pbkdf2Sync(String(secret), salt, +count, 32, 'sha256').toString('hex'), expected);
}
export function equal(a, b) { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
export function publicUser(u) { const { passwordHash, ...safe } = u; return safe; }
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const collections = ['orders', 'users', 'collaborators', 'historyEntries', 'distributionEntries'];
export function empty() { return { version: 4, updatedAt: new Date().toISOString(), orders: [], users: [], collaborators: [], historyEntries: [], distributionEntries: [], deletedOrderIds: [] }; }
export function cleanState(s) { return { ...s, users: s.users.map(publicUser), loginBlocks: undefined }; }
const logText = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').slice(0, 500);
export function log(event, details = {}) {
  const safe = Object.fromEntries(Object.entries(details).map(([key,value]) => [logText(key),
    /password|senha|token|hash|secret|authorization|cookie|internalkey/i.test(key) ? '[oculto]'
      : typeof value === 'number' || typeof value === 'boolean' ? value
      : logText(Array.isArray(value) ? value.join(', ') : value ?? '')]));
  console.log(JSON.stringify({ at: new Date().toISOString(), hora: new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}), event:logText(event), ...safe }));
}
