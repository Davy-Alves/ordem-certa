let desktopRecovery = false;
function showDesktopRecovery(message) {
  desktopRecovery = true;
  let box = document.getElementById("desktopRecovery");
  if(!box){box=document.createElement("div");box.id="desktopRecovery";box.className="desktop-recovery";document.body.append(box);}
  box.replaceChildren();
  const text=document.createElement("p");text.textContent="Alteração ainda não salva no servidor. "+message;box.append(text);
  const button=(label,fn)=>{const b=document.createElement("button");b.textContent=label;b.onclick=fn;box.append(b);};
  button("Tentar novamente",async()=>{
    const draft=JSON.parse(localStorage.getItem(desktopDraftKey)||"null");
    if(!draft || draft.userId!==currentSession()?.id)return;
    try{
      await apiRequest("/api/state",{method:"PUT",body:JSON.stringify({operations:draft.operations}),timeoutMs:45000});
      clearPendingOfflineSnapshot();desktopRecovery=false;box.remove();location.reload();
    }catch(e){showDesktopRecovery(e.message);}
  });
  button("Exportar rascunho",()=>{
    const raw=localStorage.getItem(desktopDraftKey);if(!raw)return;
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([raw],{type:"application/json"}));a.download="ordem-certa-rascunho.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  });
  button("Descartar rascunho e atualizar",()=>{
    if(!confirm("Descartar as alterações locais pendentes e carregar a versão salva no servidor? Exporte o rascunho antes se quiser guardá-lo."))return;
    clearPendingOfflineSnapshot();desktopRecovery=false;location.reload();
  });
}
