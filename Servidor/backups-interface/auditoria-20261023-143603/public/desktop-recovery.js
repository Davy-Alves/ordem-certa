let desktopRecovery = false;
function showDesktopRecovery(message) {
  desktopRecovery = true;
  let box = document.getElementById("desktopRecovery");
  if(!box){box=document.createElement("div");box.id="desktopRecovery";box.className="desktop-recovery";document.body.append(box);}
  box.replaceChildren();
  const text=document.createElement("p");text.textContent="Alteração ainda não salva no servidor. "+message;box.append(text);
  const button=(label,fn)=>{const b=document.createElement("button");b.textContent=label;b.onclick=fn;box.append(b);};
  async function retry(allowMissingProcessDates=false){
    const draft=JSON.parse(localStorage.getItem(desktopDraftKey)||"null");
    if(!draft || draft.userId!==currentSession()?.id)return;
    if(allowMissingProcessDates && !confirm("Adicionar mesmo assim? Existem processos complementares sem data de conclusão. Os registros serão salvos com essas datas em branco, e sua confirmação ficará registrada no histórico. As demais validações continuam ativas."))return;
    box.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{
      await apiRequest("/api/state",{method:"PUT",body:JSON.stringify({operations:draft.operations,allowMissingProcessDates}),timeoutMs:45000});
      clearPendingOfflineSnapshot();desktopRecovery=false;box.remove();location.reload();
    }catch(e){showDesktopRecovery(e.message);}
  }
  button("Tentar novamente",()=>retry());
  if(String(message).includes("Existe processo complementar sem data de conclusao")){
    const info=document.createElement('p');info.textContent='Você pode adicionar mesmo assim. As datas ausentes permanecerão em branco e a confirmação ficará registrada no histórico.';box.append(info);
    button("Adicionar mesmo assim",()=>retry(true));
  }
  button("Exportar rascunho",()=>desktopExportReport());
  button("Exportar diagnóstico (CSV)",()=>desktopExportReport(true));
  button("Descartar rascunho e atualizar",()=>{
    if(!confirm("Descartar as alterações locais pendentes e carregar a versão salva no servidor? Exporte o rascunho antes se quiser guardá-lo."))return;
    clearPendingOfflineSnapshot();desktopRecovery=false;location.reload();
  });
}
