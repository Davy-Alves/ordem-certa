import fs from 'node:fs';
import path from 'node:path';
const dir=path.resolve(import.meta.dirname,'../Servidor/public');
for(const name of ['index.html','app.html']) {
  const file=path.join(dir,name);
  let html=fs.readFileSync(file,'utf8');
  if(!html.includes('desktop.css')) html=html.replace('</head>','<link rel="stylesheet" href="desktop.css">\n</head>');
  if(name==='app.html' && !html.includes('desktop-recovery.js'))html=html.replace(/(<script src="app\.js[^"]*"><\/script>)/,'<script src="desktop-recovery.js"></script>\n$1');
  fs.writeFileSync(file,html);
}
const file=path.join(dir,'app.js');
let app=fs.readFileSync(file,'utf8');
if(!app.includes('if(desktopRecovery) return;')) {
  app=app.replace('async function checkDistributionUpdates() {','async function checkDistributionUpdates() {\n  if(desktopRecovery) return;');
  app=app.replace('setSaveStatus("error","Rascunho pendente: "+e.message+" Atualize a base para revisar.");','setSaveStatus("error","Rascunho pendente: "+e.message); showDesktopRecovery(e.message);');
  app=app.replace('setSaveStatus("error", "Nao foi salvo: " + error.message + " Rascunho local preservado; atualize a base para revisar.");','setSaveStatus("error", "Nao foi salvo: " + error.message); showDesktopRecovery(error.message);');
  app=app.replace('async function sendSnapshotWithRetry(snapshot) {','async function sendSnapshotWithRetry(snapshot) {\n  if(desktopRecovery) throw new Error("Resolva o rascunho pendente antes de continuar.");');
  app=app.replace('function persistPendingOfflineSnapshot(snapshot) {','function persistPendingOfflineSnapshot(snapshot) {\n  if(desktopRecovery) return;');
}
app=app.replace('desktopBase=structuredClone(state);\n    lastKnownStateUpdatedAt', 'lastKnownStateUpdatedAt');
app=app.replace('currentUser = currentSession() || currentUser;\n    if (latest', 'currentUser = currentSession() || currentUser;\n    desktopBase=structuredClone(stateSnapshot());\n    if (latest');
fs.writeFileSync(file,app);
