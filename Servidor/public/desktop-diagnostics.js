// Diagnostic metadata is separate from the retry payload and never confirms a save.
const desktopDiagnosticKey = "ordem-certa-diagnostics-v1";
let desktopSource = null,
  desktopImportContext = null;
let desktopDiagnosticMemory = (() => {
  try {
    return (
      JSON.parse(localStorage.getItem(desktopDiagnosticKey)) || {
        attempts: [],
        imports: [],
      }
    );
  } catch {
    return { attempts: [], imports: [] };
  }
})();
function desktopStoreDiagnostics() {
  try {
    localStorage.setItem(
      desktopDiagnosticKey,
      JSON.stringify(desktopDiagnosticMemory),
    );
  } catch {
    desktopDiagnosticMemory.storageWarning =
      "Histórico de diagnóstico excedeu o armazenamento local; exporte antes de fechar esta janela.";
  }
}
function desktopRecordAttempt(message, status) {
  desktopDiagnosticMemory.attempts.push({
    at: new Date().toISOString(),
    status,
    message,
  });
  desktopStoreDiagnostics();
}
function desktopBeginImport(rows, fileName) {
  desktopImportContext = {
    at: new Date().toISOString(),
    file: fileName,
    sheet: desktopSource?.sheet || null,
    headers: rows[0]?.__headers || Object.keys(rows[0] || {}),
    lookups: {},
    rows: [],
    summary: null,
  };
  desktopDiagnosticMemory.imports.push(desktopImportContext);
}
function desktopColumnRead(row, names, found, index) {
  if (!desktopImportContext) return;
  const key =
    index === undefined
      ? names.map(normalizeHeader).join("|")
      : "posicao:" + index;
  const column =
    index === undefined
      ? found
        ? row.__headers?.indexOf(found[0])
        : undefined
      : index;
  desktopImportContext.lookups[key] = {
    aliases: names,
    column: column === undefined || column < 0 ? null : column + 1,
    header:
      index === undefined ? found?.[0] || null : row.__headers?.[index] || null,
    recognized:
      index === undefined ? !!found : index < (row.__headers?.length || 0),
  };
}
function desktopImportRow(row, update, status) {
  if (!desktopImportContext) return;
  desktopImportContext.rows.push({
    line: row.__sourceRow || null,
    osNumber: update.osNumber || null,
    status,
    warnings: Object.fromEntries(
      Object.entries(update).filter(
        ([key, value]) =>
          /Alert|Error|alerts/i.test(key) &&
          value &&
          (!Array.isArray(value) || value.length),
      ),
    ),
  });
}
function desktopFinishImport(summary) {
  if (desktopImportContext) {
    desktopImportContext.summary = summary;
    desktopStoreDiagnostics();
    desktopImportContext = null;
  }
}
function desktopClean(value) {
  return JSON.parse(
    JSON.stringify(value, (key, v) =>
      /password|senha|token|authorization|cookie|internalkey|passwordhash/i.test(
        key,
      )
        ? "[oculto]"
        : v,
    ),
  );
}
function desktopDiff(before, after, prefix = "") {
  const result = [];
  for (const key of new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ])) {
    if (["updatedAt", "timeTracking"].includes(key)) continue;
    const a = before?.[key],
      b = after?.[key],
      field = prefix ? prefix + "." + key : key;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (
      (a && typeof a === "object" && !Array.isArray(a)) ||
      (b && typeof b === "object" && !Array.isArray(b))
    )
      result.push(...desktopDiff(a, b, field));
    else result.push({ field, before: a ?? null, requested: b ?? null });
  }
  return result;
}
function desktopGuidance(issue) {
  const f = issue.field || "",
    m = issue.message || "";
  if (f.endsWith(".endDate"))
    return "Preencha a data real de conclusão deste processo. Use Adicionar mesmo assim somente se decidir manter a data em branco.";
  if (f.startsWith("voices."))
    return "Revise o código de VOZ, tipo de serviço e quantidade de postes deste projeto/processo.";
  if (m.includes("Conflito"))
    return "Compare com a versão atual do servidor e refaça apenas a alteração necessária; outra edição pode ter ocorrido.";
  if (m.includes("pendencia"))
    return "Resolva a pendência ativa antes de concluir a OS.";
  if (m.includes("processo ativo"))
    return "Conclua o processo ativo antes de concluir a OS.";
  if (m.includes("permi"))
    return "Solicite a alteração a um usuário com permissão adequada.";
  return "Revise o campo indicado e a mensagem antes de tentar salvar novamente.";
}
async function desktopBuildReport() {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(desktopDraftKey) || "null");
  } catch {}
  if (!draft && desktopBase)
    draft = {
      userId: currentSession()?.id,
      operations: desktopOperations(stateSnapshot()),
    };
  if (!draft?.operations?.length)
    throw Error("Não há alterações pendentes disponíveis nesta janela.");
  let diagnosis;
  try {
    diagnosis = await apiRequest("/api/state/diagnose", {
      method: "POST",
      body: JSON.stringify({ operations: draft.operations }),
      timeoutMs: 90000,
    });
  } catch (e) {
    diagnosis = {
      unavailable: true,
      message: e.message,
      errors: [],
      note: "Não foi possível verificar a base atual. Não é possível afirmar quais alterações chegaram ao servidor.",
    };
  }
  for (const error of diagnosis.errors || [])
    for (const issue of error.issues || [])
      issue.guidance = desktopGuidance(issue);
  const orders = draft.operations
    .filter((o) => o.collection === "orders")
    .map((op) => ({
      id: op.id,
      osNumber: op.after?.osNumber || op.before?.osNumber,
      status: diagnosis.unavailable
        ? "Não verificado"
        : diagnosis.errors?.length
          ? "Pendente: lote com erros na simulação"
          : "Pendente: sem bloqueio detectado na simulação; não comprova gravação",
      errors: (diagnosis.errors || []).filter(
        (e) => e.collection === "orders" && e.id === op.id,
      ),
      fields: desktopDiff(op.before, op.after),
    }));
  const imports = desktopDiagnosticMemory.imports.map((item) => {
    const reads = Object.values(item.lookups || {}),
      used = new Set(reads.filter((r) => r.recognized).map((r) => r.column));
    return {
      ...item,
      duplicateHeaders: item.headers.filter(
        (h, i) => item.headers.indexOf(h) !== i,
      ),
      columns: item.headers.map((header, i) => ({
        column: i + 1,
        header,
        status: used.has(i + 1)
          ? "Lida pelo importador; salvamento depende da validação"
          : "Não utilizada pelo importador de atualização de status",
      })),
      missingLookups: reads.filter((r) => !r.recognized),
    };
  });
  const history = new Map(
    (typeof historyEntries === "undefined" ? [] : historyEntries).map((h) => [
      h.id,
      h,
    ]),
  );
  for (const op of draft.operations)
    if (op.collection === "historyEntries" && op.after)
      history.set(op.id, {
        ...op.after,
        diagnosticStatus: "Histórico pendente no rascunho",
      });
  return desktopClean({
    format: "ordem-certa-diagnostico-v1",
    exportedAt: new Date().toISOString(),
    userId: draft.userId,
    scope:
      "Rascunho pendente, histórico disponível na sessão e importações/tentativas registradas por esta versão. Não é uma reconstrução de eventos que nunca foram registrados.",
    limitations: imports.length
      ? [
          "Coluna lida não significa valor aceito. Cabeçalhos procurados podem ser opcionais ou aliases; ausência não prova erro.",
          "A simulação usa a base atual e pode mostrar conflitos diferentes da tentativa original.",
        ]
      : [
          "A tentativa antiga não registrou os cabeçalhos/linhas da planilha. Não é possível reconstruir quais colunas foram lidas. Reimporte após exportar este diagnóstico para registrar esses detalhes.",
        ],
    diagnosis,
    orders,
    imports,
    attempts: desktopDiagnosticMemory.attempts,
    storageWarning: desktopDiagnosticMemory.storageWarning || null,
    history: [...history.values()],
    operations: draft.operations,
  });
}
function desktopReportCsv(report) {
  const headers = [
    "Tipo de registro",
    "Data",
    "Usuário",
    "Arquivo",
    "Aba",
    "Linha",
    "Coluna",
    "OS",
    "ID",
    "Situação",
    "Campo / Cabeçalho",
    "Valor anterior",
    "Valor solicitado",
    "Erro / Mensagem",
    "Como corrigir",
    "Detalhes",
  ];
  const rows = [headers];
  const add = (type, r = {}) =>
    rows.push([
      type,
      r.date,
      r.user,
      r.file,
      r.sheet,
      r.line,
      r.column,
      r.os,
      r.id,
      r.status,
      r.field,
      r.before,
      r.requested,
      r.message,
      r.guidance,
      r.detail,
    ]);
  add("Resumo", {
    date: report.exportedAt,
    user: report.userId,
    detail: report.scope,
  });
  for (const message of report.limitations || []) add("Limitação", { message });
  if (report.storageWarning) add("Aviso", { message: report.storageWarning });
  add("Diagnóstico", {
    date: report.diagnosis.at,
    status: report.diagnosis.unavailable
      ? "Indisponível"
      : "Simulação sem gravação",
    message: report.diagnosis.note || report.diagnosis.message,
    detail: { revision: report.diagnosis.revision },
  });
  for (const e of report.diagnosis.errors || [])
    for (const i of e.issues?.length ? e.issues : [{ message: e.message }])
      add("Erro", {
        os: e.osNumber,
        id: e.id,
        status: e.status,
        field: i.field,
        message: i.message,
        guidance: i.guidance,
      });
  for (const o of report.orders || [])
    for (const f of o.fields.length ? o.fields : [{}])
      add("Alteração pendente", {
        os: o.osNumber,
        id: o.id,
        status: o.status,
        field: f.field,
        before: f.before,
        requested: f.requested,
      });
  for (const item of report.imports || []) {
    const source = { file: item.file, sheet: item.sheet, date: item.at };
    add("Importação", { ...source, message: item.summary });
    for (const c of item.columns || [])
      add("Coluna", {
        ...source,
        column: c.column,
        field: c.header,
        status: c.status,
      });
    for (const c of item.missingLookups || [])
      add("Cabeçalho ausente", {
        ...source,
        field: c.aliases.join(" / "),
        message: "Pode ser opcional ou um alias; ausência não comprova falha.",
      });
    for (const header of item.duplicateHeaders || [])
      add("Cabeçalho duplicado", {
        ...source,
        field: header,
        message:
          "Revise cabeçalhos repetidos: os valores podem se sobrepor durante a leitura.",
      });
    for (const r of item.rows || [])
      add("Linha da planilha", {
        ...source,
        line: r.line,
        os: r.osNumber,
        status: r.status,
        detail: r.warnings,
      });
  }
  for (const a of report.attempts || [])
    add("Tentativa", { date: a.at, status: a.status, message: a.message });
  for (const h of report.history || [])
    add("Histórico", {
      date: h.date,
      user: h.login || h.fullName,
      os: h.osNumber,
      id: h.id,
      status: h.diagnosticStatus || "Registro disponível na sessão",
      field: h.action,
      before: h.oldValue,
      requested: h.newValue,
      detail: h.detail,
    });
  const cell = (value) => {
    let text =
      value == null
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
    if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = "'" + text; // Spreadsheet formula injection protection.
    return '"' + text.replace(/"/g, '""') + '"';
  };
  return (
    "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n"
  );
}
async function desktopExportReport(csv = false) {
  try {
    const report = await desktopBuildReport();
    const content = csv
      ? desktopReportCsv(report)
      : JSON.stringify(report, null, 2);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([content], {
        type: csv ? "text/csv;charset=utf-8" : "application/json",
      }),
    );
    link.download = csv
      ? "ordem-certa-diagnostico.csv"
      : "ordem-certa-rascunho.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  } catch (e) {
    alert("Não foi possível exportar o diagnóstico: " + e.message);
  }
}
