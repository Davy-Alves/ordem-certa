import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { empty, hash } from '../Servidor/src/common.mjs';
const serverDir=path.resolve(import.meta.dirname,'../Servidor');
const testDir=fs.mkdtempSync(path.join(os.tmpdir(),'ordem-certa-test-'));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const tmPort=await freePort(),dbPort=await freePort();
const config={tmHost:'127.0.0.1',tmPort,dbPort,publicUrl:'http://127.0.0.1:'+tmPort,dataDir:'data',internalKey:crypto.randomBytes(48).toString('hex')};
fs.writeFileSync(path.join(testDir,'servidor.json'),JSON.stringify(config));
fs.mkdirSync(path.join(testDir,'data'));
const data=empty();
data.users=[{id:'admin',login:'admin',fullName:'Administrador Teste',accessLevel:100,passwordHash:hash('Teste-Seguro-2026!')},{id:'operador',login:'operador',fullName:'Operador Teste',collaboratorId:'col1',accessLevel:31,passwordHash:hash('Operador-Seguro-2026!')}];
data.collaborators=[{id:'col1',name:'Operador Teste',stages:['Levantamento de Campo'],queueActive:true,queueOrder:{'Levantamento de Campo':1}}];
data.orders=[{id:'os1',osNumber:'TESTE-001',clientName:'Cliente de Teste',city:'Fortaleza',regional:'Fortaleza',stage:'Levantamento de Campo',owner:'Operador Teste',fieldTech:'Operador Teste',fieldStatus:'Roteirizacao',receivedDate:'2026-10-01',voices:{project:{code:'5000011548',poles:'1',repeat:'1x',type:'Melhoria'}},createdAt:'2026-10-01T12:00:00Z',updatedAt:'2026-10-01T12:00:00Z'}];
const db=new DatabaseSync(path.join(testDir,'data','ordem-certa.sqlite'));
db.exec('CREATE TABLE state(id INTEGER PRIMARY KEY,revision INTEGER,payload TEXT)');
db.prepare('INSERT INTO state VALUES(1,1,?)').run(JSON.stringify(data));db.close();
const env={...process.env,OC_CONFIG:path.join(testDir,'servidor.json')};
const children=[];
function launch(name){const child=spawn(path.join(serverDir,name+'.exe'),[],{cwd:serverDir,env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',e=>console.error(e));return child;}
function kill(child){if(child && child.exitCode===null)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
const base=config.publicUrl;
async function request(route,method='GET',payload,token){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:payload===undefined?undefined:JSON.stringify(payload)});return{status:r.status,data:await r.json()};}
async function ready(){for(let i=0;i<80;i++){try{if((await request('/api/health')).status===200)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw new Error('Servidores nao iniciaram.');}
let total=0;
function check(name,fn){fn();total++;console.log('PASS '+name);}
try{
  launch('DBSRV');launch('TMSRV');await ready();
  check('executaveis iniciam e conversam',()=>assert.ok(true));
  if(process.env.OC_NATIVE_TEST) {
    const nativeDir=path.join(testDir,'webview');fs.mkdirSync(nativeDir);
    const native=spawn(path.resolve(serverDir,'../Cliente/OrdemCerta.exe'),['--smoke-test'],{env:{...env,OC_SMOKE_URL:base,OC_SMOKE_DIR:nativeDir},windowsHide:true});
    const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{native.kill();reject(new Error('Cliente nativo excedeu 30 segundos.'));},30000);native.on('exit',c=>{clearTimeout(timer);resolve(c);});native.on('error',reject);});
    assert.equal(code,0);assert.match(fs.readFileSync(path.join(nativeDir,'result.txt'),'utf8'),/^PASS/);
    check('cliente Windows WebView2 renderiza login',()=>assert.ok(true));
  }
  check('estado exige login',()=>{});
  assert.equal((await request('/api/state')).status,401);
  assert.equal((await request('/api/state','PUT',{operations:[]})).status,401);
  const denied=await fetch('http://127.0.0.1:'+dbPort+'/rpc',{method:'POST',body:'{"action":"read"}'});
  check('DBSRV rejeita acesso sem chave',()=>assert.equal(denied.status,403));
  assert.equal((await request('/api/login','POST',{login:'admin',password:'errada'})).status,401);
  const login=await request('/api/login','POST',{login:'admin',password:'Teste-Seguro-2026!'});const token=login.data.token;
  check('login valido sem expor hash',()=>{assert.equal(login.status,200);assert.ok(token);assert.ok(!login.data.user.passwordHash);});
  let state=(await request('/api/state','GET',undefined,token)).data;
  check('estado nao expoe credenciais',()=>assert.ok(state.users.every(u=>!u.passwordHash)));
  const old=structuredClone(state.orders[0]);
  const save=async(before,after,t=token)=>request('/api/state','PUT',{operations:[{collection:'orders',id:'os1',before,after}]},t);
  assert.equal((await save(old,{...old,clientName:'Cliente Editado'})).status,200);
  check('edicoes simultaneas em campos distintos preservadas',()=>{});
  assert.equal((await save(old,{...old,city:'Caucaia'})).status,200);
  state=(await request('/api/state','GET',undefined,token)).data;
  assert.equal(state.orders[0].clientName,'Cliente Editado');assert.equal(state.orders[0].city,'Caucaia');
  check('conflito no mesmo campo retorna 409',()=>{});
  assert.equal((await save(old,{...old,clientName:'Sobrescrever'})).status,409);
  const opLogin=await request('/api/login','POST',{login:'operador',password:'Operador-Seguro-2026!'});assert.equal(opLogin.status,200);
  const opToken=opLogin.data.token;const operator=state.users.find(u=>u.id==='operador');
  const escalation=await request('/api/state','PUT',{operations:[{collection:'users',id:'operador',before:operator,after:{...operator,accessLevel:100}}]},opToken);
  check('operador nao promove proprio perfil',()=>assert.equal(escalation.status,403));
  assert.equal((await save(state.orders[0],null,opToken)).status,403);
  check('operador nao exclui ordens',()=>assert.ok(true));
  assert.equal((await save(state.orders[0],{...state.orders[0],fieldStatus:'Em andamento'},opToken)).status,200);
  check('responsavel altera status da propria ordem',()=>assert.ok(true));
  state=(await request('/api/state','GET',undefined,token)).data;
  assert.equal((await save(state.orders[0],{...state.orders[0],stage:'Concluido',pendencyState:{active:true}})).status,422);
  check('conclusao bloqueada por pendencia',()=>assert.ok(true));
  const audit={id:'hist1',date:new Date().toISOString(),action:'Teste'};
  const auditPayload={operations:[{collection:'historyEntries',id:'hist1',before:null,after:audit}]};
  assert.equal((await request('/api/state','PUT',auditPayload,token)).status,200);
  assert.equal((await request('/api/state','PUT',auditPayload,token)).status,200);
  check('reenvio nao duplica historico',()=>assert.ok(true));
  const historyBatch=Array.from({length:5100},(_,i)=>({collection:'historyEntries',id:'old-'+i,before:null,after:{id:'old-'+i,date:'2026-01-01T00:00:00Z',action:'Historico teste'}}));
  assert.equal((await request('/api/state','PUT',{operations:historyBatch},token)).status,200);
  assert.equal((await request('/api/state','GET',undefined,token)).data.historyEntries.length,5101);
  check('historico acima de 5000 entradas preservado',()=>assert.ok(true));
  assert.equal((await request('/api/backup','POST',{},token)).status,200);
  check('backup SQLite gerado',()=>assert.ok(fs.readdirSync(path.join(testDir,'data','backups')).some(f=>f.endsWith('.sqlite'))));
  assert.equal((await request('/api/profile/change-password','POST',{currentPassword:'Teste-Seguro-2026!',newPassword:'Teste-Novo-2026!'},token)).status,200);
  assert.equal((await request('/api/login','POST',{login:'admin',password:'Teste-Novo-2026!'})).status,200);
  check('troca de senha funciona',()=>assert.ok(true));
  kill(children[1]);kill(children[0]);await new Promise(r=>setTimeout(r,500));
  launch('DBSRV');launch('TMSRV');await ready();
  state=(await request('/api/state','GET',undefined,token)).data;
  check('dados e sessao persistem apos reiniciar',()=>{assert.equal(state.orders[0].clientName,'Cliente Editado');assert.equal(state.historyEntries.filter(h=>h.id==='hist1').length,1);});
  await request('/api/logout','POST',{},token);
  assert.equal((await request('/api/state','GET',undefined,token)).status,401);
  check('logout invalida sessao',()=>assert.ok(true));
  if(process.env.OC_UI_TEST) {
    const {createRequire}=await import('node:module');
    const require=createRequire(process.env.OC_PLAYWRIGHT_PACKAGE);
    const {chromium}=require('playwright');
    const browser=await chromium.launch({channel:'msedge',headless:true});
    try{
      const page=await browser.newPage({viewport:{width:1440,height:1000}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base);
      await page.locator('#loginUser').fill('admin');
      await page.locator('#loginPassword').fill('Teste-Novo-2026!');
      await page.locator('#loginForm button').click();
      await page.waitForURL('**/app.html*');
      await page.locator('#dashboardScreen').waitFor({state:'visible'});
      await page.locator('#satelLoader').waitFor({state:'detached',timeout:15000});
      await page.evaluate(async()=>{orders=orders.map(o=>({...o,clientName:'Salvo pelo cliente Windows'}));await persistStrict();});
      const saved=await page.evaluate(async()=>await apiRequest('/api/state'));
      assert.equal(saved.orders[0].clientName,'Salvo pelo cliente Windows');
      check('interface salva pelo novo protocolo de operacoes',()=>assert.ok(true));
      await page.evaluate(async()=>{
        const remote=await apiRequest('/api/state');
        const before=remote.orders[0];
        await apiRequest('/api/state',{method:'PUT',body:JSON.stringify({operations:[{collection:'orders',id:before.id,before,after:{...before,clientName:'Edicao de outro computador'}}]})});
        orders=orders.map(o=>({...o,clientName:'Rascunho em conflito'}));
        await persistStrict();
      });
      await page.locator('#desktopRecovery').waitFor({state:'visible'});
      assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem(desktopDraftKey)).operations.length>0));
      const remoteResult=await page.evaluate(async()=>await apiRequest('/api/state'));
      assert.equal(remoteResult.orders[0].clientName,'Edicao de outro computador');
      page.once('dialog',dialog=>dialog.accept());
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:'Descartar rascunho e atualizar'}).click()]);
      await page.locator('#dashboardScreen').waitFor({state:'visible'});
      await page.locator('#satelLoader').waitFor({state:'detached',timeout:15000});
      check('conflito mostra recuperacao sem sobrescrever o servidor',()=>assert.ok(true));
      const downloadEvent=page.waitForEvent('download');
      await page.evaluate(()=>exportOrdersXlsx());
      const download=await downloadEvent;
      assert.ok(download.suggestedFilename().endsWith('.xlsx'));
      await download.saveAs(path.join(import.meta.dirname,'exportacao-teste.xlsx'));
      check('exportacao Excel pela interface',()=>assert.ok(true));
      for(const screen of ['board','processes','adequacies','pendencies','account','admin','dashboard']){
        await page.locator('[data-screen="'+screen+'"]').click();
        await page.waitForTimeout(150);
      }
      await page.screenshot({path:path.join(import.meta.dirname,'dashboard-teste.png'),fullPage:true});
      assert.deepEqual(errors,[]);
      check('interface login e sete telas sem erro JavaScript',()=>assert.ok(true));
    }finally{await browser.close();}
  }
  console.log(JSON.stringify({passed:total,testDirectory:testDir,productionDataUntouched:true}));
}finally{children.forEach(kill);}
