// Log user interactions without collecting passwords, field contents or file contents.
(()=>{
  let events=[],timer;
  const pendingSearch=new Map();
  function flush(){
    clearTimeout(timer);timer=null;
    if(!events.length)return;
    const batch=events.splice(0,20);
    fetch('/api/activity',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({events:batch})}).catch(()=>{});
    if(events.length)timer=setTimeout(flush,400);
  }
  function add(kind,control,label){
    if(!/^[\w:-]{1,100}$/.test(control||''))return;
    events.push({kind,control,label:String(label||control).slice(0,100)});
    if(events.length>=20)flush();else if(!timer)timer=setTimeout(flush,400);
  }
  document.addEventListener('click',e=>{
    const target=e.target.closest('button,[data-action]');if(!target)return;
    if(target.dataset.screen)add('tela',target.dataset.screen,target.textContent.trim());
    else add('comando',target.id||target.dataset.action||'botao',target.textContent.trim()||'Comando acionado');
  },true);
  document.addEventListener('change',e=>{
    const t=e.target;
    if(t.type==='file')add('arquivo',t.id||'arquivo','Arquivo selecionado');
    else if(/filter|period|preset/i.test(t.id)||t.closest('.dashboard-filters'))add('filtro',t.id||'filtro','Filtro alterado');
  });
  document.addEventListener('input',e=>{
    const t=e.target;if(t.type==='password'||(!/search/i.test(t.id)&&t.type!=='search'))return;
    clearTimeout(pendingSearch.get(t.id));pendingSearch.set(t.id,setTimeout(()=>{add('pesquisa',t.id||'pesquisa','Pesquisa alterada');pendingSearch.delete(t.id);},700));
  });
  window.addEventListener('pagehide',flush);
  add('tela','dashboard','Dashboard aberto');
})();
