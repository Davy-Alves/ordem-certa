import { createServer } from 'node:http';
import { MAX_RPC_BYTES } from './limits.mjs';
import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, body, json, equal, fail, hash, verify, sha, publicUser, empty, collections, log } from './common.mjs';
import { changesBetween, logAccountChanges } from './action-log.mjs';

const cfg = config();
fs.mkdirSync(cfg.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(cfg.dataDir, 'ordem-certa.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, operation TEXT NOT NULL, details TEXT NOT NULL);`);
if (!db.prepare('SELECT id FROM state').get()) db.prepare('INSERT INTO state VALUES(1,0,?)').run(JSON.stringify(empty()));
let cached;
const load = () => { if(cached)return cached; const row = db.prepare('SELECT revision,payload FROM state WHERE id=1').get(); cached={ revision: row.revision, state: JSON.parse(row.payload) }; return cached; };
function commit(state, revision, actor, operation, details = {}) {
  const previous=load().state;
  const actorLogin=previous.users.find(u=>u.id===actor)?.login || actor;
  db.exec('BEGIN IMMEDIATE');
  try {
    state.updatedAt = new Date().toISOString();
    const r = db.prepare('UPDATE state SET revision=revision+1,payload=? WHERE id=1 AND revision=?').run(JSON.stringify(state), revision);
    if (!r.changes) fail(409, 'A base mudou durante a operacao. Atualize e tente novamente.');
    db.prepare('INSERT INTO audit(at,actor,operation,details) VALUES(?,?,?,?)').run(state.updatedAt, actor, operation, JSON.stringify(details));
    db.exec('COMMIT');
    cached={revision:revision+1,state};
    log('DBSRV.SALVAMENTO_CONCLUIDO',{usuario:actorLogin,operacao:operation,revisao:revision+1,registros:details.records||0});
    logAccountChanges(changesBetween(previous,state),actorLogin,revision+1);
    return { revision: revision + 1, updatedAt: state.updatedAt };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
function session(token) {
  const s = db.prepare('SELECT userId FROM sessions WHERE token=? AND expires>?').get(sha(token || ''), Date.now());
  const user = s && load().state.users.find(u => u.id === s.userId && u.accessLevel > 0);
  if (!user) fail(401, 'Sessao expirada. Entre novamente.');
  return publicUser(user);
}
const attempts = new Map();
function rate(key,limit=8) {
  const now = Date.now(); const r = attempts.get(key);
  if (r && r.until > now && r.count >= limit) fail(429, 'Muitas tentativas. Aguarde um minuto.');
  if (!r || r.until <= now) attempts.set(key, { count: 1, until: now + 60000 });
  else r.count++;
}
let backupBusy = false;
async function makeBackup() {
  if (backupBusy) return;
  backupBusy = true;
  try {
    const dir = path.join(cfg.dataDir, 'backups'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `ordem-certa-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
    await backup(db, file);
    // Retention is deliberately manual: never silently delete a user's backups.
    log('DBSRV.BACKUP_CONCLUIDO', { arquivo: path.basename(file) }); return file;
  } finally { backupBusy = false; }
}
const server = createServer(async (req, res) => {
  const context={operacao:'acesso interno',ip:req.socket.remoteAddress};
  try {
    if (!equal(req.headers['x-oc-internal'] || '', cfg.internalKey)) fail(403, 'Acesso interno negado.');
    if (req.method !== 'POST' || req.url !== '/rpc') fail(404, 'Rota inexistente.');
    const p = await body(req, MAX_RPC_BYTES);
    context.operacao=p.action;
    if(p.action==='login') {context.conta=String(p.login||'');context.ip=p.ip;}
    let result;
    switch (p.action) {
      case 'health': result = { ok: true, service: 'DBSRV', revision: load().revision }; break;
      case 'version': result = {revision:load().revision,updatedAt:load().state.updatedAt}; break;
      case 'read': result = load(); break;
      case 'commit':
        if (!p.state || !collections.every(k => Array.isArray(p.state[k]))) fail(400, 'Estado invalido.');
        result = commit(p.state, p.revision, p.actor || 'TMSRV', 'save', p.details); break;
      case 'login': {
        rate(`ip:${p.ip}`,120); rate(`user:${String(p.login).toLowerCase()}`);
        const { revision } = load(); const state=structuredClone(load().state);
        const u = state.users.find(u => String(u.login).toLowerCase() === String(p.login).trim().toLowerCase());
        if (!u || !u.accessLevel || !(verify(p.password, u.passwordHash) || verify(sha(p.password), u.passwordHash))) fail(401, 'Usuario ou senha invalidos.');
        // Upgrade legacy client-side SHA hashes to a server-side password hash.
        u.passwordHash = hash(p.password);
        commit(state, revision, u.id, 'login');
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token), u.id, Date.now() + 8 * 3600000);
        log('DBSRV.LOGIN_APROVADO',{conta:u.login,usuario:u.id,ip:p.ip});
        result = { ok: true, token, user: publicUser(u) }; break;
      }
      case 'session': result = session(p.token); break;
      case 'logout': { const user=session(p.token); db.prepare('DELETE FROM sessions WHERE token=?').run(sha(p.token || '')); log('DBSRV.LOGOUT',{conta:user.login}); result = { ok: true }; break; }
      case 'password': {
        const user = session(p.token); const { revision } = load(); const state=structuredClone(load().state);
        context.conta=user.login;
        const u = state.users.find(x => x.id === user.id);
        if (!(verify(p.currentPassword, u.passwordHash) || verify(sha(p.currentPassword), u.passwordHash))) fail(401, 'Senha atual incorreta.');
        if (typeof p.newPassword !== 'string' || p.newPassword.length < 8) fail(400, 'A nova senha deve ter pelo menos 8 caracteres.');
        u.passwordHash = hash(p.newPassword);
        result = { ...commit(state, revision, u.id, 'password'), ok: true, user: publicUser(u) };
        db.prepare('DELETE FROM sessions WHERE userId=? AND token<>?').run(u.id, sha(p.token));
        log('DBSRV.CREDENCIAL_ALTERADA',{conta:u.login,outrasSessoes:'invalidadas'});
        break;
      }
      case 'backup': session(p.token).accessLevel >= 91 || fail(403, 'Acesso administrativo necessario.'); await makeBackup(); result = { ok: true }; break;
      default: fail(400, 'Operacao desconhecida.');
    }
    json(res, 200, result);
  } catch (e) { log(context.operacao==='login'?'DBSRV.LOGIN_RECUSADO':'DBSRV.OPERACAO_RECUSADA', {...context,status:e.status||500,motivo:e.message}); json(res, e.status || 500, { error: e.status ? e.message : 'Falha interna no DBSRV.' }); }
});
server.requestTimeout = 60000;
server.listen(cfg.dbPort || 4174, '127.0.0.1', () => {
  log('DBSRV.INICIADO', { host: '127.0.0.1', porta: cfg.dbPort || 4174 });
  log('DBSRV.CONTAS_CARREGADAS',{contas:load().state.users.length,ordens:load().state.orders.length,revisao:load().revision});
});
server.on('error', e => { log('DBSRV.fatal', { message: e.message }); process.exit(1); });
setInterval(() => { const r=db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now()); if(r.changes)log('DBSRV.SESSOES_EXPIRADAS',{quantidade:r.changes}); for (const [k,v] of attempts) if (v.until < Date.now()) attempts.delete(k); }, 60000).unref();
const backupTimer = setInterval(() => makeBackup().catch(e => log('DBSRV.BACKUP_FALHOU', { motivo: e.message })), Math.max(5, cfg.backupMinutes || 60) * 60000);
backupTimer.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
