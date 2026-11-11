import { createServer } from "node:http";
import { MAX_RPC_BYTES } from "./limits.mjs";
import { DatabaseSync, backup } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  config,
  body,
  json,
  equal,
  fail,
  hash,
  verify,
  sha,
  publicUser,
  empty,
  collections,
  log,
} from "./common.mjs";
import { changesBetween, logAccountChanges } from "./action-log.mjs";

const cfg = config();
fs.mkdirSync(cfg.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(cfg.dataDir, "ordem-certa.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, operation TEXT NOT NULL, details TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS history_entries(
    id TEXT PRIMARY KEY, date TEXT NOT NULL, action TEXT NOT NULL,
    osNumber TEXT, login TEXT, fullName TEXT, accessLevel INTEGER,
    serverActorId TEXT, serverReceivedAt TEXT, detail TEXT
 );
 CREATE INDEX IF NOT EXISTS idx_history_os ON history_entries(osNumber);
 CREATE INDEX IF NOT EXISTS idx_history_login ON history_entries(login);
 CREATE INDEX IF NOT EXISTS idx_history_date ON history_entries(date DESC);`);
if (!db.prepare("SELECT id FROM state").get())
  db.prepare("INSERT INTO state VALUES(1,0,?)").run(JSON.stringify(empty()));
// MIGRACAO AUTOMATICA DO HISTORICO PARA A TABELA NOVA
const rowState = db
  .prepare("SELECT revision, payload FROM state WHERE id=1")
  .get();
if (rowState) {
  const stateObj = JSON.parse(rowState.payload);
  if (stateObj.historyEntries && stateObj.historyEntries.length > 0) {
    console.log(
      `[DBSRV] Iniciando migracao de ${stateObj.historyEntries.length} registros de historico para a nova tabela...`,
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      const insertHist = db.prepare(
        "INSERT OR IGNORE INTO history_entries(id, date, action, osNumber, login, fullName, accessLevel, serverActorId, serverReceivedAt, detail) VALUES(?,?,?,?,?,?,?,?,?,?)",
      );
      for (const e of stateObj.historyEntries) {
        insertHist.run(
          e.id,
          e.date,
          e.action,
          e.osNumber || null,
          e.login || null,
          e.fullName || null,
          e.accessLevel || 0,
          e.serverActorId || null,
          e.serverReceivedAt || null,
          e.detail || "",
        );
      }
      stateObj.historyEntries = []; // Esvazia o JSON
      db.prepare("UPDATE state SET payload=? WHERE id=1").run(
        JSON.stringify(stateObj),
      );
      db.exec("COMMIT");
      console.log("[DBSRV] Migracao concluida! O JSON esta limpo e ultraleve.");
    } catch (err) {
      db.exec("ROLLBACK");
      console.error("[DBSRV] Falha na migracao:", err);
    }
  }
}
let cached;
const load = () => {
  if (cached) return cached;
  const row = db.prepare("SELECT revision,payload FROM state WHERE id=1").get();
  const parsed = JSON.parse(row.payload);
  // Mantemos o array vazio no JSON para o TMSRV não crashar ao tentar adicionar novas linhas
  if (!parsed.historyEntries) parsed.historyEntries = [];
  cached = { revision: row.revision, state: parsed };
  return cached;
};

function commit(state, revision, actor, operation, details = {}) {
  const previous = load().state;
  const actorLogin = previous.users.find((u) => u.id === actor)?.login || actor;
  db.exec("BEGIN IMMEDIATE");
  try {
    state.updatedAt = new Date().toISOString();

    // --- EXTRAÇÃO (PASSO 1.2) ---
    // Pega o histórico novo que veio do TMSRV e limpa o array do estado principal
    const newHistory = state.historyEntries || [];
    state.historyEntries = [];
    // ----------------------------

    // Grava o JSON (agora ultraleve, sem o histórico) na tabela state
    const r = db
      .prepare(
        "UPDATE state SET revision=revision+1,payload=? WHERE id=1 AND revision=?",
      )
      .run(JSON.stringify(state), revision);
    if (!r.changes)
      fail(409, "A base mudou durante a operacao. Atualize e tente novamente.");

    // --- INSERÇÃO NA NOVA TABELA (PASSO 1.2) ---
    // Insere as linhas novas de auditoria apenas na tabela relacional
    if (newHistory.length > 0) {
      const insertHist = db.prepare(
        "INSERT OR IGNORE INTO history_entries(id, date, action, osNumber, login, fullName, accessLevel, serverActorId, serverReceivedAt, detail) VALUES(?,?,?,?,?,?,?,?,?,?)",
      );
      for (const e of newHistory) {
        insertHist.run(
          e.id,
          e.date,
          e.action,
          e.osNumber || null,
          e.login || null,
          e.fullName || null,
          e.accessLevel || 0,
          e.serverActorId || null,
          e.serverReceivedAt || null,
          e.detail || "",
        );
      }
    }
    // -------------------------------------------

    if (operation === "save") {
      const users = new Map(state.users.map((u) => [u.id, u]));
      for (const old of previous.users) {
        const current = users.get(old.id);
        if (
          !current ||
          !current.accessLevel ||
          current.passwordHash !== old.passwordHash
        )
          db.prepare("DELETE FROM sessions WHERE userId=?").run(old.id);
      }
    }
    db.prepare(
      "INSERT INTO audit(at,actor,operation,details) VALUES(?,?,?,?)",
    ).run(state.updatedAt, actor, operation, JSON.stringify(details));
    db.exec("COMMIT");
    cached = { revision: revision + 1, state };
    log("DBSRV.SALVAMENTO_CONCLUIDO", {
      usuario: actorLogin,
      operacao: operation,
      revisao: revision + 1,
      registros: details.records || 0,
    });
    logAccountChanges(
      changesBetween(previous, state),
      actorLogin,
      revision + 1,
    );
    return { revision: revision + 1, updatedAt: state.updatedAt };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function session(token) {
  const s = db
    .prepare("SELECT userId FROM sessions WHERE token=? AND expires>?")
    .get(sha(token || ""), Date.now());
  const user =
    s && load().state.users.find((u) => u.id === s.userId && u.accessLevel > 0);
  if (!user) fail(401, "Sessao expirada. Entre novamente.");
  return publicUser(user);
}
const attempts = new Map();
function rate(key, limit = 8) {
  const now = Date.now();
  const r = attempts.get(key);
  if (r && r.until > now && r.count >= limit)
    fail(429, "Muitas tentativas. Aguarde um minuto.");
  if (!r || r.until <= now) attempts.set(key, { count: 1, until: now + 60000 });
  else r.count++;
}

let backupBusy = false;
async function makeBackup() {
  if (backupBusy) return;
  backupBusy = true;
  try {
    const dir = path.join(cfg.dataDir, "backups");
    fs.mkdirSync(dir, { recursive: true });

    // 1. Cria o novo backup
    const file = path.join(
      dir,
      `ordem-certa-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
    );
    await backup(db, file);
    log("DBSRV.BACKUP_CONCLUIDO", { arquivo: path.basename(file) });

    // 2. O "Faxineiro": Mantém apenas os 20 backups mais recentes
    const maxBackups = 20;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("ordem-certa-") && f.endsWith(".sqlite"))
      .map((f) => ({
        name: f,
        path: path.join(dir, f),
        time: fs.statSync(path.join(dir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time); // Ordena do mais novo para o mais velho

    if (files.length > maxBackups) {
      const toDelete = files.slice(maxBackups);
      for (const f of toDelete) {
        fs.unlinkSync(f.path);
      }
      log("DBSRV.BACKUP_EXPURGO", {
        removidos: toDelete.length,
        limite: maxBackups,
      });
    }

    return file;
  } catch (err) {
    log("DBSRV.BACKUP_FALHOU", { motivo: err.message });
  } finally {
    backupBusy = false;
  }
}

const server = createServer(async (req, res) => {
  const context = { operacao: "acesso interno", ip: req.socket.remoteAddress };
  try {
    if (!equal(req.headers["x-oc-internal"] || "", cfg.internalKey))
      fail(403, "Acesso interno negado.");
    if (req.method !== "POST" || req.url !== "/rpc")
      fail(404, "Rota inexistente.");
    const p = await body(req, MAX_RPC_BYTES);
    context.operacao = p.action;
    if (p.action === "login") {
      context.conta = String(p.login || "");
      context.ip = p.ip;
    }
    let result;
    switch (p.action) {
      case "health":
        result = { ok: true, service: "DBSRV", revision: load().revision };
        break;
      case "version":
        result = {
          revision: load().revision,
          updatedAt: load().state.updatedAt,
        };
        break;
      case "read":
        result = load();
        break;
      case "readHistory": {
        let query = "SELECT * FROM history_entries";
        const params = [];
        const conditions = [];

        // Filtro por Ordem de Serviço
        if (p.osFilter) {
          conditions.push("LOWER(osNumber) LIKE ?");
          params.push(`%${p.osFilter.toLowerCase()}%`);
        }
        // Filtro por Usuário
        if (p.userFilter && p.userFilter !== "todos") {
          conditions.push("LOWER(login) = ?");
          params.push(p.userFilter.toLowerCase());
        }

        if (conditions.length > 0) {
          query += " WHERE " + conditions.join(" AND ");
        }

        // Paginação direto no banco: ordena por data e traz só os últimos 200
        query += " ORDER BY date DESC LIMIT 200";

        const historyEntries = db.prepare(query).all(...params);
        result = { historyEntries };
        break;
      }
      case "commit":
        if (!p.state || !collections.every((k) => Array.isArray(p.state[k])))
          fail(400, "Estado invalido.");
        result = commit(
          p.state,
          p.revision,
          p.actor || "TMSRV",
          "save",
          p.details,
        );
        break;
      case "login": {
        rate(`ip:${p.ip}`, 120);
        rate(`user:${String(p.login).trim().toLowerCase()}`);
        const { revision } = load();
        const state = structuredClone(load().state);
        const u = state.users.find(
          (u) =>
            String(u.login).toLowerCase() ===
            String(p.login).trim().toLowerCase(),
        );
        if (
          !u ||
          !u.accessLevel ||
          !(
            verify(p.password, u.passwordHash) ||
            verify(sha(p.password), u.passwordHash)
          )
        )
          fail(401, "Usuario ou senha invalidos.");
        // Upgrade legacy client-side SHA hashes to a server-side password hash.
        u.passwordHash = hash(p.password);
        commit(state, revision, u.id, "login");
        const token = crypto.randomBytes(32).toString("hex");
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
          sha(token),
          u.id,
          Date.now() + 8 * 3600000,
        );
        log("DBSRV.LOGIN_APROVADO", {
          conta: u.login,
          usuario: u.id,
          ip: p.ip,
        });
        result = { ok: true, token, user: publicUser(u) };
        break;
      }
      case "session":
        result = session(p.token);
        break;
      case "logout": {
        const user = session(p.token);
        db.prepare("DELETE FROM sessions WHERE token=?").run(
          sha(p.token || ""),
        );
        log("DBSRV.LOGOUT", { conta: user.login });
        result = { ok: true };
        break;
      }
      case "password": {
        const user = session(p.token);
        const { revision } = load();
        const state = structuredClone(load().state);
        context.conta = user.login;
        const u = state.users.find((x) => x.id === user.id);
        if (
          !(
            verify(p.currentPassword, u.passwordHash) ||
            verify(sha(p.currentPassword), u.passwordHash)
          )
        )
          fail(401, "Senha atual incorreta.");
        if (typeof p.newPassword !== "string" || p.newPassword.length < 8)
          fail(400, "A nova senha deve ter pelo menos 8 caracteres.");
        u.passwordHash = hash(p.newPassword);
        result = {
          ...commit(state, revision, u.id, "password"),
          ok: true,
          user: publicUser(u),
        };
        db.prepare("DELETE FROM sessions WHERE userId=? AND token<>?").run(
          u.id,
          sha(p.token),
        );
        log("DBSRV.CREDENCIAL_ALTERADA", {
          conta: u.login,
          outrasSessoes: "invalidadas",
        });
        break;
      }
      case "backup":
        session(p.token).accessLevel >= 91 ||
          fail(403, "Acesso administrativo necessario.");
        await makeBackup();
        result = { ok: true };
        break;
      default:
        fail(400, "Operacao desconhecida.");
    }
    json(res, 200, result);
  } catch (e) {
    log(
      context.operacao === "login"
        ? "DBSRV.LOGIN_RECUSADO"
        : "DBSRV.OPERACAO_RECUSADA",
      { ...context, status: e.status || 500, motivo: e.message },
    );
    json(res, e.status || 500, {
      error: e.status ? e.message : "Falha interna no DBSRV.",
    });
  }
});
server.requestTimeout = 60000;
server.listen(cfg.dbPort || 4174, "127.0.0.1", () => {
  log("DBSRV.INICIADO", { host: "127.0.0.1", porta: cfg.dbPort || 4174 });
  log("DBSRV.CONTAS_CARREGADAS", {
    contas: load().state.users.length,
    ordens: load().state.orders.length,
    revisao: load().revision,
  });
});
server.on("error", (e) => {
  log("DBSRV.fatal", { message: e.message });
  process.exit(1);
});
setInterval(() => {
  const r = db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  if (r.changes) log("DBSRV.SESSOES_EXPIRADAS", { quantidade: r.changes });
  for (const [k, v] of attempts) if (v.until < Date.now()) attempts.delete(k);
}, 60000).unref();
const backupTimer = setInterval(
  () =>
    makeBackup().catch((e) =>
      log("DBSRV.BACKUP_FALHOU", { motivo: e.message }),
    ),
  Math.max(5, cfg.backupMinutes || 60) * 60000,
);
backupTimer.unref();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
