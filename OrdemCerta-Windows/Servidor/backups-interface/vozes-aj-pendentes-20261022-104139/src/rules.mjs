import { fail, same, publicUser, hash } from './common.mjs';
import { MAX_OPERATIONS } from './limits.mjs';
const keys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter(k => !same(a?.[k], b?.[k]));
const allowed = (changed, list) => changed.every(k => list.includes(k));
const statusFields = ['fieldStatus', 'cadStatus', 'budgetStatus', 'updatedAt', 'timeTracking'];
const normalize = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const queueField = stage => ({'Levantamento de Campo':'fieldTech','Criacao de CAD':'cadist','Orcamento':'budgeter'})[stage];
const active = order => !order.pendencyState?.active && ['ROTEIRIZACAO','PROGRAMADO','EM ANDAMENTO','NAO TRATADO','EM ESPERA'].includes(normalize(order[{'Levantamento de Campo':'fieldStatus','Criacao de CAD':'cadStatus','Orcamento':'budgetStatus'}[order.stage]]));
function nextOwner(state,stage,excluded) {
  let candidates=state.collaborators.filter(p=>p.queueActive!==false && p.stages?.includes(stage)).sort((a,b)=>(Number(a.queueOrder?.[stage])||9999)-(Number(b.queueOrder?.[stage])||9999));
  const last=[...state.distributionEntries].sort((a,b)=>String(b.date).localeCompare(String(a.date))).find(d=>d.stage===stage);
  const i=candidates.findIndex(p=>p.name===last?.owner);
  if(i>=0)candidates=[...candidates.slice(i+1),...candidates.slice(0,i+1)];
  return candidates.find(p=>!state.orders.some(o=>o.id!==excluded && o.stage===stage && o.owner===p.name && active(o)))?.name;
}
function validateOrder(order, before, options) {
  const issues=[];
  const issue=(field,message)=>issues.push({field,message});
  if (!String(order.osNumber || '').trim()) fail(400, 'A ordem precisa de numero de OS.');
  if (order.stage === 'Concluido' && before?.stage !== 'Concluido') {
    if (order.pendencyState?.active) issue('pendencyState.active','Resolva as pendencias antes de concluir.');
    if (order.processState?.active) issue('processState.active','Conclua o processo ativo antes de concluir a OS.');
    const flags = ['processParalelismo','processAmbiental','processLt','processFerrovia','processAcude','processRio','processTermo','processEvaluation','processOnlyCompleted'];
    const missing=flags.filter(flag=>order[flag] && !order.processDetails?.[flag]?.endDate);
    if(missing.length){
      if(!options.allowMissingProcessDates)for(const flag of missing)issue('processDetails.'+flag+'.endDate','Existe processo complementar sem data de conclusao.');
      options.warnings.push({id:order.id,osNumber:order.osNumber,processes:missing});
    }
    const voiceMap = {processParalelismo:'paralelismo',processAmbiental:'ambiental',processLt:'travessiaLt',processRio:'travessiaRio',processTermo:'termo'};
    if (!order.voices?.project?.code) issue('voices.project.code','Preencha a VOZ do projeto antes de concluir.');
    for(const [flag,voice] of Object.entries(voiceMap)) if(order[flag] && !order.voices?.[voice]?.code) issue('voices.'+voice+'.code','Preencha as VOZES dos processos antes de concluir.');
  }
  if(issues.length)throw Object.assign(new Error(issues[0].message),{status:422,issues});
}
export function authorize(collection, before, after, user, state, options={allowMissingProcessDates:false,warnings:[]}) {
  const level = Number(user.accessLevel);
  const changed = keys(before, after).filter(k => k !== 'id');
  if (collection === 'historyEntries' || collection === 'distributionEntries') {
    if (before || !after) fail(403, 'O historico e somente de inclusao.');
    return;
  }
  if (collection === 'users') {
    if (level < 91 && (!before || !after || before.id !== user.id || !allowed(changed, ['profilePhoto', 'availabilityStatus', 'statusMessage']))) fail(403, 'Sem permissao para administrar usuarios.');
    if (after) {
      if (!after.login || !Number.isInteger(after.accessLevel) || after.accessLevel < 0 || after.accessLevel > 100) fail(400, 'Usuario invalido.');
      if (after.profilePhoto && !/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(after.profilePhoto)) fail(400, 'Formato da foto invalido.');
      if (String(after.profilePhoto || '').length > 2000000) fail(400, 'Foto muito grande.');
    }
    return;
  }
  if (collection === 'collaborators') { if (level < 91) fail(403, 'Sem permissao para administrar colaboradores.'); return; }
  if (collection !== 'orders') fail(400, 'Colecao invalida.');
  if (!after) { if (level < 91) fail(403, 'Sem permissao para excluir OS.'); return; }
  validateOrder(after, before, options);
  if (!before) { if (level < 61) fail(403, 'Sem permissao para criar/importar OS.'); return; }
  if (level >= 91) return;
  // Import operators (61+) can update imported operational fields but not administration.
  if (level >= 61) return;
  if (allowed(changed, ['updatedAt', 'timeTracking'])) return;
  if (level >= 31 && allowed(changed, ['clientName', 'voices', 'updatedAt', 'timeTracking'])) return;
  const person = state.collaborators.find(p => p.id === user.collaboratorId);
  if ((!before.owner || before.owner==='Sem Responsavel') && before.stage===after.stage && after.owner===nextOwner(state,after.stage,after.id) && allowed(changed,['owner',queueField(after.stage),'priority','updatedAt','timeTracking'])) return;
  if (person && before.owner === person.name && allowed(changed, statusFields)) return;
  const transitions = {'Levantamento de Campo':['Criacao de CAD'],'Criacao de CAD':['Orcamento'],'Orcamento':['Criacao de CAD','Concluido','Processos'],'Rejeitado':['Concluido'],'Concluido':['Rejeitado']};
  const movement = ['stage','owner','fieldTech','cadist','budgeter','fieldStatus','cadStatus','budgetStatus','startDate','finishDate','remoteEvaluated','remoteEvaluatedAt','remoteEvaluationDestination','remoteFastTrack','remoteFastTrackAt','updatedAt','timeTracking','completedAt','completedFromStage','completedByOwner','completedByUser','completedByName','completedByCollaborator','completedCadist','rejectedAt','rejectedByOwner','rejectedByUser','rejectedByName','rejectionResolvedAt','priority'];
  if (person && before.owner===person.name && transitions[before.stage]?.includes(after.stage) && allowed(changed,movement)) {
    if(before.pendencyState?.active) fail(422,'Resolva as pendencias antes de avancar.');
    const targetField=queueField(after.stage);
    if(targetField && after.owner && after.owner!=='Sem Responsavel' && after.owner!==before[targetField] && after.owner!==nextOwner(state,after.stage,after.id)) fail(409,'A fila mudou. Atualize antes de distribuir.');
    return;
  }
  const processFields = ['processStatus', 'processStartDate', 'processEndDate', 'processNotes', 'processLink', 'processFiles', 'processDetails', 'updatedAt', 'timeTracking'];
  if (person && (before.processOwner === person.name || Object.values(before.processOwners || {}).includes(person.name)) && allowed(changed, processFields)) return;
  fail(403, 'Seu perfil nao permite esta alteracao na OS.');
}
export function applyOperations(state, operations, user, confirmation={}) {
  const options={allowMissingProcessDates:confirmation.allowMissingProcessDates===true,warnings:[]};
  const errors=[];
  if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS) fail(400, `Lote invalido (maximo ${MAX_OPERATIONS.toLocaleString('pt-BR')} operacoes).`);
  let applied = 0;
  const next = structuredClone(state);
  const maps = Object.fromEntries(['orders','users','collaborators','historyEntries','distributionEntries'].map(k => [k, new Map(next[k].map(x => [x.id, x]))]));
  for (const op of operations) {
    try {
    const { collection, id, before, after } = op;
    if (!maps[collection] || typeof id !== 'string' || !id || id.length > 200 || (after && after.id !== id) || (before && before.id !== id)) fail(400, 'Registro invalido.');
    const current = maps[collection].get(id);
    const visible = current && (collection === 'users' ? publicUser(current) : current);
    if (collection === 'historyEntries' || collection === 'distributionEntries') {
      if (current) continue; // Retry-safe append; caller cannot edit audit records.
    }
    if (!before && current) { if (same(visible, after)) continue; fail(409, 'Registro ja existe. Atualize a tela.'); }
    if (before && !current) { if (!after) continue; fail(409, 'O registro foi excluido por outro usuario.'); }
    let merged = after && { ...current };
    const changes = keys(before, after).filter(k => k !== 'id');
    if (!before) merged = after && { ...after };
    else if (after) {
      for (const field of changes) {
        if (['updatedAt', 'timeTracking'].includes(field)) continue;
        if (!same(visible?.[field], before[field]) && !same(visible?.[field], after[field])) fail(409, `Conflito no campo ${field}. Atualize a tela antes de salvar.`);
        if (Object.hasOwn(after, field)) merged[field] = after[field]; else delete merged[field];
      }
      // Timers are preserved from the client only with a real operational change.
      if (changes.some(k => !['updatedAt','timeTracking'].includes(k))) {
        if (after.timeTracking) merged.timeTracking = after.timeTracking;
        merged.updatedAt = new Date().toISOString();
      }
    } else if (!same(visible, before)) fail(409, 'O registro mudou antes da exclusao. Atualize a tela.');
    authorize(collection, visible, merged && (collection === 'users' ? { ...publicUser(merged), ...(after.passwordHash ? { passwordHash: after.passwordHash } : {}) } : merged), user, {
      ...next,
      get orders(){return [...maps.orders.values()];},
      get distributionEntries(){return [...maps.distributionEntries.values()];}
    }, options);
    if (collection === 'users' && merged && after?.passwordHash) {
      if (user.accessLevel < 91 || !/^[a-f0-9]{64}$/i.test(after.passwordHash)) fail(400, 'Credencial administrativa invalida.');
      merged.passwordHash = hash(after.passwordHash);
    }
    if (merged) {
      if (collection === 'historyEntries' || collection === 'distributionEntries') {
        merged.serverActorId = user.id; merged.serverReceivedAt = new Date().toISOString();
      }
      maps[collection].set(id, merged);
    } else {
      maps[collection].delete(id);
      if (collection === 'orders') next.deletedOrderIds = [...new Set([...next.deletedOrderIds, id])];
    }
    applied++;
    }catch(e){
      if(!confirmation.diagnostic || !e.status)throw e;
      errors.push({collection:op?.collection,id:op?.id,osNumber:op?.after?.osNumber||op?.before?.osNumber||null,status:e.status,message:e.message,issues:e.issues||[{field:(e.message.match(/Conflito no campo (\w+)/)||[])[1]||null,message:e.message}]});
    }
  }
  for (const [k,m] of Object.entries(maps)) next[k] = [...m.values()];
  try {
  for(const op of operations.filter(o=>o.collection==='distributionEntries' && !o.before && o.after?.type==='Automatica')) {
    const entry=op.after;
    const order=maps.orders.get(entry.orderId);
    if(order && order.owner===entry.owner && next.orders.some(o=>o.id!==order.id && o.stage===order.stage && o.owner===order.owner && active(o))) fail(409,'O colaborador recebeu outra OS. Atualize para recalcular a fila.');
  }
  const logins = next.users.map(u => String(u.login).trim().toLowerCase());
  if (new Set(logins).size !== logins.length) fail(400, 'Login duplicado.');
  if (!next.users.some(u => u.accessLevel >= 91)) fail(400, 'Mantenha pelo menos um administrador.');
  }catch(e){if(!confirmation.diagnostic || !e.status)throw e;errors.push({collection:'lote',status:e.status,message:e.message,issues:[]});}
  next.distributionEntries.sort((a,b) => String(b.date).localeCompare(String(a.date)));
  next.distributionEntries = next.distributionEntries.slice(0, 50);
  return { state: next, applied, warnings:options.warnings, errors };
}
