import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { config } from './common.mjs';
const cfg=config();
const source=path.resolve(process.argv[2] || '');
if(!process.argv[2] || !fs.existsSync(source))throw new Error('Informe o arquivo .sqlite de backup.');
const running=await new Promise((resolve,reject)=>{
  const socket=net.connect(cfg.dbPort || 4174,'127.0.0.1');
  socket.setTimeout(2000);
  socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('error',error=>error.code==='ECONNREFUSED'?resolve(false):reject(error));
  socket.once('timeout',()=>{socket.destroy();resolve(true);});
});
if(running)throw new Error('Pare TMSRV e DBSRV antes de restaurar.');
const verify=new DatabaseSync(source,{readOnly:true});
if(verify.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup corrompido.');
const row=verify.prepare('SELECT payload FROM state WHERE id=1').get();
const state=JSON.parse(row.payload);
if(!Array.isArray(state.orders)||!state.users?.some(u=>u.accessLevel>=91))throw new Error('Backup nao e uma base valida do Ordem Certa.');
verify.close();
const target=path.join(cfg.dataDir,'ordem-certa.sqlite');
if(source.toLowerCase()===target.toLowerCase())throw new Error('Escolha um backup diferente do banco ativo.');
fs.mkdirSync(cfg.dataDir,{recursive:true});
if(fs.existsSync(target)){
  const old=new DatabaseSync(target);old.exec('PRAGMA wal_checkpoint(TRUNCATE)');old.close();
  fs.renameSync(target,target+'.antes-restauracao-'+Date.now());
}
fs.copyFileSync(source,target);
const restored=new DatabaseSync(target);
restored.exec('DELETE FROM sessions');restored.close();
console.log('Restauracao concluida. O banco anterior foi preservado. Reinicie DBSRV e TMSRV.');
