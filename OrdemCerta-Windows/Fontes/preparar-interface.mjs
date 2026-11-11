import fs from 'node:fs';
import path from 'node:path';
const dir = path.resolve(import.meta.dirname,'../Servidor/public');
let app=fs.readFileSync(path.join(dir,'app.js'),'utf8');
if(app.includes('let desktopBase')) throw new Error('Interface ja preparada.');
const transport=`
let desktopBase = null;
const desktopDraftKey = "ordem-certa-desktop-pending-v1";
function desktopOperations(snapshot) {
  if (!desktopBase) throw new Error("Carregue a base antes de editar.");
  const operations = [];
  for (const collection of ["orders","users","collaborators","historyEntries","distributionEntries"]) {
    const previous = new Map((desktopBase[collection] || []).map(x => [x.id,x]));
    const next = new Map((snapshot[collection] || []).map(x => [x.id,x]));
    const appendOnly = ["historyEntries","distributionEntries"].includes(collection);
    for (const [id, after] of next) {
      const before = previous.get(id) || null;
      if (appendOnly && before) continue;
      const comparable = x => { if (!x) return x; const copy={...x}; delete copy.updatedAt; delete copy.timeTracking; return copy; };
      if (JSON.stringify(comparable(before)) !== JSON.stringify(comparable(after))) operations.push({collection,id,before,after});
    }
    if (!appendOnly) for (const [id,before] of previous) if(!next.has(id)) operations.push({collection,id,before,after:null});
  }
  return operations;
}
function persistPendingOfflineSnapshot(snapshot) {
  try { localStorage.setItem(desktopDraftKey,JSON.stringify({userId:currentSession()?.id,operations:desktopOperations(snapshot)})); }
  catch(e) { console.error("Nao foi possivel guardar o rascunho local",e); }
}
function clearPendingOfflineSnapshot() { localStorage.removeItem(desktopDraftKey); }
function loadPendingOfflineSnapshot() { return null; }
async function retryPendingOfflineSnapshot() {
  const draft=JSON.parse(localStorage.getItem(desktopDraftKey)||"null");
  if(!draft || draft.userId!==currentSession()?.id || !draft.operations?.length || hasLocalSavePending()) return;
  try {
    await apiRequest("/api/state",{method:"PUT",body:JSON.stringify({operations:draft.operations}),timeoutMs:45000});
    clearPendingOfflineSnapshot(); await loadServerState(); render();
  } catch(e) { setSaveStatus("error","Rascunho pendente: "+e.message+" Atualize a base para revisar."); }
}
async function sendSnapshotWithRetry(snapshot) {
  const operations=desktopOperations(snapshot);
  if(!operations.length) return {ok:true};
  persistPendingOfflineSnapshot(snapshot);
  const result=await apiRequest("/api/state",{method:"PUT",body:JSON.stringify({operations}),timeoutMs:45000});
  desktopBase=structuredClone(snapshot);
  clearPendingOfflineSnapshot();
  lastKnownStateUpdatedAt="";
  return result;
}
`;
// Replace the original persistence functions with an operation protocol.
app=app.replace(/function persistPendingOfflineSnapshot\(snapshot\) \{[\s\S]*?(?=function sleep\(ms\))/,'');
app=app.replace(/async function sendSnapshotWithRetry\(snapshot\) \{[\s\S]*?(?=function flushPendingSave\()/,'');
app=app.replace(/function retryPendingOfflineSnapshot\(\) \{[\s\S]*?(?=async function loadServerState\()/,'');
app=transport+'\n'+app;
app=app.replace('if (!response.ok) throw new Error(payload.error || "Falha de comunicacao com o banco de dados.");',`if (!response.ok) {
      if(response.status===401 && path!=="/api/login") { sessionStorage.removeItem(storeKeys.session);localStorage.removeItem(storeKeys.session);window.location.replace("index.html"); }
      throw new Error(payload.error || "Falha de comunicacao com o servidor.");
    }`);
app=app.replace('lastSeenDistributionId = distributionEntries[0]?.id || "";','lastSeenDistributionId = distributionEntries[0]?.id || "";\n    desktopBase = structuredClone(stateSnapshot());');
app=app.replace('const state = await apiRequest("/api/state");\n    lastKnownStateUpdatedAt = state.updatedAt || version.updatedAt',`const state = await apiRequest("/api/state");
    if(hasLocalSavePending()) return;
    desktopBase=structuredClone(state);
    lastKnownStateUpdatedAt = state.updatedAt || version.updatedAt`);
app=app.replace('setSaveStatus("error", "Sem conexao com o banco. Alteracoes guardadas neste computador e serao reenviadas.");','setSaveStatus("error", "Nao foi salvo: " + error.message + " Rascunho local preservado; atualize a base para revisar.");');
// A failed initial load must not create a writable view based on stale local data.
app=app.replace('alert("Nao foi possivel conectar ao banco de dados local. Verifique se o servidor foi iniciado pelo server.mjs.");','throw new Error("Nao foi possivel carregar a base. Verifique DBSRV e TMSRV e use Atualizar.");');
app=app.replace('window.setInterval(checkDistributionUpdates, 1500)','window.setInterval(checkDistributionUpdates, 5000)');
app=app.replace('init();','init().catch(error => { hideSatelLoader(); const box=document.getElementById("bootError"); if(box)box.style.display="block"; const text=document.getElementById("bootErrorMessage"); if(text)text.textContent=error.message; });');
// Separate this client's cache from the old website; cookies remain the source of authentication.
app=app.replaceAll('ordem-certa-os-', 'ordem-certa-desktop-');
fs.writeFileSync(path.join(dir,'app.js'),app);
for (const name of ['index.html','app.html']) {
  let html=fs.readFileSync(path.join(dir,name),'utf8').replaceAll('ordem-certa-os-', 'ordem-certa-desktop-');
  fs.writeFileSync(path.join(dir,name),html);
}
await import('./finalizar-interface.mjs');
