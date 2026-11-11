import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { root, config, body, json, fail, cleanState, log } from './common.mjs';
import { applyOperations } from './rules.mjs';
import { MAX_UPDATE_BYTES } from './limits.mjs';
import { changesBetween, logApplicationChanges } from './action-log.mjs';
const cfg = config();
const publicDir = path.join(root, 'public');
const presence = new Map();
const rpc = async payload => {
  let r;
  try { r = await fetch(`http://127.0.0.1:${cfg.dbPort || 4174}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-oc-internal': cfg.internalKey }, body: JSON.stringify(payload), signal: AbortSignal.timeout(45000) }); }
  catch { fail(503, 'DBSRV indisponivel. Verifique o servidor de dados.'); }
  const data = await r.json(); if (!r.ok) fail(r.status, data.error); return data;
};
const token = req => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('oc_session='))?.slice(11) || '';
const presenceData = () => Object.fromEntries([...presence.entries()].map(([id, v]) => [id, { ...v, online: Date.now() - Date.parse(v.lastSeenAt) < 45000 }]));
let mutations = Promise.resolve();
function serial(fn) { const p = mutations.then(fn); mutations = p.catch(() => { }); return p; }
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const handler = async (req, res) => {
  const context = { requisicao: crypto.randomUUID().slice(0, 8), usuario: 'nao autenticado', metodo: req.method, ip: req.socket.remoteAddress };
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(req.url, 'http://localhost');
    context.rota = url.pathname;
    if (req.headers.origin && ![cfg.publicUrl, `http://${req.headers.host}`, `https://${req.headers.host}`].filter(Boolean).includes(req.headers.origin)) fail(403, 'Origem nao autorizada.');
    const route = url.pathname;
    if (route === '/api/health') { await rpc({ action: 'health' }); return json(res, 200, { ok: true, service: 'TMSRV', version: '1.0.0' }); }
    if (route === '/api/login' && req.method === 'POST') {
      const p = await body(req, 8192);
      if (typeof p.login !== 'string' || p.login.length > 100 || typeof p.password !== 'string' || p.password.length > 1024) fail(400, 'Login invalido.');
      const data = await serial(() => rpc({ action: 'login', login: p.login, password: p.password, ip: req.socket.remoteAddress }));
      log('TMSRV.USUARIO_CONECTADO', { ...context, usuario: data.user.login });
      return json(res, 200, data, { 'Set-Cookie': `oc_session=${data.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${cfg.tls || cfg.publicUrl?.startsWith('https:') ? '; Secure' : ''}` });
    }
    if (route.startsWith('/api/')) {
      const t = token(req);
      const user = await rpc({ action: 'session', token: t });
      context.usuario = user.login;
      if (route === '/api/activity' && req.method === 'POST') {
        const p = await body(req, 16384);
        if (!Array.isArray(p.events) || p.events.length > 20) fail(400, 'Lote de atividades invalido.');
        for (const e of p.events) {
          if (!e || !['tela', 'filtro', 'pesquisa', 'comando', 'arquivo'].includes(e.kind) || typeof e.control !== 'string' || e.control.length > 100 || !/^[\w:-]+$/.test(e.control)) fail(400, 'Atividade invalida.');
        }
        for (const e of p.events) log('TMSRV.INTERFACE_' + e.kind.toUpperCase(), { ...context, controle: e.control, acao: String(e.label || e.control).slice(0, 100), origem: 'informada pelo cliente' });
        return json(res, 200, { ok: true });
      }
      if (route === '/api/logout' && req.method === 'POST') { presence.delete(user.id); await rpc({ action: 'logout', token: t }); log('TMSRV.USUARIO_DESCONECTADO', context); return json(res, 200, { ok: true }, { 'Set-Cookie': 'oc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
      if (route === '/api/profile/change-password' && req.method === 'POST') { const p = await body(req, 8192); const result = await serial(() => rpc({ ...p, action: 'password', token: t })); log('TMSRV.CREDENCIAL_ALTERADA', context); return json(res, 200, result); }
      if (route === '/api/presence' && ['GET', 'POST'].includes(req.method)) {
        if (req.method === 'POST') presence.set(user.id, { userId: user.id, login: user.login, fullName: user.fullName, collaboratorId: user.collaboratorId, lastSeenAt: new Date().toISOString() });
        return json(res, 200, { ok: true, presence: presenceData() });
      }
      if (route === '/api/state' && req.method === 'GET') { const { state, revision } = await rpc({ action: 'read' }); log('TMSRV.BASE_CARREGADA', { ...context, revisao: revision }); return json(res, 200, { ...cleanState(state), revision }); }
      if (route === '/api/state-version' && req.method === 'GET') return json(res, 200, await rpc({ action: 'version' }));
      // FASE 2 (Passo 2) ATUALIZADO: Consulta SQL de alta performance (Passo 1.3)
      if (route === '/api/history' && req.method === 'GET') {
        const osFilter = url.searchParams.get('os') || '';
        const userFilter = url.searchParams.get('user') || '';

        // Agora o TMSRV pede ao DBSRV para pesquisar os dados no disco, sem baixar o JSON principal
        const { historyEntries } = await rpc({
          action: 'readHistory',
          osFilter,
          userFilter
        });

        log('TMSRV.HISTORICO_CARREGADO', { ...context, total: historyEntries.length, enviados: historyEntries.length });
        return json(res, 200, { historyEntries });
      }
      if (route === '/api/state/diagnose' && req.method === 'POST') {
        const p = await body(req, MAX_UPDATE_BYTES);
        const freshUser = await rpc({ action: 'session', token: t });
        const { state, revision } = await rpc({ action: 'read' });
        const checked = applyOperations(state, p.operations, freshUser, { diagnostic: true });
        return json(res, 200, {
          at: new Date().toISOString(), revision, readOnly: true, errors: checked.errors,
          note: 'Simulacao sobre a base atual. Nenhum registro foi salvo. Em um salvamento rejeitado por validacao, o lote inteiro permanece sem gravacao.'
        });
      }
      if (route === '/api/state' && req.method === 'PUT') {
        const p = await body(req, MAX_UPDATE_BYTES);
        if (!Array.isArray(p.operations)) fail(400, 'Cliente antigo. Atualize o Ordem Certa.');
        const result = await serial(async () => {
          const freshUser = await rpc({ action: 'session', token: t });
          const { state, revision } = await rpc({ action: 'read' });
          const next = applyOperations(state, p.operations, freshUser, { allowMissingProcessDates: p.allowMissingProcessDates === true });
          if (!next.applied) return { ok: true, updatedAt: state.updatedAt };
          for (const warning of next.warnings) next.state.historyEntries.push({
            id: crypto.randomUUID(), date: new Date().toISOString(), action: 'Obra concluida com processo pendente',
            osNumber: warning.osNumber, login: freshUser.login, fullName: freshUser.fullName, accessLevel: freshUser.accessLevel,
            serverActorId: freshUser.id, serverReceivedAt: new Date().toISOString(),
            detail: 'Obra concluida; processos continuam pendentes (data ou VOZ ausente): ' + warning.processes.join(', ') + (warning.active ? '. Processo ativo preservado.' : '')
          });
          const changes = changesBetween(state, next.state);
          const saved = await rpc({ action: 'commit', state: next.state, revision, actor: freshUser.id, details: { records: next.applied } });
          logApplicationChanges(changes, freshUser, saved.revision, context.requisicao);
          for (const warning of next.warnings) log('TMSRV.CONCLUSAO_COM_PROCESSO_PENDENTE', { ...context, os: warning.osNumber, processos: warning.processes, revisao: saved.revision });
          log('TMSRV.SALVAMENTO_CONFIRMADO', { ...context, registros: changes.length, revisao: saved.revision });
          return { ok: true, ...saved };
        });
        return json(res, 200, result);
      }
      if (route === '/api/backup' && req.method === 'POST') { const result = await rpc({ action: 'backup', token: t }); log('TMSRV.BACKUP_CONFIRMADO', context); return json(res, 200, result); }
      fail(404, 'API inexistente.');
    }
    if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Metodo nao permitido.');
    let requested;
    try { requested = decodeURIComponent(route); } catch { fail(400, 'URL invalida.'); }
    const file = path.resolve(publicDir, '.' + (requested === '/' ? '/index.html' : requested));
    const rel = path.relative(publicDir, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) fail(403, 'Caminho negado.');
    const data = await fs.readFile(file).catch(() => fail(404, 'Arquivo nao encontrado.'));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (e) { log('TMSRV.OPERACAO_RECUSADA', { ...context, status: e.status || 500, motivo: e.message }); json(res, e.status || 500, { error: e.status ? e.message : 'Falha interna no TMSRV.' }); }
};
const server = cfg.tls
  ? https.createServer({ key: await fs.readFile(path.resolve(root, cfg.tls.key)), cert: await fs.readFile(path.resolve(root, cfg.tls.cert)) }, handler)
  : http.createServer(handler);
server.requestTimeout = 60000;
server.listen(cfg.tmPort || 4173, cfg.tmHost || '127.0.0.1', () => log('TMSRV.ready', { host: cfg.tmHost || '127.0.0.1', port: cfg.tmPort || 4173 }));
server.on('error', e => { log('TMSRV.fatal', { message: e.message }); process.exit(1); });
setInterval(() => { for (const [id, p] of presence) if (Date.now() - Date.parse(p.lastSeenAt) > 3600000) presence.delete(id); }, 60000).unref();
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => server.close(() => process.exit(0)));
