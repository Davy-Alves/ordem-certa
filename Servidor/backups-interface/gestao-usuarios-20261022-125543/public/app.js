
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
  if(desktopRecovery) return;
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
  } catch(e) { setSaveStatus("error","Rascunho pendente: "+e.message); showDesktopRecovery(e.message); }
}
async function sendSnapshotWithRetry(snapshot) {
  if(desktopRecovery) throw new Error("Resolva o rascunho pendente antes de continuar.");
  const operations=desktopOperations(snapshot);
  if(!operations.length) return {ok:true};
  persistPendingOfflineSnapshot(snapshot);
  const result=await apiRequest("/api/state",{method:"PUT",body:JSON.stringify({operations}),timeoutMs:45000});
  desktopBase=structuredClone(snapshot);
  clearPendingOfflineSnapshot();
  lastKnownStateUpdatedAt="";
  return result;
}

﻿const storeKeys = {
  orders: "ordem-certa-desktop-orders-v2",
  collaborators: "ordem-certa-desktop-collaborators-v2",
  history: "ordem-certa-desktop-history-v2",
  users: "ordem-certa-desktop-users-v1",
  distributions: "ordem-certa-desktop-distributions-v1",
  loginBlocks: "ordem-certa-desktop-login-blocks-v1",
  session: "ordem-certa-desktop-session-v1"
};

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const template = "10000000-1000-4000-8000-100000000000";
  const randomValues = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint8Array(16))
    : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  let index = 0;
  return template.replace(/[018]/g, (char) => {
    const value = randomValues[index++ % randomValues.length];
    return (Number(char) ^ (value & (15 >> (Number(char) / 4)))).toString(16);
  });
}

const sessionMaxAgeMs = 8 * 60 * 60 * 1000;
const maxLoginAttempts = 5;
const loginBlockMs = 15 * 1000;

const permissions = {
  view: 0,
  dashboard: 51,
  processes: 0,
  reports: 61,
  createOrder: 81,
  importOrders: 61,
  updateStatuses: 61,
  exportData: 61,
  exportReports: 81,
  manageFiles: 81,
  limitedOrderEdit: 31,
  manualAssign: 71,
  editOrder: 91,
  moveOrder: 91,
  deleteOrder: 91,
  adminData: 61,
  admin: 91,
  audit: 91
};

const stages = [
  "Levantamento de Campo",
  "Criacao de CAD",
  "Orcamento",
  "Concluido",
  "Rejeitado",
  "Cancelada",
  "Suspensa"
];

const processTabs = [
  { key: "processParalelismo", label: "Paralelismo e Travessia" },
  { key: "processAmbiental", label: "Ambiental" },
  { key: "processLt", label: "Travessia LT" },
  { key: "processFerrovia", label: "Travessia de Ferrovia" },
  { key: "processAcude", label: "Travessia de Acude" },
  { key: "processRio", label: "Travessia de Rio" },
  { key: "processTermo", label: "Termo de Passagem" },
  { key: "processEvaluation", label: "Avaliacao" },
  { key: "processOnlyCompleted", label: "Concluido apenas processo" }
];

const voiceDefinitions = [
  { key: "project", field: "voiceProject", polesField: "voiceProjectPoles", repeatField: "voiceProjectRepeat", typeField: "voiceProjectType", label: "Voz do Projeto", project: true },
  { key: "paralelismo", field: "voiceParalelismo", polesField: "voiceParalelismoPoles", repeatField: "voiceParalelismoRepeat", label: "Voz de Paralelismo" },
  { key: "ambiental", field: "voiceAmbiental", polesField: "voiceAmbientalPoles", repeatField: "voiceAmbientalRepeat", label: "Voz Ambiental" },
  { key: "termo", field: "voiceTermo", polesField: "voiceTermoPoles", repeatField: "voiceTermoRepeat", label: "Voz de Termo de Passagem" },
  { key: "travessiaLt", field: "voiceTravessiaLt", polesField: "voiceTravessiaLtPoles", repeatField: "voiceTravessiaLtRepeat", label: "Voz de Travessia de LT" },
  { key: "travessiaRio", field: "voiceTravessiaRio", polesField: "voiceTravessiaRioPoles", repeatField: "voiceTravessiaRioRepeat", label: "Voz de Travessia de Rio" }
];

const processVoiceMap = {
  paralelismo: "processParalelismo",
  ambiental: "processAmbiental",
  termo: "processTermo",
  travessiaLt: "processLt",
  travessiaRio: "processRio"
};

const adequacyTabs = [
  { key: "processAmbiental", label: "Ambiental" },
  { key: "processParalelismo", label: "Paralelismo e Travessia" },
  { key: "unidentified", label: "Nao Identificado" }
];

const projectVoiceCodes = {
  "Eletricos de Distribuicao (MT e BT)": ["5000011548", "5000011549", "5000011670", "5000011671", "5000011672"],
  "Construcao de Ramais (Alimentadores/Ligacao)": ["5000011673", "5000011674", "5000011675", "5000011676", "5000011677"],
  "Grandes Clientes (Grupo A) para Orcamento de Conexao": ["5000011678", "5000011679", "5000011680", "5000011681", "5000011682"],
  "Atendimento a Urbanizacoes": ["5000011683", "5000011684", "5000011685", "5000011686", "5000011687"],
  "Melhoria": ["5000011688", "5000011689", "5000011690", "5000011691", "5000011692"],
  "Reforco": ["5000011693", "5000011694", "5000011695", "5000011696", "5000011697"],
  "Reforma": ["5000011698", "5000011699", "5000011700", "5000011701", "5000011702"],
  "Deslocamento de Redes": ["5000011703", "5000011704", "5000011705", "5000011706", "5000011707"]
};

const projectWorkTypeAliases = Object.fromEntries([
  ["CONSTR. REDE BT / Nº DE UCS 1", "Eletricos de Distribuicao (MT e BT)"],
  ["LIGAÇÃO NOVA - GRUPO A", "Construcao de Ramais (Alimentadores/Ligacao)"],
  ["REMOÇÃO DE POSTES", "Deslocamento de Redes"],
  ["CORREÇÃO SOBRECARGA DE TRAFO", "Eletricos de Distribuicao (MT e BT)"],
  ["MELHORAR ÍNDICES DE QUALIDADE ENEL", "Melhoria"],
  ["CONSTR. REDE MT/AT 12.8 KV", "Grandes Clientes (Grupo A) para Orcamento de Conexao"],
  ["CORREÇÃO DE QUEDA DE TENSÃO", "Eletricos de Distribuicao (MT e BT)"],
  ["ACRESCIMO DE CARGA", "Eletricos de Distribuicao (MT e BT)"]
].map(([source, target]) => [normalizeHeader(source), target]));

const timerSectors = ["Levantamento de Campo", "Criacao de CAD", "Orcamento", "Processos", "Pendencias", "Concluido"];

const reportStatuses = ["PROGRAMADO", "EM ESPERA", "CONCLUIDO", "REJEITADO", "CANCELADO", "CANCELADA", "SUSPENSO", "SUSPENSA", "REMOTO", "NAO TRATADO"];
const activeQueueStatuses = ["ROTEIRIZACAO", "PROGRAMADO", "EM ANDAMENTO", "NAO TRATADO", "EM ESPERA"];
const fieldKanbanStatuses = ["Remoto", "Roteirizacao", "Programado", "Em Andamento"];
const fieldMapStatuses = ["Roteirizacao", "Programado", "Em Andamento"];
const fieldMapStatusColors = {
  Roteirizacao: "#fbbf24",
  Programado: "#38bdf8",
  "Em Andamento": "#22c55e"
};
const releaseQueueStatuses = ["CONCLUIDO", "CANCELADO", "REMOTO", "SUSPENSO", "SUSPENSA"];
const unassignedOwner = "Sem Responsavel";
const unassignedLabel = "Nao Tratado";
const processRoutingOption = "PROCESSOS";
const sharePointOrderSearchUrl = "https://portalsatelbrasil.sharepoint.com/sites/SatelCE/Documentos%20Compartilhados/Forms/AllItems.aspx?CT=1748452481193&OR=OWA%2DNT%2DMail&CID=de435635%2Dfbe2%2Dbbbe%2D0f9d%2Dccfbdaee3b88&e=5%3Ad2aee81335ba4d219d3cc242b1991ff9&sharingv2=true&fromShare=true&at=9&FolderCTID=0x0120007D7F1AC938BC544AB12ED21C6B98A833&id=%2Fsites%2FSatelCE%2FDocumentos%20Compartilhados%2FProjetos%20MT%20BT&view=7";
const pendencyOptions = [
  "Termo",
  "CVT",
  "Fotos",
  "OC",
  "Cancelar",
  "Suspender",
  "Aguardando Enel"
];
const fieldPendencyReturnToCadOptions = ["Termo", "CVT", "Fotos", "OC"];

const defaultCollaborators = [
  { id: newId(), name: "Joao", stages: ["Levantamento de Campo"], queueActive: true, queueOrder: { "Levantamento de Campo": 1, "Criacao de CAD": 1, "Orcamento": 1 } },
  { id: newId(), name: "Maria", stages: ["Criacao de CAD", "Orcamento"], queueActive: true, queueOrder: { "Levantamento de Campo": 2, "Criacao de CAD": 2, "Orcamento": 2 } },
  { id: newId(), name: "Pedro", stages: ["Levantamento de Campo", "Orcamento"], queueActive: true, queueOrder: { "Levantamento de Campo": 3, "Criacao de CAD": 3, "Orcamento": 3 } },
  { id: newId(), name: "Carlos", stages: ["Criacao de CAD"], queueActive: true, queueOrder: { "Levantamento de Campo": 4, "Criacao de CAD": 4, "Orcamento": 4 } }
];

const defaultUsers = [
  { id: newId(), fullName: "Joao Silva", login: "joao", passwordHash: "", accessLevel: 100, collaboratorName: "Joao" },
  { id: newId(), fullName: "Maria Santos", login: "maria", passwordHash: "", accessLevel: 80, collaboratorName: "Maria" },
  { id: newId(), fullName: "Pedro Lima", login: "pedro", passwordHash: "", accessLevel: 50, collaboratorName: "Pedro" }
];

const defaultOrders = [];

const elements = {
  satelLoader: document.querySelector("#satelLoader"),
  loginScreen: document.querySelector("#loginScreen"),
  appShell: document.querySelector("#appShell"),
  loginForm: document.querySelector("#loginForm"),
  loginUser: document.querySelector("#loginUser"),
  loginPassword: document.querySelector("#loginPassword"),
  loginMessage: document.querySelector("#loginMessage"),
  logoutButton: document.querySelector("#logoutButton"),
  currentUserAvatar: document.querySelector("#currentUserAvatar"),
  currentUserName: document.querySelector("#currentUserName"),
  currentUserPresence: document.querySelector("#currentUserPresence"),
  currentUserRole: document.querySelector("#currentUserRole"),
  currentUserProductivity: document.querySelector("#currentUserProductivity"),
  presenceList: document.querySelector("#presenceList"),
  accountStartDate: document.querySelector("#accountStartDate"),
  accountEndDate: document.querySelector("#accountEndDate"),
  distributionList: document.querySelector("#distributionList"),
  distributionToggleButton: document.querySelector("#distributionToggleButton"),
  screenTitle: document.querySelector("#screenTitle"),
  screens: {
    dashboard: document.querySelector("#dashboardScreen"),
    board: document.querySelector("#boardScreen"),
    processes: document.querySelector("#processesScreen"),
    adequacies: document.querySelector("#adequaciesScreen"),
    pendencies: document.querySelector("#pendenciesScreen"),
    account: document.querySelector("#accountScreen"),
    admin: document.querySelector("#adminScreen")
  },
  navItems: document.querySelectorAll(".side-item"),
  adminTabs: document.querySelectorAll(".admin-tab"),
  adminSections: document.querySelectorAll(".admin-section"),
  importInput: document.querySelector("#importInput"),
  statusUpdateInput: document.querySelector("#statusUpdateInput"),
  fieldUpdateInput: document.querySelector("#fieldUpdateInput"),
  fieldUpdateImportControl: document.querySelector("#fieldUpdateImportControl"),
  coordinatesInput: document.querySelector("#coordinatesInput"),
  linkedStatusButton: document.querySelector("#linkedStatusButton"),
  importStatus: document.querySelector("#importStatus"),
  exportButton: document.querySelector("#exportButton"),
  ordersExportMonth: document.querySelector("#ordersExportMonth"),
  ordersExportType: document.querySelector("#ordersExportType"),
  exportOrdersXlsxButton: document.querySelector("#exportOrdersXlsxButton"),
  newOrderButton: document.querySelector("#newOrderButton"),
  dashboardMetrics: document.querySelector("#dashboardMetrics"),
  dashboardStageFilter: document.querySelector("#dashboardStageFilter"),
  dashboardCollaboratorFilter: document.querySelector("#dashboardCollaboratorFilter"),
  dashboardRegionalFilter: document.querySelector("#dashboardRegionalFilter"),
  dashboardDeadlineFilter: document.querySelector("#dashboardDeadlineFilter"),
  dashboardProcessFilter: document.querySelector("#dashboardProcessFilter"),
  dashboardPendencyFilter: document.querySelector("#dashboardPendencyFilter"),
  dashboardPeriodPreset: document.querySelector("#dashboardPeriodPreset"),
  dashboardStartDate: document.querySelector("#dashboardStartDate"),
  dashboardEndDate: document.querySelector("#dashboardEndDate"),
  stageBars: document.querySelector("#stageBars"),
  rankingList: document.querySelector("#rankingList"),
  productivityChart: document.querySelector("#productivityChart"),
  dashboardProcessSummary: document.querySelector("#dashboardProcessSummary"),
  dashboardProcessOrders: document.querySelector("#dashboardProcessOrders"),
  dashboardPendencySummary: document.querySelector("#dashboardPendencySummary"),
  dashboardPendencyOrders: document.querySelector("#dashboardPendencyOrders"),
  regionalDashboard: document.querySelector("#regionalDashboard"),
  stageTabs: document.querySelector("#stageTabs"),
  processTabs: document.querySelector("#processTabs"),
  adequacyTabs: document.querySelector("#adequacyTabs"),
  searchInput: document.querySelector("#searchInput"),
  urgencyFilter: document.querySelector("#urgencyFilter"),
  processSearchInput: document.querySelector("#processSearchInput"),
  processUrgencyFilter: document.querySelector("#processUrgencyFilter"),
  adequacySearchInput: document.querySelector("#adequacySearchInput"),
  adequacyUrgencyFilter: document.querySelector("#adequacyUrgencyFilter"),
  pendencySearchInput: document.querySelector("#pendencySearchInput"),
  pendencyTypeFilter: document.querySelector("#pendencyTypeFilter"),
  pendencySummary: document.querySelector("#pendencySummary"),
  kanbanBoard: document.querySelector("#kanbanBoard"),
  processGrid: document.querySelector("#processGrid"),
  adequacyGrid: document.querySelector("#adequacyGrid"),
  pendencyList: document.querySelector("#pendencyList"),
  generalReport: document.querySelector("#generalReport"),
  deadlineReport: document.querySelector("#deadlineReport"),
  responsibleReport: document.querySelector("#responsibleReport"),
  collaboratorForm: document.querySelector("#collaboratorForm"),
  collaboratorId: document.querySelector("#collaboratorId"),
  collaboratorName: document.querySelector("#collaboratorName"),
  queueCampo: document.querySelector("#queueCampo"),
  queueCad: document.querySelector("#queueCad"),
  queueOrcamento: document.querySelector("#queueOrcamento"),
  queueActive: document.querySelector("#queueActive"),
  permissionGrid: document.querySelector("#permissionGrid"),
  processPermissionGrid: document.querySelector("#processPermissionGrid"),
  collaboratorList: document.querySelector("#collaboratorList"),
  userCsvInput: document.querySelector("#userCsvInput"),
  userForm: document.querySelector("#userForm"),
  userId: document.querySelector("#userId"),
  userFullName: document.querySelector("#userFullName"),
  userLoginName: document.querySelector("#userLoginName"),
  userCollaboratorId: document.querySelector("#userCollaboratorId"),
  userPassword: document.querySelector("#userPassword"),
  userAccessLevel: document.querySelector("#userAccessLevel"),
  userList: document.querySelector("#userList"),
  profileForm: document.querySelector("#profileForm"),
  profilePhotoPreview: document.querySelector("#profilePhotoPreview"),
  profilePhotoInput: document.querySelector("#profilePhotoInput"),
  profilePhotoRemove: document.querySelector("#profilePhotoRemove"),
  profileFullName: document.querySelector("#profileFullName"),
  profileLogin: document.querySelector("#profileLogin"),
  profileRole: document.querySelector("#profileRole"),
  profileAccessLevel: document.querySelector("#profileAccessLevel"),
  profileOnlineStatus: document.querySelector("#profileOnlineStatus"),
  profileAvailability: document.querySelector("#profileAvailability"),
  profileStatusMessage: document.querySelector("#profileStatusMessage"),
  profileStatus: document.querySelector("#profileStatus"),
  passwordForm: document.querySelector("#passwordForm"),
  currentPassword: document.querySelector("#currentPassword"),
  newPassword: document.querySelector("#newPassword"),
  confirmPassword: document.querySelector("#confirmPassword"),
  passwordStatus: document.querySelector("#passwordStatus"),
  permissionsTable: document.querySelector("#permissionsTable"),
  auditSearch: document.querySelector("#auditSearch"),
  auditUserFilter: document.querySelector("#auditUserFilter"),
  auditOsFilter: document.querySelector("#auditOsFilter"),
  auditActionFilter: document.querySelector("#auditActionFilter"),
  auditStartDate: document.querySelector("#auditStartDate"),
  auditEndDate: document.querySelector("#auditEndDate"),
  exportAuditCsvButton: document.querySelector("#exportAuditCsvButton"),
  exportAuditPdfButton: document.querySelector("#exportAuditPdfButton"),
  timeDashboardSection: document.querySelector("#timeDashboardSection"),
  timeDashboard: document.querySelector("#timeDashboard"),
  historyList: document.querySelector("#historyList"),
  modal: document.querySelector("#orderModal"),
  pendencyModal: document.querySelector("#pendencyModal"),
  pendencyForm: document.querySelector("#pendencyForm"),
  pendencyTitle: document.querySelector("#pendencyTitle"),
  pendencyOrderId: document.querySelector("#pendencyOrderId"),
  pendencyOptions: document.querySelector("#pendencyOptions"),
  pendencyNote: document.querySelector("#pendencyNote"),
  closePendencyButton: document.querySelector("#closePendencyButton"),
  orderForm: document.querySelector("#orderForm"),
  closeModalButton: document.querySelector("#closeModalButton"),
  modalTitle: document.querySelector("#modalTitle"),
  nextStageButton: document.querySelector("#nextStageButton"),
  sharePointButton: document.querySelector("#sharePointButton"),
  returnToCadButton: document.querySelector("#returnToCadButton"),
  returnToCadStageButton: document.querySelector("#returnToCadStageButton"),
  deleteOrderButton: document.querySelector("#deleteOrderButton"),
  lockedSections: document.querySelector("#lockedSections"),
  processDetailsContainer: document.querySelector("#processDetailsContainer"),
  openFilesLinkButton: document.querySelector("#openFilesLinkButton")
};

const fields = {
  orderId: document.querySelector("#orderId"),
  osNumber: document.querySelector("#osNumber"),
  clientName: document.querySelector("#clientName"),
  city: document.querySelector("#city"),
  coordinateX: document.querySelector("#coordinateX"),
  coordinateY: document.querySelector("#coordinateY"),
  priority: document.querySelector("#priority"),
  stage: document.querySelector("#stage"),
  owner: document.querySelector("#owner"),
  receivedDate: document.querySelector("#receivedDate"),
  startDate: document.querySelector("#startDate"),
  finishDate: document.querySelector("#finishDate"),
  poles: document.querySelector("#poles"),
  structures: document.querySelector("#structures"),
  ans: document.querySelector("#ans"),
  regional: document.querySelector("#regional"),
  orderValidator: document.querySelector("#orderValidator"),
  remoteOrder: document.querySelector("#remoteOrder"),
  fieldTech: document.querySelector("#fieldTech"),
  cadist: document.querySelector("#cadist"),
  budgeter: document.querySelector("#budgeter"),
  fieldStatus: document.querySelector("#fieldStatus"),
  cadStatus: document.querySelector("#cadStatus"),
  budgetStatus: document.querySelector("#budgetStatus"),
  filesLink: document.querySelector("#filesLink"),
  notes: document.querySelector("#notes"),
  processParalelismo: document.querySelector("#processParalelismo"),
  processAmbiental: document.querySelector("#processAmbiental"),
  processLt: document.querySelector("#processLt"),
  processFerrovia: document.querySelector("#processFerrovia"),
  processAcude: document.querySelector("#processAcude"),
  processRio: document.querySelector("#processRio"),
  processTermo: document.querySelector("#processTermo"),
  processType: document.querySelector("#processType"),
  processOwner: document.querySelector("#processOwner"),
  processStatus: document.querySelector("#processStatus"),
  processStartDate: document.querySelector("#processStartDate"),
  processEndDate: document.querySelector("#processEndDate"),
  processNotes: document.querySelector("#processNotes"),
  processLink: document.querySelector("#processLink"),
  processFiles: document.querySelector("#processFiles"),
  voiceProject: document.querySelector("#voiceProject"),
  voiceParalelismo: document.querySelector("#voiceParalelismo"),
  voiceAmbiental: document.querySelector("#voiceAmbiental"),
  voiceAmbientalPoles: document.querySelector("#voiceAmbientalPoles"),
  voiceAmbientalRepeat: document.querySelector("#voiceAmbientalRepeat"),
  voiceTermo: document.querySelector("#voiceTermo"),
  voiceTermoPoles: document.querySelector("#voiceTermoPoles"),
  voiceTermoRepeat: document.querySelector("#voiceTermoRepeat"),
  voiceTravessiaLt: document.querySelector("#voiceTravessiaLt"),
  voiceTravessiaLtPoles: document.querySelector("#voiceTravessiaLtPoles"),
  voiceTravessiaLtRepeat: document.querySelector("#voiceTravessiaLtRepeat"),
  voiceTravessiaRio: document.querySelector("#voiceTravessiaRio"),
  voiceTravessiaRioPoles: document.querySelector("#voiceTravessiaRioPoles"),
  voiceTravessiaRioRepeat: document.querySelector("#voiceTravessiaRioRepeat"),
  voiceProjectType: document.querySelector("#voiceProjectType"),
  voiceProjectPoles: document.querySelector("#voiceProjectPoles"),
  voiceProjectRepeat: document.querySelector("#voiceProjectRepeat"),
  voiceParalelismoPoles: document.querySelector("#voiceParalelismoPoles"),
  voiceParalelismoRepeat: document.querySelector("#voiceParalelismoRepeat")
};

let orders = [];
let collaborators = [];
let historyEntries = [];
let users = [];
let distributionEntries = [];
let deletedOrderIds = [];
let lastSeenDistributionId = "";
let newDistributionMarker = null;
let distributionPollTimer = null;
let orderTimerInterval = null;
let presenceHeartbeatTimer = null;
let presencePollTimer = null;
let currentUser = null;
let activeScreen = "dashboard";
let activeBoardTab = stages[0];
let activeProcessTab = processTabs[0].label;
let activeAdequacyTab = adequacyTabs[0].label;
let lastKnownStateUpdatedAt = "";
let statePollInFlight = false;
const movingOrderIds = new Set();
const protectedOrderMoves = new Map();
const protectedMoveDurationMs = 12000;
let presenceByUserId = {};
let pendingProfilePhotoDataUrl = "";

function timestampValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function cleanupProtectedOrderMoves() {
  const now = Date.now();
  for (const [id, move] of protectedOrderMoves.entries()) {
    if (!move || move.until <= now) protectedOrderMoves.delete(id);
  }
}

function protectMovedOrder(order) {
  if (!order?.id) return;
  protectedOrderMoves.set(order.id, {
    order,
    until: Date.now() + protectedMoveDurationMs
  });
}

function releaseProtectedOrder(id) {
  if (id) protectedOrderMoves.delete(id);
}

function mergeProtectedOrders(incomingOrders) {
  cleanupProtectedOrderMoves();
  if (!Array.isArray(incomingOrders) || !protectedOrderMoves.size) return incomingOrders;
  const seen = new Set();
  const merged = incomingOrders.map((order) => {
    const protectedMove = protectedOrderMoves.get(order.id);
    if (!protectedMove) return order;
    seen.add(order.id);
    if (timestampValue(protectedMove.order.updatedAt) >= timestampValue(order.updatedAt)) {
      return protectedMove.order;
    }
    protectedOrderMoves.delete(order.id);
    return order;
  });
  for (const [id, protectedMove] of protectedOrderMoves.entries()) {
    if (!seen.has(id)) merged.push(protectedMove.order);
  }
  return merged;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function makeOrder(overrides = {}) {
  return {
    id: newId(),
    osNumber: "",
    clientName: "",
    city: "",
    coordinateX: "",
    coordinateY: "",
    stage: stages[0],
    owner: "Sem Responsavel",
    fieldTech: "",
    cadist: "",
    budgeter: "",
    fieldStatus: "NAO TRATADO",
    cadStatus: "NAO TRATADO",
    budgetStatus: "NAO TRATADO",
    receivedDate: today(),
    startDate: "",
    finishDate: "",
    poles: 0,
    structures: 0,
    ans: "",
    regional: "",
    orderValidator: "",
    remoteOrder: false,
    remoteEvaluated: false,
    remoteEvaluatedAt: "",
    remoteEvaluationDestination: "",
    remoteFastTrack: false,
    remoteFastTrackAt: "",
    pendencies: [],
    pendencyState: null,
    pendencyNotes: [],
    notes: "",
    filesLink: "",
    priority: "Media",
    processParalelismo: false,
    processAmbiental: false,
    processLt: false,
    processFerrovia: false,
    processAcude: false,
    processRio: false,
    processTermo: false,
    processEvaluation: false,
    processOnlyCompleted: false,
    processType: "",
    processOwner: "Sem Responsavel",
    processStatus: "Aguardando",
    processStartDate: "",
    processEndDate: "",
    processNotes: "",
    processLink: "",
    processFiles: "",
    voices: defaultVoices(),
    timeTracking: defaultTimeTracking(overrides),
    raw: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    if (error?.name === "QuotaExceededError" || String(error?.message || "").includes("quota")) {
      console.warn(`Cache local cheio ao salvar ${key}. Limpando cache pesado do navegador.`, error);
      try {
        localStorage.removeItem(storeKeys.history);
        localStorage.removeItem(offlineSaveKey);
      } catch {}
      if (key !== storeKeys.history) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (retryError) {
          console.warn(`Nao foi possivel salvar cache local ${key}. O banco da VPS continua sendo a fonte principal.`, retryError);
        }
      }
      return;
    }
    throw error;
  }
}

function normalizeCollaborators(items) {
  return items.map((person, index) => ({
    ...person,
    queueActive: person.queueActive !== false,
    queueOrder: {
      "Levantamento de Campo": Number(person.queueOrder?.["Levantamento de Campo"] || index + 1),
      "Criacao de CAD": Number(person.queueOrder?.["Criacao de CAD"] || index + 1),
      "Orcamento": Number(person.queueOrder?.["Orcamento"] || index + 1)
    },
    processes: Array.isArray(person.processes) ? person.processes : processTabs.map((process) => process.key)
  }));
}

let saveQueue = Promise.resolve();
let pendingSaveSnapshot = null;
let pendingSaveTimer = null;
let pendingSavePromise = null;
let saveStatusElement = null;
let lastSaveErrorAt = 0;
let saveInFlight = false;
let lastLocalMutationAt = 0;
const saveDebounceMs = 650;
const saveRetryDelaysMs = [900, 2200, 5000, 10000];
const syncQuietWindowMs = 3500;
const offlineSaveKey = "ordem-certa-desktop-pending-save-v1";

function storedSessionData() {
  try {
    return JSON.parse(sessionStorage.getItem(storeKeys.session) || localStorage.getItem(storeKeys.session) || "null");
  } catch {
    return null;
  }
}

async function apiRequest(path, options = {}) {
  const timeoutMs = options.timeoutMs || 20000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const token = storedSessionData()?.token || "";
  try {
    const response = await fetch(path, {
      ...options,
      signal: options.signal || controller.signal,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if(path==='/api/state' && options.method==='PUT')desktopRecordAttempt(response.ok?'Lote confirmado pelo servidor.':payload.error||'Falha ao salvar',response.status);
    if (!response.ok) {
      if(response.status===401 && path!=="/api/login") { sessionStorage.removeItem(storeKeys.session);localStorage.removeItem(storeKeys.session);window.location.replace("index.html"); }
      throw Object.assign(new Error(payload.error || "Falha de comunicacao com o servidor."),{status:response.status});
    }
    return payload;
  } catch (error) {
    if(path==='/api/state' && options.method==='PUT' && !error.status)desktopRecordAttempt('Resultado desconhecido: '+error.message,'rede/tempo');
    if (error?.name === "AbortError") {
      throw new Error("Tempo esgotado ao comunicar com o banco de dados. Verifique se o servidor da VPS esta respondendo.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function compactSnapshotForBrowser(snapshot, historyLimit = 0) {
  return {
    ...snapshot,
    historyEntries: historyLimit > 0 ? (snapshot.historyEntries || []).slice(-historyLimit) : [],
    orders: snapshot.orders || [],
    collaborators: snapshot.collaborators || [],
    users: snapshot.users || [],
    distributionEntries: snapshot.distributionEntries || [],
    deletedOrderIds: snapshot.deletedOrderIds || []
  };
}

function cleanupHeavyBrowserCache() {
  try {
    localStorage.removeItem(storeKeys.history);
  } catch {}
}

function storeLocalStateSnapshot(snapshot) {
  cleanupHeavyBrowserCache();
  save(storeKeys.orders, snapshot.orders || []);
  save(storeKeys.collaborators, snapshot.collaborators || []);
  save(storeKeys.users, snapshot.users || []);
  save(storeKeys.distributions, snapshot.distributionEntries || []);
}

function setSaveStatus(status, message) {
  if (!saveStatusElement) {
    saveStatusElement = document.createElement("div");
    saveStatusElement.className = "save-status";
    saveStatusElement.setAttribute("role", "status");
    saveStatusElement.setAttribute("aria-live", "polite");
    document.body.appendChild(saveStatusElement);
  }
  saveStatusElement.className = `save-status ${status || ""}`.trim();
  saveStatusElement.textContent = message || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasLocalSavePending() {
  return Boolean(
    pendingSaveSnapshot
    || pendingSaveTimer
    || saveInFlight
    || movingOrderIds.size
    || Date.now() - lastLocalMutationAt < syncQuietWindowMs
  );
}

function flushPendingSave() {
  if (pendingSaveTimer) {
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
  }
  if (!pendingSaveSnapshot) return pendingSavePromise || Promise.resolve();
  const snapshot = pendingSaveSnapshot;
  pendingSaveSnapshot = null;
  storeLocalStateSnapshot(snapshot);
  persistPendingOfflineSnapshot(snapshot);
  setSaveStatus("saving", "Salvando alteracoes...");
  const task = saveQueue
    .catch(() => {})
    .then(async () => {
      saveInFlight = true;
      try {
        return await sendSnapshotWithRetry(snapshot);
      } finally {
        saveInFlight = false;
      }
    })
    .then(() => {
      setSaveStatus("saved", "Alteracoes salvas");
      setTimeout(() => {
        if (saveStatusElement?.classList.contains("saved")) setSaveStatus("", "");
      }, 2200);
    })
    .catch((error) => {
      console.error(error);
      persistPendingOfflineSnapshot(snapshot);
      setSaveStatus("error", "Nao foi salvo: " + error.message); showDesktopRecovery(error.message);
      const now = Date.now();
      if (now - lastSaveErrorAt > 60000) {
        lastSaveErrorAt = now;
        console.warn("Salvamento pendente localmente. Verifique servidor/rede.", error);
      }
    });
  saveQueue = task;
  pendingSavePromise = task;
  return task;
}

function scheduleSave(snapshot) {
  lastLocalMutationAt = Date.now();
  pendingSaveSnapshot = snapshot;
  storeLocalStateSnapshot(snapshot);
  persistPendingOfflineSnapshot(snapshot);
  setSaveStatus("saving", "Salvamento na fila...");
  if (pendingSaveTimer) clearTimeout(pendingSaveTimer);
  pendingSaveTimer = setTimeout(flushPendingSave, saveDebounceMs);
  return pendingSavePromise || Promise.resolve();
}

async function loadServerState() {
  try {
    const state = await apiRequest("/api/state");
    lastKnownStateUpdatedAt = state.updatedAt || lastKnownStateUpdatedAt;
    orders = Array.isArray(state.orders) ? mergeProtectedOrders(state.orders) : load(storeKeys.orders, []);
    collaborators = normalizeCollaborators(Array.isArray(state.collaborators) && state.collaborators.length ? state.collaborators : load(storeKeys.collaborators, defaultCollaborators));
    historyEntries = normalizeHistoryEntries(Array.isArray(state.historyEntries) && state.historyEntries.length ? state.historyEntries : load(storeKeys.history, []));
    users = Array.isArray(state.users) && state.users.length ? state.users : load(storeKeys.users, []);
    presenceByUserId = state.presence || presenceByUserId || {};
    deletedOrderIds = Array.isArray(state.deletedOrderIds) ? state.deletedOrderIds : [];
    const savedDistributions = normalizeDistributionEntries(load(storeKeys.distributions, []));
    const serverDistributions = normalizeDistributionEntries(Array.isArray(state.distributionEntries) ? state.distributionEntries : []);
    distributionEntries = serverDistributions.length ? serverDistributions : savedDistributions;
    lastSeenDistributionId = distributionEntries[0]?.id || "";
    desktopBase = structuredClone(stateSnapshot());
  } catch (error) {
    console.error(error);
    orders = load(storeKeys.orders, []);
    collaborators = normalizeCollaborators(load(storeKeys.collaborators, defaultCollaborators));
    historyEntries = normalizeHistoryEntries(load(storeKeys.history, []));
    users = load(storeKeys.users, []);
    deletedOrderIds = [];
    distributionEntries = normalizeDistributionEntries(load(storeKeys.distributions, []));
    lastSeenDistributionId = distributionEntries[0]?.id || "";
    throw new Error("Nao foi possivel carregar a base. Verifique DBSRV e TMSRV e use Atualizar.");
  }
}

function stateSnapshot() {
  syncAllOrderTimers();
  return {
    orders,
    collaborators,
    historyEntries: normalizeHistoryEntries(historyEntries),
    users,
    distributionEntries,
    deletedOrderIds
  };
}

function cloneStateSnapshot() {
  return JSON.parse(JSON.stringify(stateSnapshot()));
}

function restoreSnapshot(snapshot) {
  orders = snapshot.orders;
  collaborators = snapshot.collaborators;
  historyEntries = snapshot.historyEntries;
  users = snapshot.users;
  distributionEntries = snapshot.distributionEntries;
  deletedOrderIds = snapshot.deletedOrderIds || [];
}

function persistStrict(snapshot = stateSnapshot()) {
  pendingSaveSnapshot = snapshot;
  return flushPendingSave();
}

function persist() {
  const snapshot = stateSnapshot();
  return scheduleSave(snapshot);
}

function sha256Fallback(value) {
  const bytes = new TextEncoder().encode(String(value));
  const words = [];
  const bitLength = bytes.length * 8;
  for (let index = 0; index < bytes.length; index += 1) {
    words[index >> 2] |= bytes[index] << (24 - (index % 4) * 8);
  }
  words[bitLength >> 5] |= 0x80 << (24 - bitLength % 32);
  words[(((bitLength + 64) >> 9) << 4) + 15] = bitLength;

  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const schedule = new Array(64);
  const rotateRight = (number, amount) => (number >>> amount) | (number << (32 - amount));

  for (let block = 0; block < words.length; block += 16) {
    for (let index = 0; index < 64; index += 1) {
      if (index < 16) {
        schedule[index] = words[block + index] | 0;
      } else {
        const s0 = rotateRight(schedule[index - 15], 7) ^ rotateRight(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3);
        const s1 = rotateRight(schedule[index - 2], 17) ^ rotateRight(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10);
        schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) | 0;
      }
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + constants[index] + schedule[index]) | 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((part) => (part >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

async function hashPassword(password) {
  if (globalThis.crypto?.subtle?.digest) {
    const bytes = new TextEncoder().encode(password);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return sha256Fallback(password);
}

async function ensureUsersLoaded() {
  if (!users.length) {
    users = await Promise.all(defaultUsers.map(async (user) => ({
      ...user,
      collaboratorId: collaborators.find((person) => person.name === user.collaboratorName)?.id || "",
      passwordHash: await hashPassword("123456")
    })));
    await tryLoadUsersCsv();
    persist();
  }
}

async function tryLoadUsersCsv() {
  try {
    const response = await fetch("users.csv", { cache: "no-store" });
    if (!response.ok) return;
    const text = await response.text();
    const rows = csvToRows(text);
    if (rows.length) users = await usersFromRows(rows);
  } catch {
    // Browsers block fetch for local file:// in some cases; manual CSV import remains available.
  }
}

async function usersFromRows(rows) {
  const imported = [];
  for (const row of rows) {
    const fullName = getRowValue(row, "Nome do Colaborador", "Nome", "Colaborador");
    const login = getRowValue(row, "Usuario de Login", "Usuario", "UsuÃƒÂ¡rio", "Login");
    const password = getRowValue(row, "Senha", "Password");
    const accessLevel = Number(getRowValue(row, "Nivel de Acesso", "NÃƒÂ­vel de Acesso", "Nivel", "NÃƒÂ­vel") || 0);
    if (!fullName || !login || !password) continue;
    imported.push({
      id: newId(),
      fullName: String(fullName).trim(),
      login: String(login).trim(),
      collaboratorId: findCollaboratorByName(fullName)?.id || "",
      passwordHash: await hashPassword(String(password)),
      accessLevel: Math.max(0, Math.min(100, accessLevel))
    });
  }
  return imported;
}

function getRowValue(row, ...names) {
  const normalized = names.map(normalizeHeader);
  const entries = Object.entries(row);
  // Prefer the canonical header over alternative names, regardless of column order.
  // A present but empty field must not borrow a value from another column.
  let found;
  for (const name of normalized) {
    found = entries.find(([key]) => normalizeHeader(key) === name);
    if (found) break;
  }
  desktopColumnRead(row,names,found);
  return found ? found[1] : "";
}

function getRowColumnValue(row, columnIndex) {
  desktopColumnRead(row,[],null,columnIndex);
  if (Array.isArray(row)) return row[columnIndex] ?? "";
  const rawValues = row?.__rowValues;
  return Array.isArray(rawValues) ? rawValues[columnIndex] ?? "" : "";
}

function normalizeNameParts(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function hasNameSequence(sourceParts, targetParts) {
  if (!sourceParts.length || !targetParts.length || targetParts.length > sourceParts.length) return false;
  return sourceParts.some((part, index) => targetParts.every((target, offset) => sourceParts[index + offset] === target));
}

function findCollaboratorByName(name) {
  const normalized = normalizeHeader(name);
  if (!normalized) return null;
  const exact = collaborators.find((person) => normalizeHeader(person.name) === normalized);
  if (exact) return exact;

  const sourceParts = normalizeNameParts(name);
  const candidates = collaborators
    .map((person) => ({ person, parts: normalizeNameParts(person.name) }))
    .filter(({ parts }) => hasNameSequence(sourceParts, parts) || hasNameSequence(parts, sourceParts))
    .sort((a, b) => b.parts.length - a.parts.length);

  return candidates.length === 1 ? candidates[0].person : null;
}

function currentCollaborator() {
  if (!currentUser) return null;
  return collaborators.find((person) => person.id === currentUser.collaboratorId)
    || findCollaboratorByName(currentUser.collaboratorName)
    || findCollaboratorByName(currentUser.fullName)
    || findCollaboratorByName(currentUser.login)
    || null;
}

function findUserByCollaboratorName(name) {
  const normalized = normalizeHeader(name);
  if (!normalized) return null;
  const person = findCollaboratorByName(name);
  const exactId = person ? users.find((user) => user.collaboratorId === person.id) : null;
  if (exactId) return exactId;

  const exactName = users.find((user) =>
    normalizeHeader(user.collaboratorName) === normalized ||
    normalizeHeader(user.fullName) === normalized ||
    normalizeHeader(user.login) === normalized
  );
  if (exactName) return exactName;

  const sourceParts = normalizeNameParts(name);
  const candidates = users
    .map((user) => ({ user, parts: normalizeNameParts(user.collaboratorName || user.fullName || user.login) }))
    .filter(({ parts }) => hasNameSequence(sourceParts, parts) || hasNameSequence(parts, sourceParts))
    .sort((a, b) => b.parts.length - a.parts.length);

  return candidates.length === 1 ? candidates[0].user : null;
}

function userForCollaboratorName(name) {
  return findUserByCollaboratorName(name);
}

function initialsForName(name) {
  const parts = String(name || "Usuario").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : (parts[0] || "U").slice(0, 2)).toUpperCase();
}

function profilePhotoHtml(user, name, size = "small") {
  const label = initialsForName(user?.fullName || name);
  if (user?.profilePhoto) {
    return `<img class="profile-avatar ${size}" src="${escapeHtml(user.profilePhoto)}" alt="${escapeHtml(user.fullName || name || "Usuario")}">`;
  }
  return `<span class="profile-avatar ${size}">${escapeHtml(label)}</span>`;
}

function userPresence(user) {
  return user?.id ? presenceByUserId[user.id] || {} : {};
}

function isUserOnline(user) {
  return Boolean(userPresence(user).online);
}

function availabilityText(user) {
  return user?.availabilityStatus || "Disponivel";
}

function statusMessageText(user) {
  return String(user?.statusMessage || "").slice(0, 50);
}

function collaboratorHeaderHtml(owner, stage) {
  const displayName = displayOwnerName(owner);
  if (isUnassignedOwner(owner)) {
    return `<div class="column-title">${escapeHtml(displayName)}${isNewDistributionColumn(owner, stage) ? `<b class="new-badge">NEW</b>` : ""}<span>${escapeHtml(stage)}</span></div>`;
  }
  const user = userForCollaboratorName(owner);
  const online = isUserOnline(user);
  const customStatus = statusMessageText(user);
  const statusText = user ? `${online ? "Online" : "Offline"}${online ? ` - ${availabilityText(user)}` : ""}` : "Sem conta vinculada";
  return `
    <div class="column-person">
      ${profilePhotoHtml(user, owner, "small")}
      <div class="column-title">
        ${escapeHtml(displayName)}${isNewDistributionColumn(owner, stage) ? `<b class="new-badge">NEW</b>` : ""}
        <span class="presence-line"><i class="presence-dot ${online ? "online" : "offline"}"></i>${escapeHtml(statusText)}</span>
        ${customStatus ? `<em>${escapeHtml(customStatus)}</em>` : `<span>${escapeHtml(stage)}</span>`}
      </div>
    </div>
  `;
}

function canEditOrderStatus(order) {
  if (hasPermission("admin")) return true;
  const collaborator = currentCollaborator();
  return Boolean(collaborator && order.owner === collaborator.name);
}

function currentSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(storeKeys.session) || localStorage.getItem(storeKeys.session));
    if (!session || Date.now() - session.startedAt > sessionMaxAgeMs) {
      sessionStorage.removeItem(storeKeys.session);
      localStorage.removeItem(storeKeys.session);
      return null;
    }
    return users.find((user) => user.id === session.userId)
      || users.find((user) => user.login && session.user?.login && user.login === session.user.login)
      || session.user
      || null;
  } catch {
    return null;
  }
}

function showLogin(message = "") {
  if (location.pathname.toLowerCase().endsWith("/app.html")) {
    window.location.replace(`index.html?expired=${Date.now()}`);
    return;
  }
  currentUser = null;
  stopDistributionPolling();
  stopOrderTimerUpdates();
  stopPresenceTracking();
  elements.appShell.classList.add("hidden");
  elements.loginScreen.classList.remove("hidden");
  elements.loginMessage.textContent = message;
  elements.loginMessage.className = message ? "login-message error" : "login-message";
}

function showApp() {
  currentUser = currentSession();
  if (!currentUser || !hasPermission("view")) {
    showLogin("Acesso negado ou sessao expirada.");
    return;
  }
  elements.loginScreen.classList.add("hidden");
  elements.appShell.classList.remove("hidden");
  updateCurrentUserSummary();
  elements.currentUserRole.textContent = `${roleName(currentUser.accessLevel)} - Nivel ${currentUser.accessLevel}`;
  if (elements.ordersExportMonth && !elements.ordersExportMonth.value) elements.ordersExportMonth.value = today().slice(0, 7);
  applyPermissions();
  startDistributionPolling();
  startOrderTimerUpdates();
  startPresenceTracking();
  showScreen(hasPermission("dashboard") ? "dashboard" : "board");
  hideSatelLoader();
}

function hideSatelLoader() {
  if (!elements.satelLoader) return;
  window.requestAnimationFrame(() => {
    elements.satelLoader.classList.add("done");
    window.setTimeout(() => elements.satelLoader?.remove(), 320);
  });
}

function updateCurrentUserSummary() {
  if (!currentUser) return;
  const online = isUserOnline(currentUser);
  if (elements.currentUserName) elements.currentUserName.textContent = currentUser.fullName || currentUser.login || "Usuario";
  if (elements.currentUserAvatar) {
    const photo = currentUser.profilePhoto;
    elements.currentUserAvatar.outerHTML = photo
      ? `<img class="profile-avatar small" id="currentUserAvatar" src="${escapeHtml(photo)}" alt="${escapeHtml(currentUser.fullName || "Usuario")}">`
      : `<div class="profile-avatar small" id="currentUserAvatar">${escapeHtml(initialsForName(currentUser.fullName))}</div>`;
    elements.currentUserAvatar = document.querySelector("#currentUserAvatar");
  }
  if (elements.currentUserPresence) {
    elements.currentUserPresence.innerHTML = `<i class="presence-dot ${online ? "online" : "offline"}"></i>${online ? `Online - ${escapeHtml(availabilityText(currentUser))}` : "Offline"}`;
  }
}

function presencePeople() {
  const people = new Map();
  collaborators.forEach((person) => {
    const user = users.find((item) => item.collaboratorId === person.id)
      || users.find((item) => normalizeHeader(item.fullName) === normalizeHeader(person.name));
    people.set(user?.id || `collaborator-${person.id}`, {
      name: person.name,
      role: collaboratorSectorLabel(person),
      user,
      online: user ? isUserOnline(user) : false,
      availability: user ? availabilityText(user) : "Offline",
      statusMessage: user ? statusMessageText(user) : ""
    });
  });
  users.forEach((user) => {
    if (people.has(user.id)) return;
    const person = collaborators.find((item) => item.id === user.collaboratorId) || collaborators.find((item) => normalizeHeader(item.name) === normalizeHeader(user.fullName)) || null;
    people.set(user.id, {
      name: user.fullName || user.login || "Usuario",
      role: collaboratorSectorLabel(person),
      user,
      online: isUserOnline(user),
      availability: availabilityText(user),
      statusMessage: statusMessageText(user)
    });
  });
  return [...people.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

function renderPresenceList() {
  if (!elements.presenceList) return;
  const people = presencePeople();
  const onlineTotal = people.filter((person) => person.online).length;
  const offlineTotal = Math.max(0, people.length - onlineTotal);
  if (!people.length) {
    elements.presenceList.innerHTML = `<small>Nenhuma pessoa cadastrada.</small>`;
    return;
  }
  elements.presenceList.innerHTML = `
    <div class="presence-counts"><span>Online <strong>${onlineTotal}</strong></span><span>Offline <strong>${offlineTotal}</strong></span></div>
    ${people.map((person) => `
      <article class="presence-person ${person.online ? "online" : "offline"}">
        ${profilePhotoHtml(person.user, person.name, "small")}
        <div>
          <strong>${escapeHtml(person.name)}</strong>
          <span><i class="presence-dot ${person.online ? "online" : "offline"}"></i>${person.online ? `Online - ${escapeHtml(person.availability)}` : "Offline"}</span>
          <small title="${escapeHtml(person.statusMessage || person.role || "")}">${escapeHtml(person.statusMessage || person.role || "Sem setor vinculado")}</small>
        </div>
      </article>
    `).join("")}
  `;
}

async function heartbeatPresence() {
  if (!currentUser) return;
  try {
    const result = await apiRequest("/api/presence", { method: "POST", body: "{}" });
    presenceByUserId = result.presence || presenceByUserId;
    updateCurrentUserSummary();
    renderPresenceList();
    if (activeScreen === "account") renderAccountProfile();
  } catch (error) {
    console.warn("Falha ao atualizar presenca", error);
  }
}

async function pollPresence() {
  if (!currentUser) return;
  try {
    const result = await apiRequest("/api/presence", { timeoutMs: 6000 });
    presenceByUserId = result.presence || presenceByUserId;
    updateCurrentUserSummary();
    renderPresenceList();
    if (activeScreen === "board" || activeScreen === "processes") {
      renderBoard();
      renderProcesses();
    }
    if (activeScreen === "account") renderAccountProfile();
  } catch (error) {
    console.warn("Falha ao consultar presenca", error);
  }
}

function startPresenceTracking() {
  stopPresenceTracking();
  void heartbeatPresence();
  void pollPresence();
  presenceHeartbeatTimer = window.setInterval(heartbeatPresence, 20000);
  presencePollTimer = window.setInterval(pollPresence, 10000);
}

function stopPresenceTracking() {
  if (presenceHeartbeatTimer) window.clearInterval(presenceHeartbeatTimer);
  if (presencePollTimer) window.clearInterval(presencePollTimer);
  presenceHeartbeatTimer = null;
  presencePollTimer = null;
}

function roleName(level) {
  if (level >= 91) return "Administrador Master";
  if (level >= 81) return "Gestor";
  if (level >= 61) return "Supervisor";
  if (level >= 51) return "Lider";
  return "Consulta";
}

function hasPermission(permission) {
  return Boolean(currentUser && currentUser.accessLevel >= permissions[permission]);
}

function requirePermission(permission) {
  if (hasPermission(permission)) return true;
  alert("Voce nao tem permissao para executar esta acao.");
  audit("Acesso bloqueado", "", "", `Permissao necessaria: ${permission}`);
  return false;
}

function canSaveExistingOrder() {
  return hasPermission("editOrder") || hasPermission("limitedOrderEdit");
}

function applyPermissions() {
  const screenRules = { dashboard: "dashboard", processes: "processes", pendencies: "processes", admin: "adminData" };
  elements.navItems.forEach((item) => {
    const permission = screenRules[item.dataset.screen];
    item.hidden = permission ? !hasPermission(permission) : false;
  });
  elements.newOrderButton.hidden = !hasPermission("createOrder");
  elements.importInput.closest(".import-button").hidden = !hasPermission("importOrders");
  if (elements.statusUpdateInput) elements.statusUpdateInput.closest(".import-button").hidden = !hasPermission("updateStatuses");
  updateFieldUpdateImportVisibility();
  if (elements.coordinatesInput) elements.coordinatesInput.closest(".import-button").hidden = !hasPermission("updateStatuses");
  if (elements.linkedStatusButton) elements.linkedStatusButton.hidden = !hasPermission("updateStatuses");
  if (elements.exportButton) elements.exportButton.hidden = !hasPermission("exportData");
  if (elements.exportOrdersXlsxButton) elements.exportOrdersXlsxButton.hidden = !hasPermission("exportData");
  if (elements.ordersExportMonth) elements.ordersExportMonth.closest(".monthly-export-actions").hidden = !hasPermission("exportData");
  applyAdminTabPermissions();
}

function updateFieldUpdateImportVisibility() {
  if (!elements.fieldUpdateImportControl) return;
  elements.fieldUpdateImportControl.hidden = !(activeBoardTab === "Levantamento de Campo" && hasPermission("updateStatuses"));
}

function loginBlocks() {
  try {
    return JSON.parse(localStorage.getItem(storeKeys.loginBlocks)) || {};
  } catch {
    return {};
  }
}

function saveLoginBlocks(blocks) {
  localStorage.setItem(storeKeys.loginBlocks, JSON.stringify(blocks));
}

async function login(event) {
  event.preventDefault();
  const loginName = elements.loginUser.value.trim();
  const password = elements.loginPassword.value;
  const submitButton = elements.loginForm.querySelector("button[type='submit']");

  try {
    elements.loginMessage.textContent = "Entrando...";
    elements.loginMessage.className = "login-message";
    if (submitButton) submitButton.disabled = true;
    const result = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({ login: loginName, password })
    });
    await loadServerState();
    currentUser = result.user;
    if (currentUser && !users.some((user) => user.id === currentUser.id)) {
      users = [currentUser, ...users.filter((user) => user.login !== currentUser.login)];
    }
    const session = JSON.stringify({ userId: currentUser.id, user: currentUser, startedAt: Date.now() });
    sessionStorage.setItem(storeKeys.session, session);
    localStorage.setItem(storeKeys.session, session);
    audit("Login realizado", "", "", `Usuario ${currentUser.login}`);
    elements.loginForm.reset();
    showApp();
  } catch (error) {
    console.error("Falha no login:", error);
    showLogin(error.message || "Usuario ou senha invalidos.");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}
function logout() {
  audit("Logout realizado", "", "", currentUser?.login || "");
  apiRequest("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
  stopPresenceTracking();
  sessionStorage.removeItem(storeKeys.session);
  localStorage.removeItem(storeKeys.session);
  showLogin();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function compactDisplayText(value, maxLength = 42) {
  const text = String(value ?? "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}
function slug(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function daysSince(dateValue) {
  if (!dateValue) return 0;
  const start = new Date(`${dateValue}T00:00:00`);
  const now = new Date();
  return Math.max(0, Math.floor((now - start) / 86400000));
}

function calculatedAnsValue(receivedDate) {
  return String(daysSince(receivedDate || today()));
}

function updateCalculatedAnsField() {
  if (!fields.ans) return;
  fields.ans.value = calculatedAnsValue(fields.receivedDate?.value);
}

function priorityByAnsDays(days) {
  if (days >= 11) return "Alta";
  if (days >= 7) return "Media";
  return "Baixa";
}

function deadlineInfo(order) {
  const days = daysSince(order.receivedDate);
  const priority = priorityByAnsDays(days);
  const remaining = Math.max(0, 12 - days);
  const remainingLabel = remaining === 1 ? "falta 1 dia" : `faltam ${remaining} dias`;

  if (days >= 12) {
    return { key: "ANS", label: `ANS ${days} dia(s) - vencido`, className: "ans-fora", days, remaining, hours: 0, minutes: 0, rank: 4, priority, source: "Recebimento" };
  }

  if (days >= 11) {
    return { key: "ANS", label: `ANS ${days} dia(s) - ${remainingLabel}`, className: "ans-alerta", days, remaining, hours: 0, minutes: 0, rank: 3, priority, source: "Recebimento" };
  }

  if (days >= 7) {
    return { key: "Dentro", label: `ANS ${days} dia(s) - ${remainingLabel}`, className: "ans-atencao", days, remaining, hours: 0, minutes: 0, rank: 2, priority, source: "Recebimento" };
  }

  return { key: "Dentro", label: `ANS ${days} dia(s) - ${remainingLabel}`, className: "ans-ok", days, remaining, hours: 0, minutes: 0, rank: 1, priority, source: "Recebimento" };
}

function stageStatus(order) {
  if (order.stage === "Levantamento de Campo") return order.fieldStatus || "NAO TRATADO";
  if (order.stage === "Criacao de CAD") return order.cadStatus || "NAO TRATADO";
  if (order.stage === "Orcamento") return order.budgetStatus || "NAO TRATADO";
  if (order.stage === "Concluido") return "CONCLUIDO";
  if (order.stage === "Rejeitado") return "REJEITADO";
  if (order.stage === "Cancelada") return "CANCELADA";
  if (order.stage === "Suspensa") return "SUSPENSA";
  return order.status || "NAO TRATADO";
}

function isBudgetConcluded(order) {
  return normalizeStatus(order?.budgetStatus || order?.statusImport?.budgetStatus || "") === "CONCLUIDO";
}

function processBlockedUntilBudgetMessage() {
  return "Esta ordem só pode entrar em Processos após a conclusão do Orçamento.";
}

function hasComplementaryProcess(order = {}) {
  return processTabs.some((process) => Boolean(order[process.key]));
}

function canEnterProcesses(order = {}) {
  return isBudgetConcluded(order);
}

function processEntryBlocked(order = {}) {
  return hasComplementaryProcess(order) && !canEnterProcesses(order);
}

function processConclusionBlockedMessage() {
  return "Esta ordem possui processos complementares pendentes e ainda não pode ser concluída.";
}

function shouldStayInProcesses(order = {}) {
  return hasComplementaryProcess(order) && canEnterProcesses(order) && hasPendingProcessConclusion(order);
}

function allowedCollaborators(stage) {
  return collaborators.filter((person) => person.stages.includes(stage));
}

function validCollaboratorForStage(name, stage) {
  const person = findCollaboratorByName(name);
  return person && person.stages?.includes(stage) ? person : null;
}

function plannedOwnerForStage(order, stage) {
  if (stage === "Criacao de CAD") return validCollaboratorForStage(order.cadist, "Criacao de CAD")?.name || "";
  if (stage === "Orcamento") return validCollaboratorForStage(order.budgeter, "Orcamento")?.name || "";
  return "";
}

function queueCollaborators(stage) {
  return allowedCollaborators(stage)
    .filter((person) => person.queueActive !== false)
    .sort((a, b) => Number(a.queueOrder?.[stage] || 999) - Number(b.queueOrder?.[stage] || 999));
}
function queueStageName(stage) {
  return distributionSection(stage || "");
}

function lastQueueOwner(stage) {
  const section = queueStageName(stage);
  const entry = distributionEntries.find((item) => item.stage === section && item.type === "Automatica" && item.owner);
  return entry?.owner || "";
}

function rotateQueueAfterLast(stage, candidates) {
  const lastOwner = lastQueueOwner(stage);
  const lastIndex = candidates.findIndex((person) => person.name === lastOwner);
  if (lastIndex < 0) return candidates;
  return [...candidates.slice(lastIndex + 1), ...candidates.slice(0, lastIndex + 1)];
}

function queueAttemptDetail(order, stage, person, available, reason = "") {
  return [
    `Etapa: ${stage}`,
    `Usuario: ${currentUser?.fullName || "Sistema"}`,
    `Colaborador verificado: ${person?.name || "-"}`,
    `Situacao: ${available ? "livre" : "ocupado"}`,
    reason ? `Motivo: ${reason}` : ""
  ].filter(Boolean).join(". ");
}


function isUnassignedOwner(owner) {
  const normalized = normalizeStatus(owner || "");
  return !owner || owner === unassignedOwner || normalized === "NAO TRATADO" || normalized === "SEM RESPONSAVEL";
}

function normalizeOwnerValue(owner) {
  return isUnassignedOwner(owner) ? unassignedOwner : owner;
}

function displayOwnerName(owner) {
  return isUnassignedOwner(owner) ? unassignedLabel : owner;
}

function defaultVoices() {
  return Object.fromEntries(voiceDefinitions.map((voice) => [voice.key, { code: "", poles: "", repeat: "1x", type: "" }]));
}

function normalizeVoices(order = {}) {
  const savedVoices = order.voices || {};
  return Object.fromEntries(voiceDefinitions.map((voice) => [
    voice.key,
    normalizeVoiceValue(savedVoices[voice.key] ?? order[voice.field] ?? "", voice)
  ]));
}

function normalizeVoiceValue(value, voice) {
  if (value && typeof value === "object") {
    return {
      code: value.code ?? "",
      poles: value.poles ?? "",
      repeat: value.repeat || "1x",
      type: value.type || ""
    };
  }
  return { code: String(value || ""), poles: "", repeat: "1x", type: "" };
}

function selectedProcessKeysFromForm() {
  return processTabs.filter((process) => fields[process.key]?.checked).map((process) => process.key);
}

function normalizeProcessDetails(order = {}) {
  const details = order.processDetails || {};
  return Object.fromEntries(processTabs.map((process) => {
    const saved = details[process.key] || {};
    const legacyOwner = process.key === processKeyForOrder(order) ? order.processOwner : order.processOwners?.[process.key];
    return [process.key, {
      owners: Array.isArray(saved.owners) ? saved.owners.join(", ") : String(saved.owners || legacyOwner || ""),
      endDate: saved.endDate || (process.key === processKeyForOrder(order) ? order.processEndDate : ""),
      notes: saved.notes || (process.key === processKeyForOrder(order) ? order.processNotes : ""),
      pendingDays: saved.pendingDays ?? ""
    }];
  }));
}

function renderProcessDetails(order = {}) {
  if (!elements.processDetailsContainer) return;
  const selected = selectedProcessKeysFromForm();
  const details = normalizeProcessDetails(order);
  elements.processDetailsContainer.classList.toggle("hidden", !selected.length);
  elements.processDetailsContainer.innerHTML = selected.map((processKey) => {
    const process = processTabs.find((item) => item.key === processKey);
    const value = details[processKey] || {};
    return `
      <article class="process-detail-card" data-process-detail="${processKey}">
        <h4>${escapeHtml(process?.label || "Processo")}</h4>
        <div class="form-grid">
          <label>Responsavel pelo processo<input data-process-field="owners" data-process-key="${processKey}" type="text" value="${escapeHtml(value.owners || "")}" placeholder="Nome(s) do responsavel"></label>
          <label>Data de conclusao<input data-process-field="endDate" data-process-key="${processKey}" type="date" value="${escapeHtml(value.endDate || "")}"></label>
          <label>Dias entre fechamento da obra e conclusao do processo<input data-process-field="pendingDays" data-process-key="${processKey}" type="number" step="any" value="${escapeHtml(value.pendingDays ?? "")}" placeholder="Importado de TIMER"></label>
          <label class="wide">Observacoes<textarea data-process-field="notes" data-process-key="${processKey}" rows="2">${escapeHtml(value.notes || "")}</textarea></label>
        </div>
      </article>
    `;
  }).join("");
}

function currentProcessDetails() {
  const details = {};
  selectedProcessKeysFromForm().forEach((processKey) => {
    details[processKey] = {
      owners: elements.processDetailsContainer?.querySelector(`[data-process-key="${processKey}"][data-process-field="owners"]`)?.value.trim() || "",
      endDate: elements.processDetailsContainer?.querySelector(`[data-process-key="${processKey}"][data-process-field="endDate"]`)?.value || "",
      pendingDays: elements.processDetailsContainer?.querySelector(`[data-process-key="${processKey}"][data-process-field="pendingDays"]`)?.value || "",
      notes: elements.processDetailsContainer?.querySelector(`[data-process-key="${processKey}"][data-process-field="notes"]`)?.value.trim() || ""
    };
  });
  return details;
}

function pendingProcessKeysByConclusion(order = {}) {
  const details = normalizeProcessDetails(order);
  return processTabs
    .filter((process) => order[process.key] && !details[process.key]?.endDate)
    .map((process) => process.key);
}

function pendingProcessLabelsByConclusion(order = {}) {
  return pendingProcessKeysByConclusion(order).map(processLabelFromKey);
}

function hasPendingProcessConclusion(order = {}) {
  return pendingProcessKeysByConclusion(order).length > 0;
}

function sendOrderToProcessUnassigned(order, existing = null, reason = "") {
  const updated = { ...order };
  if (!canEnterProcesses(updated)) {
    updated.processState = null;
    updated.processOwner = normalizeOwnerValue(updated.processOwner || unassignedOwner);
    updated.processStatus = updated.processStatus || "Aguardando";
    updated.updatedAt = new Date().toISOString();
    audit(
      "Envio para Processos bloqueado",
      updated.osNumber,
      `${existing?.stage || order.stage || "-"} / ${displayOwnerName(existing?.owner || order.owner)}`,
      existing?.stage || order.stage || "-",
      `${reason || processBlockedUntilBudgetMessage()} Processo complementar permanece salvo ate o STATUS ORCAMENTO ficar CONCLUIDO.`
    );
    return updated;
  }
  activateProcessState(updated, existing || order);
  updated.processOwner = unassignedOwner;
  updated.processStatus = "NAO TRATADO";
  updated.processStartDate = "";
  updated.owner = unassignedOwner;
  updated.stage = "Processos";
  if (updated.stage !== "Concluido") {
    updated.finishDate = "";
    updated.completedAt = "";
    updated.completedByOwner = "";
    updated.completedCadist = "";
    updated.completedFromStage = "";
  }
  updated.updatedAt = new Date().toISOString();
  audit(
    "Envio para Processos pendente",
    updated.osNumber,
    `${existing?.stage || order.stage || "-"} / ${displayOwnerName(existing?.owner || order.owner)}`,
    `Processos / ${unassignedLabel}`,
    `${reason || "Processo complementar sem data de conclusao."} Processos pendentes: ${pendingProcessLabelsByConclusion(updated).join(", ") || "-"}.`
  );
  return updated;
}

function updateVoiceVisibility() {
  Object.entries(processVoiceMap).forEach(([voiceKey, processKey]) => {
    const row = document.querySelector(`[data-voice-key="${voiceKey}"]`);
    if (row) row.classList.toggle("hidden", !fields[processKey]?.checked);
  });
}

function processPendingNotice(order) {
  const pending = processTabs.filter((process) => order[process.key] && !order.processDetails?.[process.key]?.endDate).map((process) => process.label);
  const missingVoices = requiredVoiceErrors(order).filter((label) => label !== "Voz do Projeto");
  if (!pending.length && !missingVoices.length && !order.processState?.active) return "";
  return "Processo pendente: " + [...pending, ...missingVoices.map((label) => label + " ausente"), ...(order.processState?.active ? ["processo ativo"] : [])].join(", ") + ". A obra pode ser concluida.";
}

function requiredVoiceErrors(order) {
  const voices = normalizeVoices(order);
  const errors = [];
  if (!voices.project?.code) errors.push("Voz do Projeto");
  Object.entries(processVoiceMap).forEach(([voiceKey, processKey]) => {
    if (order[processKey] && !voices[voiceKey]?.code) {
      const label = voiceDefinitions.find((voice) => voice.key === voiceKey)?.label || voiceKey;
      errors.push(label);
    }
  });
  return errors;
}

function blockConclusionIfMissingVoices(order) {
  const missing = normalizeVoices(order).project?.code ? [] : ["Voz do Projeto"];
  if (!missing.length) return false;
  const message = `Preencha as VOZES obrigatorias antes de concluir: ${missing.join(", ")}.`;
  audit("Conclusao bloqueada por falta de VOZ", order.osNumber, order.stage, "Concluido", message);
  alert(message);
  return true;
}

function voiceRangeIndex(polesValue) {
  const poles = Math.max(0, Number(polesValue || 0));
  if (poles >= 101) return 4;
  if (poles >= 34) return 3;
  if (poles >= 7) return 2;
  if (poles >= 4) return 1;
  return 0;
}

function voiceCodeFor(voice, polesValue, projectType = "") {
  const rangeIndex = voiceRangeIndex(polesValue);
  if (voice.project) {
    return projectVoiceCodes[projectType]?.[rangeIndex] || "";
  }
  const poles = Math.max(0, Number(polesValue || 0));
  if (poles >= 101) return "5000011712";
  if (poles >= 34) return "5000011711";
  if (poles >= 7) return "5000011710";
  if (poles >= 4) return "5000011709";
  return "5000011708";
}

function updateVoiceCodes() {
  voiceDefinitions.forEach((voice) => {
    const polesInput = fields[voice.polesField];
    const codeInput = fields[voice.field];
    if (!polesInput || !codeInput) return;
    const projectType = voice.typeField ? fields[voice.typeField]?.value || "" : "";
    if (voice.project && (!projectType || polesInput.value === "")) {
      codeInput.value = "";
      return;
    }
    if (!voice.project && polesInput.value === "") {
      codeInput.value = "";
      return;
    }
    codeInput.value = voiceCodeFor(voice, polesInput.value || 0, projectType);
  });
}

function limitedOrderEditFieldKeys() {
  return new Set(["clientName", ...voiceDefinitions.map((voice) => voice.polesField)]);
}

function applyLimitedOrderEditLocks() {
  const isExisting = Boolean(fields.orderId.value);
  const fullEdit = hasPermission("editOrder");
  const limitedEdit = isExisting && !fullEdit && hasPermission("limitedOrderEdit");
  if (!limitedEdit) return;
  const allowed = limitedOrderEditFieldKeys();
  Object.entries(fields).forEach(([key, input]) => {
    if (key === "orderId") return;
    input.disabled = !allowed.has(key);
  });
  elements.deleteOrderButton.hidden = true;
  elements.nextStageButton.hidden = true;
  elements.returnToCadButton.hidden = true;
  elements.returnToCadStageButton.hidden = true;
}

function mergeLimitedOrderEdit(existing, submitted) {
  const next = {
    ...existing,
    clientName: submitted.clientName,
    voices: normalizeVoices(existing),
    updatedAt: new Date().toISOString()
  };
  const submittedVoices = normalizeVoices(submitted);
  voiceDefinitions.forEach((voice) => {
    const previous = next.voices[voice.key] || { code: "", poles: "", repeat: "1x", type: "" };
    const poles = submittedVoices[voice.key]?.poles ?? "";
    next.voices[voice.key] = {
      ...previous,
      poles,
      code: poles !== "" ? voiceCodeFor(voice, poles, previous.type || "") : "",
      repeat: previous.repeat || "1x"
    };
  });
  return next;
}

function currentVoiceValues() {
  updateVoiceCodes();
  return Object.fromEntries(voiceDefinitions.map((voice) => {
    const processKey = processVoiceMap[voice.key];
    if (processKey && !fields[processKey]?.checked) {
      return [voice.key, { code: "", poles: "", repeat: "1x", type: "" }];
    }
    return [voice.key, {
      code: fields[voice.field]?.value?.trim() || "",
      poles: fields[voice.polesField]?.value || "",
      repeat: fields[voice.repeatField]?.value || "1x",
      type: voice.typeField ? fields[voice.typeField]?.value || "" : ""
    }];
  }));
}

function voiceSummary(order = {}) {
  const voices = normalizeVoices(order);
  return voiceDefinitions
    .map((voice) => {
      const value = voices[voice.key];
      const type = value.type ? `${value.type} - ` : "";
      return value.code ? `${voice.label}: ${type}${value.code}${value.poles !== "" ? ` (${value.poles} postes)` : ""} ${value.repeat || "1x"}` : "";
    })
    .filter(Boolean)
    .join(" | ");
}

function ownerFromOrderResponsibles(order) {
  if (order.stage === "Levantamento de Campo") return normalizeOwnerValue(order.fieldTech);
  if (order.stage === "Criacao de CAD") return normalizeOwnerValue(order.cadist);
  if (order.stage === "Orcamento") return normalizeOwnerValue(order.budgeter);
  return normalizeOwnerValue(order.owner);
}

function ownerFromResponsibleFields() {
  return ownerFromOrderResponsibles({
    stage: fields.stage.value,
    owner: fields.owner.value,
    fieldTech: fields.fieldTech.value,
    cadist: fields.cadist.value,
    budgeter: fields.budgeter.value
  });
}

function updateHiddenOwnerFromResponsibles() {
  fields.owner.value = ownerFromResponsibleFields();
}

function timerSectorFor(order) {
  if (order.pendencyState?.active || orderPendencies(order).length) return "Pendencias";
  if (order.processState?.active) return "Processos";
  if (order.stage === "Concluido") return "Concluido";
  return timerSectors.includes(order.stage) ? order.stage : order.stage || "Levantamento de Campo";
}

function timerOwnerFor(order) {
  const sector = timerSectorFor(order);
  if (sector === "Processos") return normalizeOwnerValue(order.processOwner);
  if (sector === "Pendencias") return normalizeOwnerValue(order.pendencyState?.openedByCollaborator || order.owner);
  return ownerFromOrderResponsibles(order);
}

function defaultTimeTracking(order = {}) {
  const now = new Date().toISOString();
  return {
    segments: [],
    current: {
      sector: timerSectorFor(order),
      owner: timerOwnerFor(order),
      startedAt: order.createdAt || order.updatedAt || now
    }
  };
}

function normalizeTimeTracking(order) {
  const tracking = order.timeTracking || defaultTimeTracking(order);
  return {
    segments: Array.isArray(tracking.segments) ? tracking.segments : [],
    current: tracking.current || defaultTimeTracking(order).current
  };
}

function syncOrderTimer(order, now = new Date().toISOString()) {
  const tracking = normalizeTimeTracking(order);
  const sector = timerSectorFor(order);
  const owner = timerOwnerFor(order);
  if (!tracking.current?.startedAt) tracking.current = { sector, owner, startedAt: order.createdAt || now };
  if (tracking.current.sector !== sector || normalizeOwnerValue(tracking.current.owner) !== normalizeOwnerValue(owner)) {
    tracking.segments.push({ ...tracking.current, endedAt: now });
    tracking.current = { sector, owner, startedAt: now };
  }
  order.timeTracking = tracking;
  return order;
}

function syncAllOrderTimers(now = new Date().toISOString()) {
  orders = orders.map((order) => syncOrderTimer(order, now));
}

function timerSegments(order, now = new Date().toISOString()) {
  const tracking = normalizeTimeTracking(order);
  const current = tracking.current ? [{ ...tracking.current, endedAt: now, active: true }] : [];
  return [...tracking.segments, ...current].filter((segment) => segment.startedAt);
}

function segmentDuration(segment) {
  const start = new Date(segment.startedAt).getTime();
  const end = new Date(segment.endedAt || new Date()).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function currentOrderTimerLabel(order) {
  if (!hasPermission("admin")) return "";
  const tracking = normalizeTimeTracking(order);
  const elapsed = segmentDuration({ ...tracking.current, endedAt: new Date().toISOString() });
  return `${tracking.current?.sector || "-"}: ${formatDuration(elapsed)}`;
}

function stageColumns(stage) {
  return [unassignedOwner, ...allowedCollaborators(stage).map((person) => person.name)];
}

function collaboratorProcesses(person) {
  return Array.isArray(person.processes) ? person.processes : processTabs.map((process) => process.key);
}

function processCollaborators(processKey) {
  return collaborators.filter((person) => collaboratorProcesses(person).includes(processKey));
}

function processColumns(processKey) {
  if (processKey === "processOnlyCompleted") return ["Concluido apenas processo"];
  return [unassignedOwner, ...processCollaborators(processKey).map((person) => person.name)];
}

function processColumnOwner(order, processKey) {
  if (processKey === "processOnlyCompleted") return "Concluido apenas processo";
  const details = normalizeProcessDetails(order);
  const owner = normalizeOwnerValue(order.processOwners?.[processKey] || details[processKey]?.owners || order.processOwner);
  if (isUnassignedOwner(owner)) return unassignedOwner;
  return collaborators.some((person) => person.name === owner) ? owner : unassignedOwner;
}

function isProcessOpenForTab(order, processKey) {
  if (processKey === "processOnlyCompleted") return Boolean(order.processOnlyCompleted);
  const status = normalizeStatus(order.processStatus);
  const detail = normalizeProcessDetails(order)[processKey] || {};
  if (["CONCLUIDO", "FINALIZADO"].includes(status) && detail.endDate) return false;
  return Boolean(order.processState?.active);
}

function boardOrders() {
  const search = elements.searchInput.value.trim().toLowerCase();
  const urgency = elements.urgencyFilter.value;

  return orders
    .filter((order) => order.stage === activeBoardTab)
    .filter((order) => !order.pendencyState?.active)
    .filter((order) => !order.processState?.active || order.stage === "Concluido")
    .filter((order) => urgency === "Todas" || deadlineInfo(order).key === urgency)
    .filter((order) => {
      const haystack = `${order.osNumber} ${order.clientName} ${order.city} ${order.owner} ${order.notes}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => deadlineInfo(b).rank - deadlineInfo(a).rank || daysSince(b.receivedDate) - daysSince(a.receivedDate));
}

function processOrders() {
  const search = elements.processSearchInput.value.trim().toLowerCase();
  const urgency = elements.processUrgencyFilter.value;
  const process = processTabs.find((item) => item.label === activeProcessTab) || processTabs[0];

  return orders
    .filter((order) => order[process.key])
    .filter((order) => isProcessOpenForTab(order, process.key))
    .filter((order) => !order.pendencyState?.active)
    .filter((order) => urgency === "Todas" || deadlineInfo(order).key === urgency)
    .filter((order) => {
      const haystack = `${order.osNumber} ${order.clientName} ${order.city} ${order.processOwner || ""} ${order.processStatus || ""} ${order.processType || ""} ${order.stage} ${order.notes} ${order.processNotes || ""}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => deadlineInfo(b).rank - deadlineInfo(a).rank || daysSince(b.receivedDate) - daysSince(a.receivedDate));
}

function orderAdequacyTypes(order) {
  const savedTypes = Array.isArray(order.adequacyTypes) ? order.adequacyTypes : [];
  const stateTypes = Array.isArray(order.adequacyState?.types) ? order.adequacyState.types : [];
  const fromFlags = processTabs.filter((process) => order[process.key]).map((process) => process.key);
  return [...new Set([...savedTypes, ...stateTypes, ...fromFlags])];
}

function isAdequacyOpen(order) {
  if (order.stage === "Adequacoes") return true;
  if (order.adequacyState?.active) return true;
  return normalizeStatus(order.processStatus) === "ADEQUACAO";
}

function adequacyOrders() {
  if (!elements.adequacySearchInput || !elements.adequacyUrgencyFilter) return [];
  const search = elements.adequacySearchInput.value.trim().toLowerCase();
  const urgency = elements.adequacyUrgencyFilter.value;
  const tab = adequacyTabs.find((item) => item.label === activeAdequacyTab) || adequacyTabs[0];

  return orders
    .filter((order) => isAdequacyOpen(order))
    .filter((order) => !order.pendencyState?.active)
    .filter((order) => {
      const types = orderAdequacyTypes(order);
      const hasKnownType = types.some((key) => key !== "unidentified");
      if (tab.key === "unidentified") return order.adequacyUnidentified || !hasKnownType;
      return types.includes(tab.key);
    })
    .filter((order) => urgency === "Todas" || deadlineInfo(order).key === urgency)
    .filter((order) => {
      const haystack = `${order.osNumber} ${order.clientName} ${order.city} ${order.processOwner || ""} ${order.processStatus || ""} ${order.processType || ""} ${order.stage} ${order.notes} ${order.processNotes || ""}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => deadlineInfo(b).rank - deadlineInfo(a).rank || daysSince(b.receivedDate) - daysSince(a.receivedDate));
}

function adequacyColumnOwner(order, processKey) {
  if (processKey === "unidentified") return unassignedOwner;
  const details = normalizeProcessDetails(order);
  const owner = order.adequacyOwners?.[processKey]
    || order.processOwners?.[processKey]
    || details[processKey]?.owners
    || order.processOwner
    || unassignedOwner;
  const person = findCollaboratorByName(owner);
  if (!person || !collaboratorProcesses(person).includes(processKey)) return unassignedOwner;
  return person.name;
}

function pendencyOrders() {
  const search = elements.pendencySearchInput.value.trim().toLowerCase();
  const type = elements.pendencyTypeFilter?.value || "Todas pendencias";
  return orders
    .filter((order) => orderPendencies(order).length && order.pendencyState?.active)
    .filter((order) => type === "Todas pendencias" || orderPendencies(order).includes(type))
    .filter((order) => {
      const haystack = `${order.osNumber} ${order.clientName} ${orderPendencies(order).join(" ")} ${order.pendencyState?.previousStage} ${order.pendencyState?.previousOwner}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => new Date(a.pendencyState?.openedAt || 0) - new Date(b.pendencyState?.openedAt || 0));
}

function showScreen(screen) {
  const screenPermissions = { dashboard: "dashboard", processes: "processes", adequacies: "processes", pendencies: "processes", admin: "adminData" };
  if (screenPermissions[screen] && !requirePermission(screenPermissions[screen])) return;
  if (screen === "admin" && !hasPermission("admin")) {
    showAdminTab("data");
  }
  activeScreen = screen;
  Object.entries(elements.screens).forEach(([key, node]) => node.classList.toggle("active", key === screen));
  elements.navItems.forEach((item) => item.classList.toggle("active", item.dataset.screen === screen));
  elements.screenTitle.textContent = {
    dashboard: "Dashboard",
    board: "Ordens",
    processes: "Processos",
    adequacies: "Adequacoes",
    pendencies: "Pendencias",
    account: "Minha Conta",
    admin: "Administrador"
  }[screen];
  render();
  if (
    screen === "admin" &&
    !elements.collaboratorId.value &&
    !elements.userFullName.value.trim() &&
    !elements.userLoginName.value.trim()
  ) {
    setNextQueueOrderDefaults();
  }
}

function editableElement(element) {
  return Boolean(
    element &&
    ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) &&
    element.type !== "file" &&
    !element.disabled &&
    !element.readOnly
  );
}

function activeElementSnapshot() {
  const active = document.activeElement;
  if (!editableElement(active)) return null;
  return {
    id: active.id || "",
    name: active.getAttribute("name") || "",
    tag: active.tagName,
    type: active.getAttribute("type") || "",
    value: active.value,
    selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null
  };
}

function selectorForScrollElement(element, index) {
  if (element === window || element === document.documentElement || element === document.body) return "__window__";
  if (element.id) return `#${CSS.escape(element.id)}`;
  return `[data-scroll-keeper="${index}"]`;
}

function captureScrollState() {
  const candidates = [
    document.documentElement,
    document.body,
    ...document.querySelectorAll("[id], .kanban-board, .process-grid, .pendency-list, .completed-list, .compact-order-list, .column-body, .kanban-column, .main-content, .app-main")
  ];
  return candidates
    .filter((element, index, list) => element && list.indexOf(element) === index)
    .filter((element) => element === document.documentElement || element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)
    .map((element, index) => {
      if (!element.id && element !== document.documentElement && !element.dataset.scrollKeeper) element.dataset.scrollKeeper = String(index);
      return {
        selector: selectorForScrollElement(element, element.dataset?.scrollKeeper || index),
        top: element === document.documentElement ? window.scrollY : element.scrollTop,
        left: element === document.documentElement ? window.scrollX : element.scrollLeft
      };
    });
}

function captureUiState() {
  return {
    active: activeElementSnapshot(),
    scrolls: captureScrollState()
  };
}

function restoreUiState(state) {
  if (!state) return;
  window.requestAnimationFrame(() => {
    state.scrolls?.forEach((item) => {
      if (item.selector === "__window__") {
        window.scrollTo(item.left, item.top);
        return;
      }
      const element = document.querySelector(item.selector);
      if (element) {
        element.scrollTop = item.top;
        element.scrollLeft = item.left;
      }
    });
    const active = state.active;
    if (!active?.id) return;
    const element = document.getElementById(active.id);
    if (!editableElement(element)) return;
    element.focus({ preventScroll: true });
    element.value = active.value;
    if (active.selectionStart !== null && typeof element.setSelectionRange === "function") {
      element.setSelectionRange(active.selectionStart, active.selectionEnd ?? active.selectionStart);
    }
  });
}

function setValueWithoutInterruptingInput(input, value) {
  if (!input) return;
  if (input.type === "file") {
    if (!value) input.value = "";
    return;
  }
  if (document.activeElement === input && editableElement(input)) return;
  input.value = value ?? "";
}

function render() {
  const uiState = captureUiState();
  syncAllOrderTimers();
  renderStageTabs();
  renderProcessTabs();
  renderAdequacyTabs();
  renderDashboard();
  renderBoard();
  renderProcesses();
  renderAdequacies();
  renderPendencies();
  renderAdmin();
  renderHistory();
  renderDistributionList();
  renderPresenceList();
  renderCurrentUserProductivity();
  renderAccountProfile();
  restoreUiState(uiState);
}

function collaboratorSectorLabel(person) {
  if (!person) return "-";
  const stagesText = person.stages?.length ? person.stages.join(" / ") : "";
  const processesText = collaboratorProcesses(person).length ? collaboratorProcesses(person).map((key) => processTabs.find((process) => process.key === key)?.label || key).join(" / ") : "";
  return [stagesText, processesText].filter(Boolean).join(" / ") || "-";
}

function renderProfileAvatar(target, user, size = "large") {
  if (!target) return;
  const photo = pendingProfilePhotoDataUrl === "__REMOVE__" ? "" : pendingProfilePhotoDataUrl || user?.profilePhoto || "";
  if (photo) {
    target.outerHTML = `<img class="profile-avatar ${size}" id="${target.id}" src="${escapeHtml(photo)}" alt="${escapeHtml(user?.fullName || "Usuario")}">`;
  } else {
    target.outerHTML = `<div class="profile-avatar ${size}" id="${target.id}">${escapeHtml(initialsForName(user?.fullName || "Usuario"))}</div>`;
  }
  if (target.id === "profilePhotoPreview") elements.profilePhotoPreview = document.querySelector("#profilePhotoPreview");
}

function renderAccountProfile() {
  if (!currentUser || !elements.profileForm) return;
  const freshUser = users.find((user) => user.id === currentUser.id) || currentUser;
  currentUser = { ...currentUser, ...freshUser };
  const person = currentCollaborator();
  const online = isUserOnline(currentUser);
  renderProfileAvatar(elements.profilePhotoPreview, currentUser, "large");
  setValueWithoutInterruptingInput(elements.profileFullName, currentUser.fullName || "");
  setValueWithoutInterruptingInput(elements.profileLogin, currentUser.login || "");
  setValueWithoutInterruptingInput(elements.profileRole, collaboratorSectorLabel(person));
  setValueWithoutInterruptingInput(elements.profileAccessLevel, `${roleName(currentUser.accessLevel)} - Nivel ${currentUser.accessLevel}`);
  setValueWithoutInterruptingInput(elements.profileOnlineStatus, online ? "Online" : "Offline");
  setValueWithoutInterruptingInput(elements.profileAvailability, currentUser.availabilityStatus || "Disponivel");
  setValueWithoutInterruptingInput(elements.profileStatusMessage, currentUser.statusMessage || "");
  updateCurrentUserSummary();
}

async function resizeProfileImage(file) {
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("Selecione um arquivo de imagem.");
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Nao foi possivel ler a imagem."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Nao foi possivel carregar a imagem."));
    img.src = dataUrl;
  });
  const size = 160;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const side = Math.min(image.width, image.height);
  const sx = (image.width - side) / 2;
  const sy = (image.height - side) / 2;
  context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function handleProfilePhotoChange(event) {
  try {
    pendingProfilePhotoDataUrl = await resizeProfileImage(event.target.files?.[0]);
    renderAccountProfile();
  } catch (error) {
    alert(error.message || "Nao foi possivel carregar a foto.");
  } finally {
    event.target.value = "";
  }
}

function removeProfilePhoto() {
  pendingProfilePhotoDataUrl = "__REMOVE__";
  renderAccountProfile();
}

function saveProfile(event) {
  event.preventDefault();
  if (!currentUser) return;
  const previousUser = users.find((user) => user.id === currentUser.id) || currentUser;
  const nextUser = {
    ...previousUser,
    availabilityStatus: elements.profileAvailability.value || "Disponivel",
    statusMessage: elements.profileStatusMessage.value.trim().slice(0, 50)
  };
  if (pendingProfilePhotoDataUrl === "__REMOVE__") nextUser.profilePhoto = "";
  else if (pendingProfilePhotoDataUrl) nextUser.profilePhoto = pendingProfilePhotoDataUrl;
  users = users.map((user) => user.id === nextUser.id ? nextUser : user);
  currentUser = nextUser;
  pendingProfilePhotoDataUrl = "";
  audit("Alteracao de perfil", "", previousUser.availabilityStatus || "", `${nextUser.availabilityStatus}${nextUser.statusMessage ? ` - ${nextUser.statusMessage}` : ""}`, "Usuario alterou foto/status do proprio perfil.");
  persist();
  render();
  if (elements.profileStatus) {
    elements.profileStatus.textContent = "Perfil salvo com sucesso.";
    elements.profileStatus.className = "import-status success";
  }
}

async function changeOwnPassword(event) {
  event.preventDefault();
  const currentPassword = elements.currentPassword.value;
  const newPassword = elements.newPassword.value;
  const confirmPassword = elements.confirmPassword.value;
  if (newPassword !== confirmPassword) {
    elements.passwordStatus.textContent = "A confirmacao da senha nao confere.";
    elements.passwordStatus.className = "import-status error";
    return;
  }
  try {
    const result = await apiRequest("/api/profile/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    });
    if (result.user) {
      users = users.map((user) => user.id === result.user.id ? { ...user, ...result.user } : user);
      currentUser = { ...currentUser, ...result.user };
    }
    audit("Alteracao de senha", "", "", "Senha alterada pelo proprio usuario.", "Senha nao registrada por seguranca.");
    elements.passwordForm.reset();
    elements.passwordStatus.textContent = "Senha alterada com sucesso.";
    elements.passwordStatus.className = "import-status success";
    persist();
  } catch (error) {
    elements.passwordStatus.textContent = error.message || "Nao foi possivel alterar a senha.";
    elements.passwordStatus.className = "import-status error";
  }
}


function normalizeDistributionEntries(items) {
  return (Array.isArray(items) ? items : [])
    .filter((entry) => entry && entry.id)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, 50);
}

function mergeDistributionEntries(incoming, existing = distributionEntries) {
  const merged = new Map();
  [...normalizeDistributionEntries(incoming), ...normalizeDistributionEntries(existing)]
    .forEach((entry) => merged.set(entry.id, entry));
  return normalizeDistributionEntries([...merged.values()]);
}

function distributionEntriesSignature(items = distributionEntries) {
  return normalizeDistributionEntries(items).map((entry) => `${entry.id}:${entry.date || ""}`).join("|");
}

function distributionSection(stage) {
  if (stage === "Criacao de CAD") return "Criacao de CAD";
  if (stage === "Orcamento") return "Orcamento";
  if (stage === "Levantamento de Campo") return "Levantamento de Campo";
  if (stage === "Pendencias") return "Pendencias";
  return stage || "Sem secao";
}

function shouldTrackDistribution(stage, owner) {
  return Boolean(owner && owner !== "Sem Responsavel" && ["Criacao de CAD", "Orcamento", "Pendencias"].includes(stage));
}

function registerDistribution(order, owner, stage, type) {
  if (!order || !shouldTrackDistribution(stage || order.stage, owner)) return null;
  const entry = {
    id: newId(),
    orderId: order.id,
    osNumber: order.osNumber || "Sem numero",
    owner,
    stage: distributionSection(stage || order.stage),
    type: type || "Manual",
    date: new Date().toISOString(),
    actor: currentUser?.fullName || "Sistema"
  };
  distributionEntries = normalizeDistributionEntries([entry, ...distributionEntries]);
  lastSeenDistributionId = entry.id;
  localStorage.setItem(storeKeys.distributions, JSON.stringify(distributionEntries));
  markLatestDistribution(entry);
  showDistributionToast(entry);
  return entry;
}

function markLatestDistribution(entry) {
  if (!entry) return;
  newDistributionMarker = { id: entry.id, owner: entry.owner, stage: entry.stage, until: Date.now() + 9000 };
  window.setTimeout(() => {
    if (newDistributionMarker?.id === entry.id) {
      newDistributionMarker = null;
      renderBoard();
      renderProcesses();
    }
  }, 9200);
}

function isNewDistributionColumn(title, stage) {
  return Boolean(newDistributionMarker
    && Date.now() < newDistributionMarker.until
    && newDistributionMarker.owner === title
    && newDistributionMarker.stage === distributionSection(stage));
}

function clearDistributionMarker(title, stage) {
  if (!isNewDistributionColumn(title, stage)) return;
  newDistributionMarker = null;
  renderBoard();
  renderProcesses();
}

function renderDistributionList() {
  if (!elements.distributionList) return;
  const signature = distributionEntriesSignature();
  if (elements.distributionList.dataset.signature === signature) return;
  elements.distributionList.dataset.signature = signature;
  elements.distributionList.innerHTML = distributionEntries.length
    ? distributionEntries.slice(0, 8).map((entry) => {
      const date = new Date(entry.date);
      const dateText = Number.isNaN(date.getTime()) ? "Agora" : `${date.toLocaleDateString("pt-BR")} as ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
      return `
        <article class="distribution-item">
          <strong>OS ${escapeHtml(entry.osNumber)} <span>-></span> ${escapeHtml(entry.owner)}</strong>
          <small>Secao: ${escapeHtml(entry.stage)}</small>
          <small>Distribuida em: ${escapeHtml(dateText)}</small>
          <em>${escapeHtml(entry.type)}</em>
        </article>
      `;
    }).join("")
    : `<small class="distribution-empty">Nenhuma distribuicao ainda.</small>`;
}

function toggleDistributionPanel() {
  const expanded = elements.appShell.classList.toggle("distribution-expanded");
  if (!elements.distributionToggleButton) return;
  elements.distributionToggleButton.textContent = expanded ? "Minimizar" : "Maximizar";
  elements.distributionToggleButton.setAttribute("aria-expanded", String(expanded));
}

function showDistributionToast(entry) {
  if (!entry || !currentUser) return;
  let stack = document.querySelector("#distributionToastStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "distributionToastStack";
    stack.className = "distribution-toast-stack";
    document.body.appendChild(stack);
  }
  const date = new Date(entry.date);
  const timeText = Number.isNaN(date.getTime()) ? "agora" : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const toast = document.createElement("article");
  toast.className = "distribution-toast";
  toast.innerHTML = `
    <strong>Nova ordem distribuida</strong>
    <span>OS ${escapeHtml(entry.osNumber)} foi enviada para ${escapeHtml(entry.owner)} na secao ${escapeHtml(entry.stage)}.</span>
    <small>${escapeHtml(timeText)}</small>
  `;
  stack.prepend(toast);
  window.setTimeout(() => toast.remove(), 6500);
}

function startDistributionPolling() {
  stopDistributionPolling();
  distributionPollTimer = window.setInterval(checkDistributionUpdates, 5000);
  window.setTimeout(checkDistributionUpdates, 250);
}

function stopDistributionPolling() {
  if (distributionPollTimer) window.clearInterval(distributionPollTimer);
  distributionPollTimer = null;
}

function updateLiveTimers() {
  if (!hasPermission("admin")) return;
  document.querySelectorAll("[data-order-timer]").forEach((element) => {
    const order = orders.find((item) => item.id === element.dataset.orderTimer);
    if (order) element.textContent = currentOrderTimerLabel(order);
  });
  if (activeScreen === "dashboard") renderTimeDashboard(dashboardOrders());
}

function startOrderTimerUpdates() {
  stopOrderTimerUpdates();
  orderTimerInterval = window.setInterval(updateLiveTimers, 1000);
}

function stopOrderTimerUpdates() {
  if (orderTimerInterval) window.clearInterval(orderTimerInterval);
  orderTimerInterval = null;
}

async function checkDistributionUpdates() {
  if(desktopRecovery) return;
  if (!currentUser || statePollInFlight || hasLocalSavePending()) return;
  statePollInFlight = true;
  try {
    const version = await apiRequest("/api/state-version", { timeoutMs: 6000 });
    if (version.updatedAt && version.updatedAt === lastKnownStateUpdatedAt) {
      return;
    }
    const state = await apiRequest("/api/state");
    if(hasLocalSavePending()) return;
    lastKnownStateUpdatedAt = state.updatedAt || version.updatedAt || lastKnownStateUpdatedAt;
    const incoming = normalizeDistributionEntries(state.distributionEntries || []);
    const merged = mergeDistributionEntries(incoming);
    const latest = incoming[0];
    orders = Array.isArray(state.orders) ? mergeProtectedOrders(state.orders) : orders;
    collaborators = normalizeCollaborators(Array.isArray(state.collaborators) ? state.collaborators : collaborators);
    historyEntries = Array.isArray(state.historyEntries) ? state.historyEntries : historyEntries;
    users = Array.isArray(state.users) ? state.users : users;
    presenceByUserId = state.presence || presenceByUserId;
    currentUser = currentSession() || currentUser;
    desktopBase=structuredClone(stateSnapshot());
    if (latest && latest.id !== lastSeenDistributionId) {
      distributionEntries = merged;
      lastSeenDistributionId = latest.id;
      localStorage.setItem(storeKeys.distributions, JSON.stringify(distributionEntries));
      markLatestDistribution(latest);
      showDistributionToast(latest);
      render();
    } else if (distributionEntriesSignature(merged) !== distributionEntriesSignature()) {
      distributionEntries = merged;
      localStorage.setItem(storeKeys.distributions, JSON.stringify(distributionEntries));
      render();
    } else {
      render();
    }
  } catch (error) {
    console.warn("Falha ao verificar distribuicoes", error);
  } finally {
    statePollInFlight = false;
  }
}
function renderStageTabs() {
  elements.stageTabs.innerHTML = "";
  stages.forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab-button ${activeBoardTab === tab ? "active" : ""}`;
    button.textContent = tab;
    button.addEventListener("click", () => {
      activeBoardTab = tab;
      renderBoard();
      renderStageTabs();
    });
    elements.stageTabs.appendChild(button);
  });
  updateFieldUpdateImportVisibility();
}

function renderProcessTabs() {
  elements.processTabs.innerHTML = "";
  processTabs.forEach((process) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab-button ${activeProcessTab === process.label ? "active" : ""}`;
    button.textContent = process.label;
    button.addEventListener("click", () => {
      activeProcessTab = process.label;
      renderProcesses();
      renderProcessTabs();
    });
    elements.processTabs.appendChild(button);
  });
}

function renderAdequacyTabs() {
  if (!elements.adequacyTabs) return;
  elements.adequacyTabs.innerHTML = "";
  adequacyTabs.forEach((process) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab-button ${activeAdequacyTab === process.label ? "active" : ""}`;
    button.textContent = process.label;
    button.addEventListener("click", () => {
      activeAdequacyTab = process.label;
      renderAdequacies();
      renderAdequacyTabs();
    });
    elements.adequacyTabs.appendChild(button);
  });
}

function dashboardDateRange() {
  const preset = elements.dashboardPeriodPreset?.value || "month";
  const now = new Date();
  const iso = (date) => date.toISOString().slice(0, 10);
  const normalizedRange = (start, end) => start && end && start > end ? { start: end, end: start } : { start, end };
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const ranges = {
    today: [iso(now), iso(now)],
    yesterday: [iso(yesterday), iso(yesterday)],
    week: [iso(startOfWeek), iso(now)],
    month: [iso(startOfMonth), iso(now)]
  };
  if (preset !== "custom" && ranges[preset]) {
    if (elements.dashboardStartDate) elements.dashboardStartDate.value = ranges[preset][0];
    if (elements.dashboardEndDate) elements.dashboardEndDate.value = ranges[preset][1];
    return normalizedRange(ranges[preset][0], ranges[preset][1]);
  }
  return normalizedRange(elements.dashboardStartDate?.value || "", elements.dashboardEndDate?.value || "");
}

function isDashboardActiveOrder(order) {
  return !["Concluido", "Cancelada", "Suspensa"].includes(order.stage);
}

function sectorStatus(order, sector) {
  if (sector === "Criacao de CAD") return normalizeStatus(order.cadStatus || order.statusImport?.cadStatus || "");
  if (sector === "Orcamento") return normalizeStatus(order.budgetStatus || order.statusImport?.budgetStatus || "");
  return normalizeStatus(stageStatus(order));
}

function sectorOwner(order, sector) {
  if (sector === "Criacao de CAD") return order.cadist || completedOwner(order);
  if (sector === "Orcamento") return order.budgeter || completedOwner(order);
  return completedOwner(order);
}

function sectorCompletionDate(order, sector) {
  if (sector === "Criacao de CAD") return order.statusImport?.cadDate || completionDate(order) || order.receivedDate;
  if (sector === "Orcamento") return order.statusImport?.budgetDate || completionDate(order) || order.receivedDate;
  return completionDate(order) || order.statusImport?.finalDate || order.receivedDate;
}

function sectorCompletedInDashboardPeriod(order, sector) {
  const status = sectorStatus(order, sector);
  if (status !== "CONCLUIDO" && !(order.stage === "Concluido" && completedStage(order) === sector)) return false;
  const period = dashboardDateRange();
  return isDateInRange(sectorCompletionDate(order, sector), period.start, period.end);
}

function completedInDashboardPeriod(order, sector = "") {
  if (sector) return sectorCompletedInDashboardPeriod(order, sector);
  if (order.stage !== "Concluido") return false;
  const period = dashboardDateRange();
  return isDateInRange(completionDate(order) || order.statusImport?.finalDate || order.receivedDate, period.start, period.end);
}

function progressWidth(value, max) {
  return Math.max(0, Math.min(100, max ? (Number(value) / max) * 100 : 0)).toFixed(1);
}

function dashboardProgressItem(label, value, max, meta = "", className = "report-item") {
  const width = progressWidth(value, max);
  return `<div class="${className} dashboard-progress">
    <div class="progress-head"><strong>${escapeHtml(label)}</strong><span>${value}</span></div>
    ${meta ? `<div class="os-meta">${meta}</div>` : ""}
    <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
  </div>`;
}

function timeSectorLabel(sector) {
  if (sector === "Criacao de CAD") return "CAD";
  if (sector === "Orcamento") return "Orcamento";
  if (sector === "Levantamento de Campo") return "Campo";
  if (sector === "Processos") return "Processos";
  if (sector === "Pendencias") return "Pendencias";
  return sector || "Setor";
}

function segmentInDashboardPeriod(segment, period = dashboardDateRange()) {
  const start = dateOnly(segment.startedAt);
  const end = dateOnly(segment.endedAt || new Date().toISOString());
  return Boolean(start && (!period.start || end >= period.start) && (!period.end || start <= period.end));
}

function collaboratorTimeStats(name, visible, preferredSector = "") {
  const period = dashboardDateRange();
  const segments = visible.flatMap((order) => timerSegments(order))
    .filter((segment) => displayOwnerName(segment.owner) === name && segmentInDashboardPeriod(segment, period))
    .map((segment) => ({ ...segment, duration: segmentDuration(segment) }))
    .filter((segment) => segment.duration > 0);
  const sectorGroups = uniqueValues(segments.map((segment) => segment.sector)).map((sector) => {
    const sectorSegments = segments.filter((segment) => segment.sector === sector);
    return { sector, label: timeSectorLabel(sector), average: average(sectorSegments.map((segment) => segment.duration)), count: sectorSegments.length };
  }).filter((item) => item.average > 0);
  const preferred = sectorGroups.find((item) => item.sector === preferredSector);
  const ordered = [
    ...(preferred ? [preferred] : []),
    ...sectorGroups.filter((item) => item.sector !== preferredSector)
  ];
  return {
    totalAverage: average(segments.map((segment) => segment.duration)),
    sectors: ordered
  };
}

function collaboratorTimeHtml(name, visible, preferredSector = "") {
  if (!hasPermission("admin")) return "";
  const stats = collaboratorTimeStats(name, visible, preferredSector);
  if (!stats.totalAverage) return "";
  return `
    <div class="productivity-time">
      <span>Tempo medio total <strong>${escapeHtml(formatDuration(stats.totalAverage))}</strong></span>
      ${stats.sectors.map((item) => `<span>Tempo medio ${escapeHtml(item.label)} <strong>${escapeHtml(formatDuration(item.average))}</strong></span>`).join("")}
    </div>`;
}
function rankingForSector(visible, title, sector) {
  const rows = allowedCollaborators(sector).map((person) => ({
    name: person.name,
    total: visible.filter((order) => sectorCompletedInDashboardPeriod(order, sector) && sectorOwner(order, sector) === person.name).length
  })).filter((item) => item.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const max = Math.max(1, ...rows.map((item) => item.total));
  return `<section class="dashboard-subsection"><h3>${escapeHtml(title)}</h3>${rows.map((item, index) => dashboardProgressItem(`${index + 1}. ${item.name}`, item.total, max, `<span>Concluidas: ${item.total}</span>`, "ranking-item")).join("") || `<div class="ranking-item">Sem conclusoes no periodo.</div>`}</section>`;
}

function processRankingFor(visible, process) {
  const rows = processCollaborators(process.key).map((person) => ({
    name: person.name,
    total: visible.filter((order) => order[process.key] && completedInDashboardPeriod(order) && (order.processOwners?.[process.key] === person.name || order.processOwner === person.name || completedOwner(order) === person.name)).length
  })).filter((item) => item.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const max = Math.max(1, ...rows.map((item) => item.total));
  return `<section class="dashboard-subsection"><h3>${escapeHtml(process.label)}</h3>${rows.map((item, index) => dashboardProgressItem(`${index + 1}. ${item.name}`, item.total, max, `<span>Processos concluidos: ${item.total}</span>`, "ranking-item")).join("") || `<div class="ranking-item">Sem processos concluidos no periodo.</div>`}</section>`;
}

function productivityForSector(visible, title, sector, ownerField) {
  const sectorCollaborators = allowedCollaborators(sector);
  const rows = sectorCollaborators.map((person) => {
    const sectorOrders = visible.filter((order) => order[ownerField] === person.name || order.owner === person.name || sectorOwner(order, sector) === person.name);
    const inProgress = sectorOrders.filter((order) => order.stage === sector && isDashboardActiveOrder(order) && sectorStatus(order, sector) !== "CONCLUIDO").length;
    const completed = visible.filter((order) => sectorCompletedInDashboardPeriod(order, sector) && sectorOwner(order, sector) === person.name).length;
    const rejected = sectorOrders.filter((order) => order.stage === "Rejeitado").length;
    const pending = sectorOrders.filter((order) => orderPendencies(order).length || order.pendencyState?.active).length;
    const timeHtml = collaboratorTimeHtml(person.name, visible, sector);
    return { name: person.name, inProgress, completed, rejected, pending, total: inProgress + completed + rejected + pending, timeHtml };
  }).filter((item) => item.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return `<section class="dashboard-subsection"><h3>${escapeHtml(title)}</h3>${rows.map((item) => `<article class="productivity-card"><header><strong>${escapeHtml(item.name)}</strong><span>Total ${item.total}</span></header><div class="productivity-stats"><span>Andamento <strong>${item.inProgress}</strong></span><span>Concluidas <strong>${item.completed}</strong></span><span>Rejeitadas <strong>${item.rejected}</strong></span><span>Pendencias <strong>${item.pending}</strong></span></div>${item.timeHtml}</article>`).join("") || `<div class="report-item">Sem dados no periodo.</div>`}</section>`;
}

function processProductivityFor(visible, process) {
  const rows = processCollaborators(process.key).map((person) => {
    const processOrders = visible.filter((order) => order[process.key] && (order.processOwners?.[process.key] === person.name || order.processOwner === person.name || completedOwner(order) === person.name));
    const inProgress = processOrders.filter((order) => isDashboardActiveOrder(order)).length;
    const completed = processOrders.filter((order) => completedInDashboardPeriod(order) && completedOwner(order) === person.name).length;
    const pending = processOrders.filter((order) => orderPendencies(order).length || order.pendencyState?.active).length;
    const timeHtml = collaboratorTimeHtml(person.name, visible, "Processos");
    return { name: person.name, inProgress, completed, pending, total: inProgress + completed + pending, timeHtml };
  }).filter((item) => item.total > 0).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return `<section class="dashboard-subsection"><h3>${escapeHtml(process.label)}</h3>${rows.map((item) => `<article class="productivity-card"><header><strong>${escapeHtml(item.name)}</strong><span>Total ${item.total}</span></header><div class="productivity-stats"><span>Andamento <strong>${item.inProgress}</strong></span><span>Concluidos <strong>${item.completed}</strong></span><span>Pendencias <strong>${item.pending}</strong></span></div>${item.timeHtml}</article>`).join("") || `<div class="report-item">Sem dados no periodo.</div>`}</section>`;
}

function renderDashboard() {
  renderDashboardFilters();
  const visible = dashboardOrders();
  const activeVisible = visible.filter(isDashboardActiveOrder);
  const activeDeadline = activeVisible.filter((order) => isActiveForDeadline(order));
  const inside = activeDeadline.filter((order) => deadlineInfo(order).key === "Dentro").length;
  const ans = activeDeadline.filter((order) => deadlineInfo(order).key === "ANS").length;
  const metricMax = Math.max(1, activeVisible.length, inside, ans);
  elements.dashboardMetrics.innerHTML = [
    ["OS ativas", activeVisible.length],
    ["Dentro do prazo", inside],
    ["Fora ANS", ans]
  ].map(([label, value]) => `<article class="metric-card dashboard-progress"><span>${label}</span><strong>${value}</strong><div class="bar-track"><div class="bar-fill" style="width:${progressWidth(value, metricMax)}%"></div></div></article>`).join("");
  const stageRows = stages.map((stage) => ({ label: stage, total: visible.filter((order) => order.stage === stage).length }));
  const maxStage = Math.max(1, ...stageRows.map((item) => item.total));
  elements.stageBars.innerHTML = stageRows.map((item) => dashboardProgressItem(item.label, item.total, maxStage, "", "bar-item")).join("");



  const mainProcesses = processTabs.filter((process) => ["processParalelismo", "processAmbiental"].includes(process.key));
  elements.rankingList.innerHTML = [
    rankingForSector(visible, "Ranking CAD", "Criacao de CAD"),
    rankingForSector(visible, "Ranking Orcamento", "Orcamento"),
    `<section class="dashboard-subsection"><h3>Ranking Processos</h3>${mainProcesses.map((process) => processRankingFor(visible, process)).join("")}</section>`
  ].join("");

  elements.productivityChart.innerHTML = [
    productivityForSector(visible, "Produtividade CAD", "Criacao de CAD", "cadist"),
    productivityForSector(visible, "Produtividade Orcamento", "Orcamento", "budgeter"),
    `<section class="dashboard-subsection"><h3>Produtividade Processos</h3>${mainProcesses.map((process) => processProductivityFor(visible, process)).join("")}</section>`
  ].join("");

  renderDashboardProcesses(visible);
  renderDashboardPendencies(visible);
  renderDashboardRegionals(activeVisible);
  renderTimeDashboard(visible);
}

function average(values) {
  const clean = values.filter((value) => value > 0);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function timeStatsForOrders(list) {
  const now = new Date().toISOString();
  const segments = list.flatMap((order) => timerSegments(order, now).map((segment) => ({ ...segment, order })));
  const bySector = timerSectors.map((sector) => {
    const sectorSegments = segments.filter((segment) => segment.sector === sector);
    return { label: sector, value: average(sectorSegments.map(segmentDuration)), total: sectorSegments.reduce((sum, segment) => sum + segmentDuration(segment), 0), count: sectorSegments.length };
  });
  const collaboratorsList = uniqueValues(segments.map((segment) => displayOwnerName(segment.owner)).filter((name) => name && name !== unassignedLabel));
  const byCollaborator = collaboratorsList.map((name) => {
    const ownerSegments = segments.filter((segment) => displayOwnerName(segment.owner) === name);
    return { label: name, value: average(ownerSegments.map(segmentDuration)), total: ownerSegments.reduce((sum, segment) => sum + segmentDuration(segment), 0), count: ownerSegments.length };
  }).sort((a, b) => b.value - a.value);
  const bySectorOwner = timerSectors.flatMap((sector) => collaboratorsList.map((name) => {
    const scoped = segments.filter((segment) => segment.sector === sector && displayOwnerName(segment.owner) === name);
    return { label: `${sector} / ${name}`, value: average(scoped.map(segmentDuration)), count: scoped.length };
  })).filter((item) => item.count > 0).sort((a, b) => b.value - a.value);
  const ordered = segments.map((segment) => ({ ...segment, value: segmentDuration(segment) })).filter((segment) => segment.value > 0).sort((a, b) => b.value - a.value);
  return { bySector, byCollaborator, bySectorOwner, longest: ordered[0], shortest: ordered[ordered.length - 1] };
}

function timeStatList(title, rows, limit = 6) {
  const visibleRows = rows.filter((row) => row.value > 0).slice(0, limit);
  const max = Math.max(1, ...visibleRows.map((row) => row.value));
  return `<section class="dashboard-subsection"><h3>${escapeHtml(title)}</h3>${visibleRows.map((row, index) => `
    <div class="ranking-item dashboard-progress">
      <div class="progress-head"><strong>${escapeHtml(`${index + 1}. ${row.label}`)}</strong><span>${escapeHtml(formatDuration(row.value))}</span></div>
      <div class="os-meta"><span>${row.count || 0} registro(s)</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${progressWidth(row.value, max)}%"></div></div>
    </div>
  `).join("") || `<div class="ranking-item">Sem tempo registrado.</div>`}</section>`;
}

function renderTimeDashboard(visible) {
  if (!elements.timeDashboardSection || !elements.timeDashboard) return;
  const canSee = hasPermission("admin");
  elements.timeDashboardSection.hidden = !canSee;
  if (!canSee) {
    elements.timeDashboard.innerHTML = "";
    return;
  }
  const stats = timeStatsForOrders(visible);
  elements.timeDashboard.innerHTML = `
    <div class="time-dashboard-grid">
      ${timeStatList("Tempo medio por setor", stats.bySector)}
      ${timeStatList("Tempo medio por colaborador", stats.byCollaborator)}
      ${timeStatList("Setor e colaborador", stats.bySectorOwner)}
      <section class="dashboard-subsection">
        <h3>Extremos</h3>
        <div class="report-item"><span>Maior tempo parado</span><strong>${stats.longest ? `${escapeHtml(stats.longest.order.osNumber || "OS")} - ${formatDuration(stats.longest.value)}` : "Sem dados"}</strong></div>
        <div class="report-item"><span>Menor tempo de execucao</span><strong>${stats.shortest ? `${escapeHtml(stats.shortest.order.osNumber || "OS")} - ${formatDuration(stats.shortest.value)}` : "Sem dados"}</strong></div>
      </section>
    </div>`;
}

function emptyProductivityItem(name = "Conta") {
  return {
    name,
    doneToday: 0,
    donePeriod: 0,
    doneTotal: 0,
    rejected: 0,
    pending: 0,
    processes: 0,
    inProgress: 0,
    completedStages: [],
    currentStages: [],
    openOrders: []
  };
}

function currentUserProductivityItem() {
  const collaborator = currentCollaborator();
  const displayName = collaborator?.name || currentUser?.fullName || "Conta";
  if (!collaborator) return emptyProductivityItem(displayName);
  return collaboratorProductivity(orders).find((item) => item.name === collaborator.name) || emptyProductivityItem(displayName);
}

function renderCurrentUserProductivity() {
  if (!elements.currentUserProductivity) return;
  const item = currentUserProductivityItem();
  if (!currentUser) {
    elements.currentUserProductivity.innerHTML = `<small>Produtividade da conta</small>`;
    return;
  }
  elements.currentUserProductivity.innerHTML = `
    <small>Produtividade da conta</small>
    <div class="account-stats">
      <span>Hoje <strong>${item.doneToday}</strong></span>
      <span>Periodo <strong>${item.donePeriod}</strong></span>
      <span>Andamento <strong>${item.inProgress}</strong></span>
      <span>Pendencias <strong>${item.pending}</strong></span>
    </div>
    <div class="account-open-orders">
      ${item.currentStages.map((row) => `<em>${escapeHtml(row.stage)}: ${row.total}</em>`).join("") || "<em>Sem ordens ativas.</em>"}
    </div>
  `;
}
function renderDashboardFilters() {
  keepSelect(elements.dashboardStageFilter, ["Todas as etapas", ...stages]);
  keepSelect(elements.dashboardCollaboratorFilter, ["Todos colaboradores", ...collaborators.map((person) => person.name)]);
  keepSelect(elements.dashboardRegionalFilter, ["Todas regionais", ...uniqueValues(orders.map((order) => order.regional || "Sem regional"))]);
  keepSelect(elements.dashboardProcessFilter, ["Todos processos", ...processTabs.map((item) => item.label)]);
  keepSelect(elements.dashboardPendencyFilter, ["Todas pendencias", ...pendencyOptions]);
}

function keepSelect(select, options) {
  const current = select.value;
  select.innerHTML = options.map((option) => `<option ${option === current ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function dashboardOrders() {
  const stage = elements.dashboardStageFilter.value;
  const collaborator = elements.dashboardCollaboratorFilter.value;
  const regional = elements.dashboardRegionalFilter.value;
  const deadline = elements.dashboardDeadlineFilter.value;
  const process = processTabs.find((item) => item.label === elements.dashboardProcessFilter.value);
  const pendency = elements.dashboardPendencyFilter.value;
  const period = dashboardDateRange();
  return orders.filter((order) => {
    return isDashboardOrderInPeriod(order, period)
      && (!stage || stage === "Todas as etapas" || order.stage === stage)
      && (!collaborator || collaborator === "Todos colaboradores" || order.owner === collaborator)
      && (!regional || regional === "Todas regionais" || (order.regional || "Sem regional") === regional)
      && (!deadline || deadline === "Todos" || deadlineInfo(order).key === deadline)
      && (!process || order[process.key])
      && (!pendency || pendency === "Todas pendencias" || orderPendencies(order).includes(pendency));
  });
}

function isActiveForDeadline(order) {
  const status = normalizeStatus(stageStatus(order));
  return !["Concluido", "Rejeitado", "Cancelada", "Suspensa"].includes(order.stage) && !["CONCLUIDO", "REJEITADO", "CANCELADO", "CANCELADA", "SUSPENSO", "SUSPENSA"].includes(status);
}

function hasAnyProcess(order) {
  return processTabs.some((process) => order[process.key]);
}

function dashboardPeriod() {
  return {
    start: elements.accountStartDate?.value || "",
    end: elements.accountEndDate?.value || ""
  };
}

function dateOnly(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function isDateInRange(value, start, end) {
  const date = dateOnly(value);
  return Boolean(date && (!start || date >= start) && (!end || date <= end));
}

function dashboardDateCandidates(order) {
  return [
    order.receivedDate,
    order.statusImport?.receivedDate,
    order.statusImport?.fieldDate,
    order.statusImport?.cadDate,
    order.statusImport?.budgetDate,
    order.statusImport?.finalDate,
    order.statusImport?.revisionDoneDate,
    order.statusImport?.ambientalDoneDate,
    order.statusImport?.travessiaDoneDate,
    order.fieldDate,
    order.cadDate,
    order.budgetDate,
    order.finishDate,
    order.completedAt,
    order.rejectedAt,
    order.rejectionResolvedAt,
    order.pendencyState?.openedAt,
    order.pendencyState?.resolvedAt,
    order.processState?.openedAt,
    order.processEndDate,
    order.createdAt
  ].map(dateOnly).filter(Boolean);
}

function isDashboardOrderInPeriod(order, period) {
  if (!period?.start && !period?.end) return true;
  return dashboardDateCandidates(order).some((date) => isDateInRange(date, period.start, period.end));
}

function orderCollaboratorNames(order) {
  return new Set([order.owner, order.fieldTech, order.cadist, order.budgeter, order.completedByOwner, order.rejectedByOwner, order.pendencyState?.openedByCollaborator]
    .filter((name) => name && name !== "Sem Responsavel"));
}

function orderBelongsToCollaborator(order, name) {
  return orderCollaboratorNames(order).has(name);
}

function completedOwner(order) {
  return order.completedByOwner || (order.owner !== "Sem Responsavel" ? order.owner : "") || order.budgeter || order.cadist || order.fieldTech || "";
}

function completionDate(order) {
  return order.completedAt || order.finishDate || "";
}

function completedStage(order) {
  return order.completedFromStage || order.statusImport?.finalStatus || "Concluido";
}

function collaboratorProductivity(visible) {
  const period = dashboardPeriod();
  const todayText = today();
  return collaborators.map((person) => {
    const related = visible.filter((order) => orderBelongsToCollaborator(order, person.name) || completedOwner(order) === person.name);
    const completed = visible.filter((order) => order.stage === "Concluido" && completedOwner(order) === person.name);
    const openOrders = related.filter((order) => !["Concluido", "Rejeitado"].includes(order.stage));
    const completedStageRows = uniqueValues(completed.map(completedStage)).map((stage) => ({
      stage,
      total: completed.filter((order) => completedStage(order) === stage).length
    }));
    const currentStageRows = uniqueValues(openOrders.map((order) => order.stage)).map((stage) => ({
      stage,
      total: openOrders.filter((order) => order.stage === stage).length
    }));
    return {
      name: person.name,
      doneToday: completed.filter((order) => dateOnly(completionDate(order)) === todayText).length,
      donePeriod: completed.filter((order) => isDateInRange(completionDate(order), period.start, period.end)).length,
      doneTotal: completed.length,
      rejected: visible.filter((order) => order.stage === "Rejeitado" && orderBelongsToCollaborator(order, person.name)).length,
      pending: related.filter((order) => orderPendencies(order).length || order.pendencyState?.active).length,
      processes: related.filter(hasAnyProcess).length,
      inProgress: openOrders.length,
      completedStages: completedStageRows,
      currentStages: currentStageRows,
      openOrders
    };
  }).sort((a, b) => b.donePeriod - a.donePeriod || b.inProgress - a.inProgress || a.name.localeCompare(b.name));
}

function markCompletedOrder(order, fromStage = order.stage) {
  const notice = processPendingNotice(order);
  if (notice) audit("Obra concluida com processo pendente", order.osNumber, fromStage, "Concluido", notice);
  const collaborator = currentCollaborator();
  const owner = order.owner && order.owner !== "Sem Responsavel" ? order.owner : collaborator?.name || order.budgeter || order.cadist || order.fieldTech || "";
  return {
    ...order,
    finishDate: order.finishDate || today(),
    completedAt: new Date().toISOString(),
    completedByOwner: owner,
    completedByUser: currentUser?.login || "sistema",
    completedByName: currentUser?.fullName || "Sistema",
    completedByCollaborator: collaborator?.name || owner,
    completedCadist: order.cadist || (fromStage === "Criacao de CAD" ? owner : ""),
    completedFromStage: fromStage
  };
}

function stageResponsibleField(stage) {
  if (stage === "Criacao de CAD") return "cadist";
  if (stage === "Orcamento") return "budgeter";
  if (stage === "Levantamento de Campo") return "fieldTech";
  return "owner";
}
function renderDashboardProcesses(visible) {
  const rows = [
    ["Total com processo", visible.filter(hasAnyProcess).length],
    ...processTabs.map((process) => [process.label, visible.filter((order) => order[process.key]).length])
  ];
  const max = Math.max(1, ...rows.map(([, value]) => value));
  elements.dashboardProcessSummary.innerHTML = rows.map(([label, value]) => dashboardProgressItem(label, value, max)).join("");
  if (elements.dashboardProcessOrders) elements.dashboardProcessOrders.innerHTML = "";
}

function renderDashboardPendencies(visible) {
  const withPendency = visible.filter((order) => orderPendencies(order).length);
  const both = withPendency.filter(hasAnyProcess);
  const rows = [
    ["Total com pendencias", withPendency.length],
    ["Pendencias + Processos", both.length],
    ...pendencyOptions.map((pendency) => [pendency, withPendency.filter((order) => orderPendencies(order).includes(pendency)).length])
  ];
  const max = Math.max(1, ...rows.map(([, value]) => value));
  elements.dashboardPendencySummary.innerHTML = rows.map(([label, value]) => dashboardProgressItem(label, value, max)).join("");
  if (elements.dashboardPendencyOrders) elements.dashboardPendencyOrders.innerHTML = "";
}

function renderDashboardRegionals(visible) {
  const regionals = uniqueValues(visible.map((order) => order.regional || "Sem regional"));
  const rows = regionals.map((regional) => {
    const list = visible.filter((order) => (order.regional || "Sem regional") === regional);
    const active = list.filter(isActiveForDeadline);
    return {
      label: regional,
      total: list.length,
      ans: active.filter((order) => deadlineInfo(order).key === "ANS").length,
      pendencies: list.filter((order) => orderPendencies(order).length).length,
      processes: list.filter(hasAnyProcess).length
    };
  });
  const max = Math.max(1, ...rows.map((item) => item.total));
  elements.regionalDashboard.innerHTML = rows.map((item) => dashboardProgressItem(item.label, item.total, max, `<span>Total: ${item.total}</span><span>Fora ANS: ${item.ans}</span><span>Pendencias: ${item.pendencies}</span><span>Processos: ${item.processes}</span>`)).join("") || `<div class="report-item">Nenhuma regional encontrada.</div>`;
}

function countStage(stage) {
  return orders.filter((order) => order.stage === stage).length;
}

function renderBoard() {
  if (!elements.kanbanBoard) return;
  const visible = boardOrders();
  elements.kanbanBoard.innerHTML = "";
  elements.kanbanBoard.classList.toggle("field-board", activeBoardTab === "Levantamento de Campo");

  if (activeBoardTab === "Levantamento de Campo") {
    elements.kanbanBoard.appendChild(createFieldBoard(visible));
    return;
  }

  if (["Concluido", "Rejeitado", "Cancelada", "Suspensa"].includes(activeBoardTab)) {
    elements.kanbanBoard.appendChild(createCompletedList(visible, activeBoardTab));
    return;
  }

  stageColumns(activeBoardTab).forEach((owner) => {
    const columnOrders = visible.filter((order) => normalizeOwnerValue(order.owner) === owner);
    const column = createColumn(owner, activeBoardTab, columnOrders);
    elements.kanbanBoard.appendChild(column);
  });
}

function renderProcesses() {
  if (!elements.processGrid) return;
  const visible = processOrders();
  const process = processTabs.find((item) => item.label === activeProcessTab) || processTabs[0];
  const columns = [...new Set([
    ...processColumns(process.key),
    ...visible.map((order) => processColumnOwner(order, process.key)).filter((owner) => !isUnassignedOwner(owner))
  ])];
  elements.processGrid.classList.add("process-board");
  elements.processGrid.innerHTML = "";
  columns.forEach((owner) => {
    const columnOrders = visible.filter((order) => processColumnOwner(order, process.key) === owner);
    const column = createColumn(owner, activeProcessTab, columnOrders);
    elements.processGrid.appendChild(column);
  });
}

function renderAdequacies() {
  if (!elements.adequacyGrid) return;
  const visible = adequacyOrders();
  const process = adequacyTabs.find((item) => item.label === activeAdequacyTab) || adequacyTabs[0];
  const baseColumns = process.key === "unidentified" ? [unassignedOwner] : processColumns(process.key);
  const columns = [...new Set([
    ...baseColumns,
    ...visible.map((order) => adequacyColumnOwner(order, process.key)).filter((owner) => !isUnassignedOwner(owner))
  ])];
  elements.adequacyGrid.classList.add("process-board");
  elements.adequacyGrid.innerHTML = "";
  columns.forEach((owner) => {
    const columnOrders = visible.filter((order) => adequacyColumnOwner(order, process.key) === owner);
    const column = createColumn(owner, activeAdequacyTab, columnOrders);
    elements.adequacyGrid.appendChild(column);
  });
}

function renderPendencies() {
  if (!elements.pendencyList) return;
  renderPendencySummary();
  const visible = pendencyOrders();
  elements.pendencyList.innerHTML = visible.length ? "" : `<div class="history-item">Nenhuma OS paralisada por pendencia.</div>`;
  visible.forEach((order) => {
    const row = document.createElement("article");
    const pendencies = orderPendencies(order);
    const terminalActions = [
      pendencies.includes("Cancelar") ? `<button type="button" data-action="send-cancelada" data-id="${order.id}">Enviar para Cancelada</button>` : "",
      pendencies.includes("Suspender") ? `<button type="button" data-action="send-suspensa" data-id="${order.id}">Enviar para Suspensa</button>` : ""
    ].filter(Boolean).join("");
    row.className = `pendency-row pendency-${slug(pendencies[0] || "geral")}`;
    const openedAt = order.pendencyState?.openedAt ? new Date(order.pendencyState.openedAt) : new Date();
    const stoppedDays = Math.max(0, Math.floor((Date.now() - openedAt.getTime()) / 86400000));
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(order.osNumber)}</strong>
        <span class="os-sub compact-name" title="${escapeHtml(order.clientName || "")}">${escapeHtml(compactDisplayText(order.clientName, 36))}</span>
        <small class="compact-name" title="${escapeHtml(order.city || "")}">${escapeHtml(compactDisplayText(order.city, 24))}</small>
      </div>
      <div>
        <strong>${escapeHtml(pendencies.join(", "))}</strong>
        <span class="os-sub">Obs: ${escapeHtml(order.pendencyState?.note || "-")}</span>
        <small>Aberta em ${openedAt.toLocaleString("pt-BR")} - ${stoppedDays} dia(s) parada</small>
      </div>
      <div>
        <span>Etapa anterior: <strong>${escapeHtml(order.pendencyState?.previousStage || "-")}</strong></span>
        <span>Responsavel anterior: <strong>${escapeHtml(order.pendencyState?.previousOwner || "-")}</strong></span>
        <small>Informada por ${escapeHtml(order.pendencyState?.openedByName || "-")}</small>
      </div>
      <div class="card-actions">
        <button type="button" data-action="open" data-id="${order.id}">Abrir</button>
        <button type="button" data-action="pendency" data-id="${order.id}">Resolver</button>
        ${terminalActions}
      </div>
    `;
    elements.pendencyList.appendChild(row);
  });
}

function sendPendencyOrderToTerminalStage(id, targetStage) {
  const order = orders.find((item) => item.id === id);
  if (!order) return;
  const pendencies = orderPendencies(order);
  const requiredPendency = targetStage === "Cancelada" ? "Cancelar" : "Suspender";
  if (!pendencies.includes(requiredPendency)) {
    alert(`Esta ordem nao possui pendencia do tipo ${requiredPendency}.`);
    return;
  }
  const now = new Date().toISOString();
  const terminalStatus = targetStage === "Cancelada" ? "CANCELADA" : "SUSPENSA";
  const previousValue = `${order.stage} / ${displayOwnerName(order.owner)} / ${stageStatus(order)}`;
  const updated = syncOrderTimer({
    ...order,
    stage: targetStage,
    owner: order.pendencyState?.previousOwner || order.owner || unassignedOwner,
    status: terminalStatus,
    fieldStatus: terminalStatus,
    cadStatus: terminalStatus,
    budgetStatus: terminalStatus,
    processStatus: terminalStatus,
    finalStatus: terminalStatus,
    pendencyState: {
      ...(order.pendencyState || {}),
      active: false,
      resolvedAt: now,
      resolvedByUser: currentUser?.login || "sistema",
      resolvedByName: currentUser?.fullName || "Sistema",
      resolution: `Enviada para ${targetStage}`
    },
    updatedAt: now
  }, now);
  orders = orders.map((item) => item.id === id ? updated : item);
  audit(
    `Pendencia enviada para ${targetStage}`,
    order.osNumber,
    previousValue,
    `${targetStage} / ${displayOwnerName(updated.owner)} / ${terminalStatus}`,
    `Pendencia ${requiredPendency} convertida em etapa ${targetStage}. Tipos ativos: ${pendencies.join(", ")}.`
  );
  persist();
  render();
}

function activePendencyOrders() {
  return orders.filter((order) => orderPendencies(order).length && order.pendencyState?.active);
}

function pendencyTypeCounts() {
  const counts = Object.fromEntries(pendencyOptions.map((pendency) => [pendency, 0]));
  activePendencyOrders().forEach((order) => {
    orderPendencies(order).forEach((pendency) => {
      counts[pendency] = (counts[pendency] || 0) + 1;
    });
  });
  return counts;
}

function renderPendencySummary() {
  if (!elements.pendencySummary) return;
  const counts = pendencyTypeCounts();
  const entries = Object.entries(counts).filter(([, total]) => total > 0);
  const totalOrders = activePendencyOrders().length;
  if (elements.pendencyTypeFilter) {
    const current = elements.pendencyTypeFilter.value || "Todas pendencias";
    elements.pendencyTypeFilter.innerHTML = [
      `<option value="Todas pendencias">Todas pendencias (${totalOrders})</option>`,
      ...entries.map(([label, total]) => `<option value="${escapeHtml(label)}">${escapeHtml(label)} (${total})</option>`)
    ].join("");
    elements.pendencyTypeFilter.value = current === "Todas pendencias" || counts[current] ? current : "Todas pendencias";
  }
  elements.pendencySummary.innerHTML = entries.length
    ? entries.map(([label, total]) => `<span class="pendency-count-chip pendency-${slug(label)}"><strong>${escapeHtml(label)}</strong><em>${total}</em></span>`).join("")
    : `<span class="os-sub">Nenhuma pendencia ativa.</span>`;
}

function nextButtonLabel(orderOrStage) {
  if (typeof orderOrStage !== "string" && isAdequacyOpen(orderOrStage)) return "Concluir Adequacao";
  if (typeof orderOrStage !== "string" && orderOrStage?.processState?.active) return "Avancar";
  const stage = typeof orderOrStage === "string" ? orderOrStage : orderOrStage?.stage;
  if (stage === "Adequacoes") return "Concluir Adequacao";
  if (stage === "Concluido") return "Rejeitado";
  if (stage === "Rejeitado") return "Concluir Rejeicao";
  return "Avancar";
}

function createCompletedList(completedOrders, stage = "Concluido") {
  const list = document.createElement("section");
  list.className = `completed-list compact-order-list ${stage === "Rejeitado" ? "rejected-list" : ""}`.trim();
  const emptyLabel = { Rejeitado: "rejeitada", Cancelada: "cancelada", Suspensa: "suspensa", Concluido: "concluida" }[stage] || "encontrada";
  list.innerHTML = completedOrders.length ? "" : `<div class="history-item">Nenhuma OS ${emptyLabel} encontrada.</div>`;
  completedOrders.forEach((order) => {
    const row = document.createElement("article");
    row.className = "compact-order-row completed-row";
    row.innerHTML = `
      <div class="compact-main">
        <strong>${escapeHtml(order.osNumber || "Sem numero")}</strong>
        <span class="compact-name" title="${escapeHtml(`${order.clientName || "-"} - ${order.city || "-"}`)}">${escapeHtml(compactDisplayText(`${order.clientName || "-"} - ${order.city || "-"}`, 48))}</span>
      </div>
      <div class="compact-meta">
        <span>Status: <strong>${escapeHtml(stageStatus(order))}</strong></span>
        ${order.finishDate ? `<span>Finalizada: <strong>${escapeHtml(order.finishDate)}</strong></span>` : ""}
        ${order.rejectedAt ? `<span>Rejeitada: <strong>${new Date(order.rejectedAt).toLocaleString("pt-BR")}</strong></span>` : ""}
        ${order.regional ? `<span>Regional: <strong>${escapeHtml(order.regional)}</strong></span>` : ""}
      </div>
      <div class="card-actions compact-actions">
        <button type="button" data-action="open" data-id="${order.id}">Abrir</button>
        <button type="button" data-action="pendency" data-id="${order.id}">Pendencia</button>
      
        ${["Concluido", "Rejeitado"].includes(stage) ? `<button type="button" data-action="next" data-id="${order.id}">${nextButtonLabel(stage)}</button>` : ""}
      </div>
    `;
    list.appendChild(row);
  });
  return list;
}
function fieldLaneStatus(order) {
  const status = normalizeStatus(order.fieldStatus || "Roteirizacao");
  if (status === "REMOTO") return "Remoto";
  if (status === "PROGRAMADO") return "Programado";
  if (status === "EM ANDAMENTO") return "Em Andamento";
  return "Roteirizacao";
}

function parseUtmCoordinate(value) {
  let text = String(value ?? "").trim();
  if (!text) return null;
  text = text.replace(/\s/g, "");
  if (text.includes(",") && text.includes(".")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else {
    text = text.replace(",", ".");
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function utm24SToLatLon(easting, northing) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ePrime2 = e2 / (1 - e2);
  const x = easting - 500000;
  const y = northing - 10000000;
  const zone = 24;
  const lonOrigin = (-183 + zone * 6) * Math.PI / 180;
  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const j1 = 3 * e1 / 2 - 27 * e1 ** 3 / 32;
  const j2 = 21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32;
  const j3 = 151 * e1 ** 3 / 96;
  const j4 = 1097 * e1 ** 4 / 512;
  const fp = mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu) + j4 * Math.sin(8 * mu);
  const sinFp = Math.sin(fp);
  const cosFp = Math.cos(fp);
  const tanFp = Math.tan(fp);
  const c1 = ePrime2 * cosFp ** 2;
  const t1 = tanFp ** 2;
  const n1 = a / Math.sqrt(1 - e2 * sinFp ** 2);
  const r1 = a * (1 - e2) / (1 - e2 * sinFp ** 2) ** 1.5;
  const d = x / (n1 * k0);
  const lat = fp - (n1 * tanFp / r1) * (
    d ** 2 / 2
    - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ePrime2) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ePrime2 - 3 * c1 ** 2) * d ** 6 / 720
  );
  const lon = lonOrigin + (
    d
    - (1 + 2 * t1 + c1) * d ** 3 / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ePrime2 + 24 * t1 ** 2) * d ** 5 / 120
  ) / cosFp;
  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

function fieldMapItems(sourceOrders = boardOrders()) {
  return sourceOrders
    .filter((order) => order.stage === "Levantamento de Campo")
    .map((order) => {
      const status = fieldLaneStatus(order);
      const x = parseUtmCoordinate(order.coordinateX);
      const y = parseUtmCoordinate(order.coordinateY);
      if (!fieldMapStatuses.includes(status) || x === null || y === null) return null;
      return {
        order,
        status,
        x,
        y,
        color: fieldMapStatusColors[status] || "#93c5fd"
      };
    })
    .filter(Boolean);
}

function fieldStatusDisplay(status) {
  if (status === "Roteirizacao") return "Roteirizacao";
  return status;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function fieldMapSvg(items, expanded = false) {
  if (!items.length) {
    return `<div class="field-map-empty">Nenhuma ordem de Campo com coordenadas em Roteirizacao, Programado ou Em Andamento.</div>`;
  }
  const width = expanded ? 1200 : 940;
  const height = expanded ? 640 : 260;
  const padding = expanded ? 56 : 30;
  const xs = items.map((item) => item.x);
  const ys = items.map((item) => item.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = Math.max(maxX - minX, 1);
  const rangeY = Math.max(maxY - minY, 1);
  const points = items.map((item) => {
    const px = padding + ((item.x - minX) / rangeX) * (width - padding * 2);
    const py = height - padding - ((item.y - minY) / rangeY) * (height - padding * 2);
    const label = `${item.order.osNumber} - ${fieldStatusDisplay(item.status)}`;
    return `
      <g class="field-map-marker">
        <title>${escapeHtml(label)}</title>
        <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${expanded ? 6 : 4.5}" fill="${item.color}" />
        <text x="${(px + 8).toFixed(1)}" y="${(py - 2).toFixed(1)}">${escapeHtml(item.order.osNumber)}</text>
        <text class="field-map-status" x="${(px + 8).toFixed(1)}" y="${(py + 11).toFixed(1)}">${escapeHtml(fieldStatusDisplay(item.status))}</text>
      </g>
    `;
  }).join("");
  return `
    <svg class="field-map-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mapa de ordens de campo">
      <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="12" />
      <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" />
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" />
      ${points}
    </svg>
  `;
}

function createFieldMapPanel(fieldOrders) {
  const items = fieldMapItems(fieldOrders);
  const panel = document.createElement("section");
  panel.className = "field-map-panel field-kml-panel";
  const counts = Object.fromEntries(fieldMapStatuses.map((status) => [status, items.filter((item) => item.status === status).length]));
  panel.innerHTML = `
    <div class="field-map-head">
      <div>
        <span class="eyebrow">KML Campo</span>
        <strong>Exportar ordens com coordenadas</strong>
      </div>
      <div class="field-map-summary">
        ${fieldMapStatuses.map((status) => `<span><i style="background:${fieldMapStatusColors[status]}"></i>${escapeHtml(fieldStatusDisplay(status))}: ${counts[status]}</span>`).join("")}
      </div>
      <div class="field-map-actions">
        <button type="button" data-action="download-field-kml">Baixar KML</button>
      </div>
    </div>
  `;
  panel.querySelector('[data-action="download-field-kml"]').addEventListener("click", () => downloadFieldKml(fieldOrders));
  return panel;
}

function openFieldMapModal(fieldOrders) {
  const items = fieldMapItems(fieldOrders);
  let dialog = document.querySelector("#fieldMapModal");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "fieldMapModal";
    dialog.className = "field-map-modal";
    dialog.innerHTML = `
      <div class="field-map-modal-card">
        <div class="modal-head">
          <div>
            <span class="eyebrow">Levantamento de Campo</span>
            <h2>Mapa das ordens</h2>
          </div>
          <button class="icon-button" type="button" data-action="close-field-map">X</button>
        </div>
        <div class="field-map-modal-body"></div>
        <div class="modal-actions">
          <button class="ghost-button" type="button" data-action="download-field-kml">Baixar KML</button>
          <button class="primary-button" type="button" data-action="close-field-map">Minimizar</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
  }
  dialog.querySelector(".field-map-modal-body").innerHTML = fieldMapSvg(items, true);
  dialog.querySelectorAll('[data-action="close-field-map"]').forEach((button) => {
    button.onclick = () => dialog.close();
  });
  dialog.querySelector('[data-action="download-field-kml"]').onclick = () => downloadFieldKml(fieldOrders);
  dialog.showModal();
}

function downloadFieldKml(fieldOrders = boardOrders()) {
  const items = fieldMapItems(fieldOrders);
  if (!items.length) {
    alert("Nao existem ordens de Campo com coordenadas em Roteirizacao, Programado ou Em Andamento para gerar KML.");
    return;
  }
  const placemarks = items.map((item) => {
    const point = utm24SToLatLon(item.x, item.y);
    const name = `${item.order.osNumber} - ${fieldStatusDisplay(item.status)}`;
    return `
      <Placemark>
        <name>${xmlEscape(name)}</name>
        <description>${xmlEscape(`OS: ${item.order.osNumber}\nStatus: ${fieldStatusDisplay(item.status)}\nX UTM 24S: ${item.x}\nY UTM 24S: ${item.y}`)}</description>
        <Style>
          <IconStyle>
            <color>ff${item.color.slice(5, 7)}${item.color.slice(3, 5)}${item.color.slice(1, 3)}</color>
            <scale>1.1</scale>
          </IconStyle>
        </Style>
        <Point><coordinates>${point.lon.toFixed(8)},${point.lat.toFixed(8)},0</coordinates></Point>
      </Placemark>
    `;
  }).join("");
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Levantamento de Campo - ${today()}</name>
    ${placemarks}
  </Document>
</kml>`;
  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `levantamento-campo-${today()}.kml`;
  link.click();
  URL.revokeObjectURL(url);
  audit("Exportacao KML Campo", "", "", `KML gerado com ${items.length} ordem(ns) de Campo.`);
}

function createFieldBoard(fieldOrders) {
  const board = document.createElement("section");
  board.className = "field-status-board";
  board.appendChild(createFieldMapPanel(fieldOrders));
  const lanes = document.createElement("div");
  lanes.className = "field-lanes";
  board.appendChild(lanes);
  fieldKanbanStatuses.forEach((status) => {
    const laneOrders = fieldOrders.filter((order) => fieldLaneStatus(order) === status);
    lanes.appendChild(createFieldLane(status, laneOrders));
  });
  return board;
}

function fillManualAssignStrip(strip, stage) {
  const names = ["Sem Responsavel", ...allowedCollaborators(stage).map((person) => person.name)];
  strip.innerHTML = `<span>Atribuir Campo</span>${names.map((name) => `<button type="button" class="manual-assign-target" data-owner="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}`;
  strip.querySelectorAll(".manual-assign-target").forEach((target) => {
    target.addEventListener("dragover", (event) => {
      event.preventDefault();
      target.classList.add("drag-over");
    });
    target.addEventListener("dragleave", () => target.classList.remove("drag-over"));
    target.addEventListener("drop", (event) => {
      event.preventDefault();
      target.classList.remove("drag-over");
      const id = event.dataTransfer.getData("text/plain");
      void assignOwner(id, target.dataset.owner, stage);
    });
  });
}

function createFieldLane(status, laneOrders) {
  const lane = document.createElement("section");
  lane.className = `field-lane field-lane-${slug(status)}`;
  lane.innerHTML = `
    <header class="field-lane-head">
      <strong>${escapeHtml(status)}</strong>
      <span class="count-pill">${laneOrders.length}</span>
    </header>
    <div class="column-cards field-lane-cards"></div>
  `;
  const cards = lane.querySelector(".field-lane-cards");
  cards.addEventListener("dragover", (event) => event.preventDefault());
  cards.addEventListener("drop", (event) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain");
    changeFieldStatus(id, status);
  });
  laneOrders.forEach((order) => cards.appendChild(createCard(order)));
  return lane;
}

function fieldStatusButtons(order) {
  if (order.stage !== "Levantamento de Campo" || !hasPermission("reports")) return "";
  const labels = { Remoto: "Remoto", Roteirizacao: "Roteirizacao", Programado: "Programado", "Em Andamento": "Andamento" };
  return `
    <div class="field-status-actions">
      ${fieldKanbanStatuses.map((status) => `
        <button type="button" title="Enviar para ${escapeHtml(status)}" data-action="field-status" data-status="${escapeHtml(status)}" data-id="${order.id}" ${fieldLaneStatus(order) === status ? "disabled" : ""}>${escapeHtml(labels[status] || status)}</button>
      `).join("")}
    </div>
  `;
}

function changeFieldStatus(id, status) {
  if (!hasPermission("reports")) {
    alert("Voce nao tem permissao para alterar o status de Campo.");
    return;
  }
  if (!fieldKanbanStatuses.includes(status)) return;
  const order = orders.find((item) => item.id === id);
  if (!order || order.stage !== "Levantamento de Campo") return;
  const beforeStatus = order.fieldStatus || "Roteirizacao";
  const beforeLane = fieldLaneStatus(order);
  if (beforeLane === status) return;
  const now = new Date().toISOString();
  const remoteExit = beforeLane === "Remoto" && status !== "Remoto";
  const updated = {
    ...order,
    fieldStatus: status,
    remoteEvaluated: remoteExit ? true : order.remoteEvaluated,
    remoteEvaluatedAt: remoteExit ? (order.remoteEvaluatedAt || now) : order.remoteEvaluatedAt,
    remoteEvaluationDestination: remoteExit ? status : order.remoteEvaluationDestination,
    updatedAt: now
  };
  orders = orders.map((item) => item.id === id ? updated : item);
  audit(
    "AlteraÃƒÂ§ÃƒÂ£o de status de Campo",
    order.osNumber,
    beforeStatus,
    status,
    `Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}`
  );
  if (remoteExit) {
    audit(
      "Avaliacao remota concluida",
      order.osNumber,
      "Remoto",
      status,
      `Saida da baia Remoto em ${new Date(now).toLocaleString("pt-BR")}. Destino apos avaliacao: ${status}.`
    );
  }
  persist();
  render();
}
function canDropOnColumn(title, stage) {
  if (canManualAssignOrders()) return true;
  const processKey = processKeyFromLabel(stage);
  if (!processKey) return false;
  const collaborator = currentCollaborator();
  return Boolean(collaborator && title === collaborator.name && collaboratorProcesses(collaborator).includes(processKey));
}
function createColumn(title, stage, columnOrders, acceptsDrop = true) {
  const column = document.createElement("section");
  column.className = `kanban-column ${isUnassignedOwner(title) ? "unassigned-column" : ""}`.trim();
  column.innerHTML = `
    <header class="column-head">
      ${collaboratorHeaderHtml(title, stage)}
      <span class="count-pill">${columnOrders.length}</span>
    </header>
    <div class="column-cards"></div>
  `;
  const cards = column.querySelector(".column-cards");

  if (acceptsDrop && canDropOnColumn(title, stage)) {
    const allowDrop = (event) => {
      event.preventDefault();
      column.classList.add("drop-active");
    };
    const clearDrop = () => column.classList.remove("drop-active");
    const handleDrop = (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearDrop();
      const id = event.dataTransfer.getData("text/plain");
      void assignOwner(id, title, stage);
    };
    [column, cards].forEach((target) => {
      target.addEventListener("dragover", allowDrop);
      target.addEventListener("dragleave", clearDrop);
      target.addEventListener("drop", handleDrop);
    });
  }

  columnOrders.forEach((order) => cards.appendChild(createCard(order)));
  return column;
}

function createCard(order) {
  const info = deadlineInfo(order);
  const card = document.createElement("article");
  const isMoving = movingOrderIds.has(order.id);
  card.className = `os-card ${order.remoteFastTrack ? "remote-fast-track" : ""} ${canManualAssignOrders() ? "manual-draggable" : ""} ${isMoving ? "is-saving" : ""}`.trim();
  card.draggable = !isMoving && (canManualAssignOrders() || hasPermission("reports"));
  card.dataset.id = order.id;
  card.addEventListener("dragstart", (event) => {
    if (movingOrderIds.has(order.id)) {
      event.preventDefault();
      return;
    }
    card.classList.add("dragging");
    event.dataTransfer.setData("text/plain", order.id);
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));

  const processBadges = processTabs
    .filter((item) => order[item.key])
    .map((item) => `<span class="pill">${escapeHtml(item.label)}</span>`)
    .join("");
  const pendencyBadges = orderPendencies(order).length
    ? `<span class="pill pendency-alert" title="${escapeHtml(orderPendencies(order).join(", "))}">! ${orderPendencies(order).length} Pendencias</span>`
    : "";

  card.innerHTML = `
    <div class="os-title">
      <strong>${escapeHtml(order.osNumber || "Sem numero")}</strong>
      <span class="pill priority-${slug(info.priority)}">${escapeHtml(info.priority)}</span>
    </div>
    <div class="os-sub compact-name" title="${escapeHtml(`${order.clientName || ""} - ${order.city || ""}`)}">${escapeHtml(compactDisplayText(`${order.clientName || ""} - ${order.city || ""}`, 46))}</div>
    <div class="os-meta">
      <span class="pill">${escapeHtml(stageStatus(order))}</span>
      <span class="pill ${info.className}" title="Baseado na Data de Recebimento: ${escapeHtml(order.receivedDate || "-")}">${escapeHtml(info.label)}</span>
      ${order.regional ? `<span class="pill">${escapeHtml(order.regional)}</span>` : ""}
      ${order.remoteOrder ? `<span class="pill">Remota</span>` : ""}
      ${hasPermission("admin") ? `<span class="pill live-timer" data-order-timer="${order.id}">${escapeHtml(currentOrderTimerLabel(order))}</span>` : ""}
    </div>
    <div class="indicators">${processBadges}${order.stage === "Concluido" && processPendingNotice(order) ? `<span class="pill pendency-alert" title="${escapeHtml(processPendingNotice(order))}">${escapeHtml(processPendingNotice(order))}</span>` : ""}</div>
    <div class="indicators">${pendencyBadges}</div>
    <div class="card-actions">
      <button type="button" data-action="open" data-id="${order.id}">Abrir</button>
      <button type="button" data-action="pendency" data-id="${order.id}">Pendencia</button>
      <button type="button" data-action="next" data-id="${order.id}">${nextButtonLabel(order)}</button>
    </div>
    ${fieldStatusButtons(order)}
  `;
  card.querySelectorAll('button[data-action="field-status"]').forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      changeFieldStatus(button.dataset.id, button.dataset.status);
    });
  });
  return card;
}

function renderReports() {
  const stageLabels = stages.map((stage) => [stage, countStage(stage)]);
  elements.generalReport.innerHTML = [
    ["Total de Ordens", orders.length],
    ...stageLabels,
["Ordens Concluidas", countStage("Concluido")],
    ["Ordens Rejeitadas", countStage("Rejeitado")],
    ["Ordens com VOZ", orders.filter((order) => voiceSummary(order)).length]
  ].map(reportItem).join("");

  elements.deadlineReport.innerHTML = [
    ["Dentro do prazo", orders.filter((order) => isActiveForDeadline(order) && deadlineInfo(order).key === "Dentro").length],
    ["Fora do prazo ANS", orders.filter((order) => isActiveForDeadline(order) && deadlineInfo(order).key === "ANS").length]
  ].map(reportItem).join("");

  const pendencyCount = orders.filter((order) => orderPendencies(order).length).length;
  elements.deadlineReport.innerHTML += reportItem(["Ordens com Pendencias", pendencyCount]);

  elements.responsibleReport.innerHTML = collaborators.map((person) => {
    const personOrders = orders.filter((order) => order.owner === person.name);
    const rows = reportStatuses.map((status) => {
      const count = personOrders.filter((order) => normalizeStatus(stageStatus(order)) === status).length;
      return `<span>${status}: <strong>${count}</strong></span>`;
    }).join("");
    const voiceCount = personOrders.filter((order) => voiceSummary(order)).length;
    return `<div class="report-item"><strong>${person.name}</strong><div class="os-meta">${rows}<span>VOZ: <strong>${voiceCount}</strong></span><span>Total: <strong>${personOrders.length}</strong></span></div></div>`;
  }).join("");
}

function reportItem([label, value]) {
  return `<div class="report-item"><span>${label}</span><strong>${value}</strong></div>`;
}

function normalizeStatus(value) {
  return String(value || "NAO TRATADO").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function normalizePendencyName(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeStatus(raw);
  if (!raw) return "";
  if (normalized.includes("TERMO")) return "Termo";
  if (normalized.includes("CVT")) return "CVT";
  if (normalized.includes("FOTO")) return "Fotos";
  if (normalized.includes("OC") || normalized.includes("PLC")) return "OC";
  if (normalized.includes("CANCEL")) return "Cancelar";
  if (normalized.includes("SUSPEND") || normalized.includes("SUSPENS")) return "Suspender";
  if (normalized.includes("ENEL")) return "Aguardando Enel";
  return pendencyOptions.includes(raw) ? raw : raw;
}

function normalizePendencies(list) {
  return [...new Set((Array.isArray(list) ? list : []).map(normalizePendencyName).filter(Boolean))];
}

function orderPendencies(order) {
  return normalizePendencies(order?.pendencies || []);
}

function hasPendency(order, pendency) {
  return orderPendencies(order).includes(pendency);
}
function renderAdmin() {
  elements.permissionGrid.innerHTML = `
    <div class="permission-heading">Etapas</div>
    ${stages.slice(0, 3).map((stage) => `
      <label><input type="checkbox" value="${stage}" name="permission"> ${stage}</label>
    `).join("")}
  `;

  if (elements.processPermissionGrid) {
    elements.processPermissionGrid.innerHTML = `
      <div class="permission-heading">Processos</div>
      ${processTabs.map((process) => `
        <label><input type="checkbox" value="${process.key}" name="processPermission"> ${process.label}</label>
      `).join("")}
    `;
  }

  renderUsers();
  renderPermissionsTable();
}

function renderHistory() {
  renderAuditFilters();
  const filtered = filteredAudit();
  elements.historyList.innerHTML = filtered.length
    ? filtered.slice().reverse().map((entry) => `
      <div class="history-item">
        <strong>${escapeHtml(entry.action)} ${entry.osNumber ? `- ${escapeHtml(entry.osNumber)}` : ""}</strong>
        <div class="os-sub">Usuario: ${escapeHtml(entry.fullName || "Sistema")} (${escapeHtml(entry.login || "-")})${entry.collaboratorName ? ` | Colaborador: ${escapeHtml(entry.collaboratorName)}` : ""}</div>
        <div class="os-sub">De: ${escapeHtml(entry.oldValue || "-")} | Para: ${escapeHtml(entry.newValue || "-")}</div>
        ${entry.detail ? `<div class="os-sub">${escapeHtml(entry.detail)}</div>` : ""}
        <small>${new Date(entry.date).toLocaleString("pt-BR")}</small>
      </div>
    `).join("")
    : `<div class="history-item">Nenhum registro de auditoria encontrado.</div>`;
}

function openOrder(order = makeOrder({ osNumber: nextOsNumber() })) {
  const normalizedOrder = { ...order, voices: normalizeVoices(order) };
  elements.modalTitle.textContent = order.id && orders.some((item) => item.id === order.id) ? "Editar OS" : "Nova OS";
  elements.deleteOrderButton.hidden = !fields.orderId.value || !hasPermission("deleteOrder");
  Object.entries(fields).forEach(([key, input]) => {
    const voice = voiceDefinitions.find((item) => item.field === key);
    const value = voice ? normalizedOrder.voices[voice.key] : normalizedOrder[key];
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value ?? "";
  });
  refreshSharePointLinkField();
  updateCalculatedAnsField();
  setVoiceFields(normalizedOrder);
  renderProcessDetails(normalizedOrder);
  updateVoiceVisibility();
  fields.orderId.value = order.id || "";
  elements.deleteOrderButton.hidden = !fields.orderId.value || !hasPermission("deleteOrder");
  elements.nextStageButton.hidden = !fields.orderId.value;
  elements.nextStageButton.textContent = nextButtonLabel(order);
  refreshSharePointLinkField();
  elements.returnToCadButton.hidden = !(fields.orderId.value && canReturnToField(order));
  elements.returnToCadButton.textContent = "Devolver para Campo";
  elements.returnToCadStageButton.hidden = !(fields.orderId.value && canReturnToCad(order));
  elements.returnToCadStageButton.textContent = "Voltar para CAD";
  elements.orderForm.querySelector("button[type='submit']").hidden = fields.orderId.value ? !canSaveExistingOrder() : !hasPermission("createOrder");
  renderStageOptions();
  fields.stage.value = order.stage || stages[0];
  renderResponsibleOptions(normalizedOrder);
  fields.owner.value = ownerFromOrderResponsibles(normalizedOrder);
  applyStageLocks();
  applyLimitedOrderEditLocks();
  renderOrderTimerDetails(order);
  renderOrderPendencies(order);
  elements.modal.showModal();
}

function setVoiceFields(order) {
  const voices = normalizeVoices(order);
  voiceDefinitions.forEach((voice) => {
    const value = voices[voice.key];
    if (fields[voice.field]) fields[voice.field].value = value.code || "";
    if (fields[voice.polesField]) fields[voice.polesField].value = value.poles ?? "";
    if (fields[voice.repeatField]) fields[voice.repeatField].value = value.repeat || "1x";
    if (voice.typeField && fields[voice.typeField]) fields[voice.typeField].value = value.type || "";
  });
  updateVoiceCodes();
  updateVoiceVisibility();
}

function refreshProcessDependentFields() {
  renderProcessDetails({ processDetails: currentProcessDetails() });
  updateVoiceVisibility();
  updateVoiceCodes();
}

function renderOrderTimerDetails(order) {
  const existing = document.querySelector("#orderTimerView");
  existing?.remove();
  if (!hasPermission("admin")) return;
  const holder = document.createElement("section");
  holder.id = "orderTimerView";
  holder.className = "process-boxes";
  holder.innerHTML = `<h3>Timer da Ordem</h3><div class="timer-detail-list compact-timer-list">${timerSegments(order).map((segment) => `
    <div class="timer-detail-item compact-timer-item">
      <strong>${escapeHtml(segment.sector || "-")}</strong>
      <span>${escapeHtml(displayOwnerName(segment.owner))}</span>
      <span>${escapeHtml(formatDuration(segmentDuration(segment)))}</span>
      ${segment.active ? "<em>andamento</em>" : "<i></i>"}
    </div>
  `).join("") || `<div class="timer-empty">Sem registros de tempo.</div>`}</div>`;
  elements.lockedSections.before(holder);
}

function renderOrderPendencies(order) {
  const existing = document.querySelector("#orderPendenciesView");
  existing?.remove();
  const holder = document.createElement("section");
  holder.id = "orderPendenciesView";
  holder.className = "process-boxes";
  holder.innerHTML = `
    <h3>Pendencias</h3>
    <div class="indicators">
      ${orderPendencies(order).length ? orderPendencies(order).map((item) => `<span class="pill pendency-alert">${escapeHtml(item)}</span>`).join("") : `<span class="os-sub">Nenhuma pendencia cadastrada.</span>`}
    </div>
  `;
  elements.lockedSections.insertAdjacentElement("afterend", holder);
}

function deleteCurrentOrder() {
  if (!requirePermission("deleteOrder")) return;
  const order = orders.find((item) => item.id === fields.orderId.value);
  if (!order) return;
  orders = orders.filter((item) => item.id !== order.id);
  deletedOrderIds = [...new Set([order.id, ...deletedOrderIds])].slice(0, 1000);
  audit("ExclusÃƒÂ£o de ordem", order.osNumber, summarizeOrder(order), "OS excluida");
  persist();
  elements.modal.close();
  render();
}

function openPendencyModal(order) {
  if (!order) return;
  elements.pendencyOrderId.value = order.id;
  elements.pendencyTitle.textContent = `Pendencias - ${order.osNumber || "OS"}`;
  elements.pendencyNote.value = "";
  elements.pendencyOptions.innerHTML = pendencyOptions.map((option) => `
    <label><input type="checkbox" value="${escapeHtml(option)}" ${orderPendencies(order).includes(option) ? "checked" : ""}> ${escapeHtml(option)}</label>
  `).join("");
  elements.pendencyModal.showModal();
}

function savePendencies(event) {
  event.preventDefault();
  const order = orders.find((item) => item.id === elements.pendencyOrderId.value);
  if (!order) return;
  const previous = orderPendencies(order);
  const selected = normalizePendencies([...elements.pendencyOptions.querySelectorAll("input:checked")].map((input) => input.value));
  const added = selected.filter((item) => !previous.includes(item));
  const removed = previous.filter((item) => !selected.includes(item));
  const note = elements.pendencyNote.value.trim();
  const now = new Date().toISOString();
  const openingPendencies = !previous.length && selected.length;
  const resolvingAll = previous.length && !selected.length;
  const previousStage = order.pendencyState?.previousStage || order.stage;
  const shouldReturnFieldPendencyToCad = resolvingAll
    && previousStage === "Levantamento de Campo"
    && previous.some((item) => fieldPendencyReturnToCadOptions.includes(normalizePendencyName(item)));
  const updated = {
    ...order,
    pendencies: selected,
    pendencyNotes: note ? [...(order.pendencyNotes || []), { note, date: now, user: currentUser?.login || "sistema" }] : (order.pendencyNotes || []),
    updatedAt: now
  };
  if (openingPendencies) {
    updated.pendencyState = {
      active: true,
      previousStage: order.stage,
      previousOwner: order.owner || "Sem Responsavel",
      openedByUser: currentUser?.login || "sistema",
      openedByName: currentUser?.fullName || "Sistema",
      openedByCollaborator: currentCollaborator()?.name || "",
      openedAt: now,
      note
    };
    updated.stage = "Pendencias";
    updated.owner = "Sem Responsavel";
  }
  if (selected.includes("Cancelar")) {
    updated.fieldStatus = "CANCELADO";
    updated.cadStatus = "CANCELADO";
    updated.budgetStatus = "CANCELADO";
  }
  if (selected.includes("Suspender")) {
    updated.fieldStatus = "SUSPENSA";
    updated.cadStatus = "SUSPENSA";
    updated.budgetStatus = "SUSPENSA";
  }
  if (resolvingAll) {
    updated.stage = shouldReturnFieldPendencyToCad ? "Criacao de CAD" : previousStage;
    updated.owner = shouldReturnFieldPendencyToCad ? unassignedOwner : (order.pendencyState?.previousOwner || order.owner || unassignedOwner);
    if (shouldReturnFieldPendencyToCad) {
      updated.cadist = "";
      updated.cadStatus = "NAO TRATADO";
      updated.status = "NAO TRATADO";
    }
    updated.pendencyState = {
      ...(order.pendencyState || {}),
      active: false,
      resolvedByUser: currentUser?.login || "sistema",
      resolvedByName: currentUser?.fullName || "Sistema",
      resolvedAt: now
    };
  }
  orders = orders.map((item) => item.id === order.id ? updated : item);
  const detail = [
    openingPendencies ? `Aberta por ${currentUser?.fullName || "Sistema"} em ${order.stage} / ${order.owner || "Sem Responsavel"}` : "",
    resolvingAll ? `Resolvida por ${currentUser?.fullName || "Sistema"}. Retorno automatico para ${updated.stage} / ${updated.owner}` : "",
    shouldReturnFieldPendencyToCad ? `Origem ${previousStage}; pendencias ${previous.join(", ")} resolvidas. Enviada para Criacao de CAD / ${unassignedLabel}, sem cadista responsavel, aguardando distribuicao.` : "",
    note ? `Observacao: ${note}` : ""
  ].filter(Boolean).join(" | ");
  if (shouldReturnFieldPendencyToCad) {
    addHistory(order, updated, "Retorno de pendencia para CAD");
    audit(
      "Saida de pendencia para CAD",
      order.osNumber,
      `${previousStage} / ${order.pendencyState?.previousOwner || order.owner || unassignedOwner}`,
      `Criacao de CAD / ${unassignedLabel}`,
      `Pendencias resolvidas: ${previous.join(", ")}. Usuario: ${currentUser?.fullName || "Sistema"}. Ordem enviada sem responsavel para aguardar distribuicao.`
    );
  }
  if (resolvingAll) registerDistribution(updated, updated.owner, updated.stage, "Retorno de pendencia");
  audit("Alteracao de pendencias", order.osNumber, removed.join(", ") || "-", added.join(", ") || "-", detail);
  persist();
  elements.pendencyModal.close();
  render();
}


function previousCadistForReturn(order) {
  return order?.completedCadist || order?.cadist || (order?.completedFromStage === "Criacao de CAD" ? order.completedByOwner : "") || order?.statusImport?.cadista || "";
}

function canReturnToCad(order) {
  return Boolean(order
    && ["Concluido", "Rejeitado", "Orcamento", "Pendencias"].includes(order.stage)
    && previousCadistForReturn(order)
    && (hasPermission("moveOrder") || hasPermission("editOrder") || canAdvanceOrder(order)));
}

function returnCurrentOrderToCad() {
  const order = orders.find((item) => item.id === fields.orderId.value);
  if (!order) return;
  const cadist = previousCadistForReturn(order);
  if (!canReturnToCad(order)) {
    const message = cadist ? "Voce nao tem permissao para voltar esta OS para CAD." : "Nao foi encontrado cadista anterior para esta OS.";
    audit("Tentativa de retorno ao CAD bloqueada", order.osNumber, `${order.stage} / ${order.owner || "Sem Responsavel"}`, `Criacao de CAD / ${cadist || "Sem cadista"}`, message);
    alert(message);
    return;
  }
  const now = new Date().toISOString();
  const updated = {
    ...order,
    stage: "Criacao de CAD",
    owner: cadist,
    cadist,
    cadStatus: "EM ESPERA",
    status: order.status === "CONCLUIDO" || order.status === "REJEITADO" ? "EM ESPERA" : order.status,
    returnedToCadAt: now,
    returnedToCadBy: currentUser?.login || "sistema",
    updatedAt: now
  };
  addHistory(order, updated, "Retorno para CAD");
  registerDistribution(updated, cadist, "Criacao de CAD", "Manual");
  audit(
    "Retorno de ordem para CAD",
    order.osNumber,
    `${order.stage} / ${order.owner || "Sem Responsavel"}`,
    `${updated.stage} / ${updated.owner}`,
    `Cadista anterior: ${cadist}. Usuario: ${currentUser?.fullName || "Sistema"}. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}.`
  );
  orders = orders.map((item) => item.id === order.id ? updated : item);
  persist();
  elements.modal.close();
  render();
}
function canReturnToField(order) {
  return Boolean(order
    && ["Criacao de CAD", "Orcamento", "Rejeitado"].includes(order.stage)
    && (hasPermission("moveOrder") || canAdvanceOrder(order)));
}

function returnCurrentOrderToField() {
  const order = orders.find((item) => item.id === fields.orderId.value);
  if (!order || !["Criacao de CAD", "Orcamento", "Rejeitado"].includes(order.stage)) return;
  if (!canReturnToField(order)) {
    const message = "Voce nao tem permissao para devolver esta OS para Campo.";
    audit("Tentativa de retorno ao Campo bloqueada", order.osNumber, `${order.stage} / ${order.owner || "Sem Responsavel"}`, "Levantamento de Campo / Sem Responsavel", message);
    alert(message);
    return;
  }
  const updated = {
    ...order,
    stage: "Levantamento de Campo",
    owner: "Sem Responsavel",
    fieldStatus: fieldLaneStatus(order) === "Remoto" && (order.remoteEvaluated || order.remoteFastTrack) ? "Roteirizacao" : (order.fieldStatus || "Roteirizacao"),
    returnedToFieldAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  addHistory(order, updated, "Retorno para Campo");
  audit(
    "Retorno de ordem para Campo",
    order.osNumber,
    `${order.stage} / ${order.owner || "Sem Responsavel"}`,
    `${updated.stage} / ${updated.owner}`,
    `Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}. Status de Campo: ${updated.fieldStatus}.`
  );
  orders = orders.map((item) => item.id === order.id ? updated : item);
  persist();
  elements.modal.close();
  render();
}
function renderStageOptions() {
  fields.stage.innerHTML = stages.map((stage) => `<option>${stage}</option>`).join("");
}

function fillResponsibleSelect(input, stage, selected = "") {
  const allowed = allowedCollaborators(stage).map((person) => person.name);
  const normalizedSelected = normalizeOwnerValue(selected);
  const options = [unassignedOwner, processRoutingOption, ...allowed];
  if (!isUnassignedOwner(normalizedSelected) && !options.includes(normalizedSelected)) options.push(normalizedSelected);
  input.innerHTML = options.map((name) => {
    const suffix = !isUnassignedOwner(name) && name !== processRoutingOption && !allowed.includes(name) ? " (atual)" : "";
    return `<option value="${escapeHtml(name)}">${escapeHtml(displayOwnerName(name) + suffix)}</option>`;
  }).join("");
  input.value = options.includes(normalizedSelected) ? normalizedSelected : unassignedOwner;
}

function renderResponsibleOptions(order = {}) {
  fillResponsibleSelect(fields.fieldTech, "Levantamento de Campo", order.fieldTech ?? fields.fieldTech.value);
  fillResponsibleSelect(fields.cadist, "Criacao de CAD", order.cadist ?? fields.cadist.value);
  fillResponsibleSelect(fields.budgeter, "Orcamento", order.budgeter ?? fields.budgeter.value);
}

function renderOwnerOptions() {
  renderResponsibleOptions();
  updateHiddenOwnerFromResponsibles();
}

function applyStageLocks() {
  const stage = fields.stage.value;
  const order = orders.find((item) => item.id === fields.orderId.value) || formOrder();
  const canEditStatus = canEditOrderStatus(order);
  const locked = ["Concluido", "Rejeitado"].includes(stage);
  fields.fieldTech.disabled = locked || !canEditStatus || stage !== "Levantamento de Campo";
  fields.fieldStatus.disabled = locked || !canEditStatus || stage !== "Levantamento de Campo";
  fields.cadist.disabled = locked || !canEditStatus || !["Levantamento de Campo", "Criacao de CAD"].includes(stage);
  fields.cadStatus.disabled = locked || !canEditStatus || stage !== "Criacao de CAD";
  fields.budgeter.disabled = locked || !canEditStatus || !["Levantamento de Campo", "Criacao de CAD", "Orcamento"].includes(stage);
  fields.budgetStatus.disabled = locked || !canEditStatus || stage !== "Orcamento";
  elements.lockedSections.innerHTML = "";
  applyLimitedOrderEditLocks();
}

function selectedProcessLabels(order) {
  return processTabs.filter((process) => order[process.key]).map((process) => process.label);
}

function hasActiveProcess(order) {
  return Boolean(order?.processState?.active && hasAnyProcess(order));
}

function processReturnSnapshot(order) {
  return {
    previousStage: order.stage,
    previousOwner: order.owner || "Sem Responsavel",
    previousFieldTech: order.fieldTech || "",
    previousCadist: order.cadist || "",
    previousBudgeter: order.budgeter || order.rejectedByOwner || "",
    previousFieldStatus: order.fieldStatus || "",
    previousCadStatus: order.cadStatus || "",
    previousBudgetStatus: order.budgetStatus || ""
  };
}

function activateProcessState(order, existing = null) {
  const source = existing || order;
  const current = source.processState?.active ? source.processState : null;
  order.processState = {
    ...(current || processReturnSnapshot(source)),
    active: true,
    openedAt: current?.openedAt || new Date().toISOString(),
    openedByUser: current?.openedByUser || currentUser?.login || "sistema",
    openedByName: current?.openedByName || currentUser?.fullName || "Sistema",
    openedByCollaborator: current?.openedByCollaborator || currentCollaborator()?.name || ""
  };
  if (!current) {
    order.processOwner = "Sem Responsavel";
    order.processStatus = "Aguardando";
    order.processStartDate = "";
    order.processEndDate = "";
  }
  return order;
}

function preferredProcessOwner(order) {
  return processTabs
    .map((process) => order.processOwners?.[process.key])
    .find((owner) => owner && !isUnassignedOwner(owner))
    || (!isUnassignedOwner(order.processOwner) ? order.processOwner : "");
}

function lastBudgeterForProcessReturn(order) {
  const state = order.processState || {};
  if (state.previousBudgeter) return state.previousBudgeter;
  if (order.budgeter) return order.budgeter;
  if (order.rejectedByOwner) return order.rejectedByOwner;
  if (state.previousStage === "Orcamento" && state.previousOwner) return state.previousOwner;
  return "Sem Responsavel";
}

function restoreAfterProcess(order) {
  const state = order.processState || {};
  const budgeter = lastBudgeterForProcessReturn(order);
  return {
    ...order,
    stage: "Orcamento",
    owner: budgeter || "Sem Responsavel",
    budgeter: budgeter && budgeter !== "Sem Responsavel" ? budgeter : "",
    budgetStatus: "EM ESPERA",
    processState: { ...state, active: false, closedAt: new Date().toISOString(), closedByUser: currentUser?.login || "sistema", closedByName: currentUser?.fullName || "Sistema" },
    processStatus: "Concluido",
    processEndDate: order.processEndDate || today(),
    updatedAt: new Date().toISOString()
  };
}
function processLabelFromKey(processKey) {
  return processTabs.find((process) => process.key === processKey)?.label || "Processos";
}

function processKeyForOrder(order) {
  const activeTab = processTabs.find((process) => process.label === activeProcessTab && order?.[process.key]);
  return activeTab?.key || processTabs.find((process) => order?.[process.key])?.key || "";
}

function voiceDefinitionForProcess(processKey) {
  const voiceKey = Object.entries(processVoiceMap).find(([, mappedProcessKey]) => mappedProcessKey === processKey)?.[0] || "";
  return voiceDefinitions.find((voice) => voice.key === voiceKey) || null;
}

function processDetailsWithOwner(order, processKey, owner) {
  const details = normalizeProcessDetails(order);
  return {
    ...details,
    [processKey]: {
      ...(details[processKey] || {}),
      owners: owner || ""
    }
  };
}

function processDetailsWithConclusion(order, processKey, owner, endDate) {
  const details = normalizeProcessDetails(order);
  return {
    ...details,
    [processKey]: {
      ...(details[processKey] || {}),
      owners: owner || details[processKey]?.owners || "",
      endDate: endDate || today()
    }
  };
}

function ensureProcessVoicePoles(order, processKey) {
  const voice = voiceDefinitionForProcess(processKey);
  if (!voice) return { ok: true, order };
  const voices = normalizeVoices(order);
  const value = voices[voice.key] || { code: "", poles: "", repeat: "1x", type: "" };
  if (value.poles === "" || value.poles === null || value.poles === undefined) {
    return { ok: false, label: voice.label, order };
  }
  const nextVoices = {
    ...voices,
    [voice.key]: {
      ...value,
      code: value.code || voiceCodeFor(voice, value.poles)
    }
  };
  return { ok: true, label: voice.label, order: { ...order, voices: nextVoices } };
}

function processQueueCollaborators(processKey) {
  return processCollaborators(processKey)
    .filter((person) => person.queueActive !== false)
    .sort((a, b) => Number(a.queueOrder?.[processKey] || a.queueOrder?.Processos || a.queueOrder?.Orcamento || 999) - Number(b.queueOrder?.[processKey] || b.queueOrder?.Processos || b.queueOrder?.Orcamento || 999));
}

function lastProcessQueueOwner(processKey) {
  const section = `Processos - ${processLabelFromKey(processKey)}`;
  const entry = distributionEntries.find((item) => item.stage === section && item.type === "Automatica" && item.owner);
  return entry?.owner || "";
}

function rotateProcessQueueAfterLast(processKey, candidates) {
  const lastOwner = lastProcessQueueOwner(processKey);
  const lastIndex = candidates.findIndex((person) => person.name === lastOwner);
  if (lastIndex < 0) return candidates;
  return [...candidates.slice(lastIndex + 1), ...candidates.slice(0, lastIndex + 1)];
}

function nextAvailableProcessOwner(processKey, excludeOrderId = "", orderForAudit = null, reason = "fila automatica de processos") {
  const section = `Processos - ${processLabelFromKey(processKey)}`;
  const candidates = rotateProcessQueueAfterLast(processKey, processQueueCollaborators(processKey));
  if (!candidates.length) {
    if (orderForAudit) audit("Fila de processos sem candidatos", orderForAudit.osNumber, `${section} / Sem Responsavel`, `${section} / Sem Responsavel`, `Usuario: ${currentUser?.fullName || "Sistema"}. Motivo: nenhum colaborador ativo cadastrado para este processo.`);
    return "";
  }
  for (const person of candidates) {
    const available = isProcessCollaboratorAvailable(person.name, processKey, excludeOrderId);
    if (orderForAudit) {
      audit(
        "Verificacao de fila de processos",
        orderForAudit.osNumber,
        `${section} / Sem Responsavel`,
        `${section} / ${person.name}`,
        queueAttemptDetail(orderForAudit, section, person, available, available ? `Livre para receber. Origem: ${reason}` : "Ja possui processo ativo na baia.")
      );
    }
    if (available) return person.name;
  }
  if (orderForAudit) audit("Fila de processos sem responsavel disponivel", orderForAudit.osNumber, `${section} / Sem Responsavel`, `${section} / Sem Responsavel`, `Usuario: ${currentUser?.fullName || "Sistema"}. Motivo: todos os colaboradores da fila possuem processo ativo. A ordem permaneceu em Sem Responsavel.`);
  return "";
}

function registerProcessDistribution(order, owner, processKey) {
  if (!order || !owner || owner === "Sem Responsavel") return null;
  const entry = {
    id: newId(),
    orderId: order.id,
    osNumber: order.osNumber || "Sem numero",
    owner,
    stage: `Processos - ${processLabelFromKey(processKey)}`,
    type: "Automatica",
    date: new Date().toISOString(),
    actor: currentUser?.fullName || "Sistema"
  };
  distributionEntries = normalizeDistributionEntries([entry, ...distributionEntries]);
  lastSeenDistributionId = entry.id;
  localStorage.setItem(storeKeys.distributions, JSON.stringify(distributionEntries));
  markLatestDistribution(entry);
  showDistributionToast(entry);
  return entry;
}

function canAdvanceProcessOrder(order) {
  if (hasPermission("admin")) return true;
  const collaborator = currentCollaborator();
  const processKey = processKeyForOrder(order);
  return Boolean(collaborator && processColumnOwner(order, processKey) === collaborator.name);
}

function advanceProcessOrder(order) {
  const processKey = processKeyForOrder(order);
  const processLabel = processLabelFromKey(processKey);
  const previousProcessOwner = processKey ? processColumnOwner(order, processKey) : (order.processOwner || "Sem Responsavel");
  if (!processKey) {
    audit("Avanco de processo bloqueado", order.osNumber, "Processos", "Processos", "Motivo: nenhum tipo de processo marcado na ordem.");
    alert("Esta OS nao possui tipo de processo marcado.");
    return;
  }
  if (!isBudgetConcluded(order)) {
    const message = processBlockedUntilBudgetMessage();
    audit("Envio para Processos bloqueado", order.osNumber, order.stage || "Etapa atual", "Processos", `Usuario: ${currentUser?.fullName || "Sistema"}. Motivo: ${message}`);
    alert(message);
    return;
  }
  if (!previousProcessOwner || previousProcessOwner === "Sem Responsavel") {
    const assignedOwner = nextAvailableProcessOwner(processKey, order.id, order, "OS em Processos Sem Responsavel acionada para atribuicao");
    if (!assignedOwner) {
      alert("Nao ha colaborador de processos disponivel. A OS permanecera em Sem Responsavel.");
      return;
    }
    const processDetails = processDetailsWithOwner(order, processKey, assignedOwner);
    const updated = {
      ...order,
      processOwner: assignedOwner,
      processOwners: { ...(order.processOwners || {}), [processKey]: assignedOwner },
      processDetails,
      processStatus: "Em andamento",
      processStartDate: order.processStartDate || today(),
      updatedAt: new Date().toISOString()
    };
    orders = orders.map((item) => item.id === order.id ? updated : item);
    registerProcessDistribution(updated, assignedOwner, processKey);
    audit("Atribuicao automatica de processo", order.osNumber, `Processos - ${processLabel} / Sem Responsavel`, `Processos - ${processLabel} / ${assignedOwner}`, `Usuario: ${currentUser?.fullName || "Sistema"}. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}. Tipo de distribuicao: automatica por fila.`);
    persist();
    render();
    alert(`OS atribuida para ${assignedOwner}. Ela permanecera em Processos ate o responsavel avancar novamente.`);
    return;
  }
  if (!canAdvanceProcessOrder(order)) {
    const collaborator = currentCollaborator();
    audit("Tentativa de concluir processo bloqueada", order.osNumber, `Processos - ${processLabel} / ${previousProcessOwner}`, "Orcamento", `Usuario vinculado: ${collaborator?.name || "Sem colaborador"}. Motivo: apenas o responsavel do processo pode avancar.`);
    alert(`Apenas o responsavel ${previousProcessOwner} pode concluir este processo.`);
    return;
  }
  const voiceCheck = ensureProcessVoicePoles(order, processKey);
  if (!voiceCheck.ok) {
    const message = `Informe a quantidade de postes em ${voiceCheck.label} antes de concluir este processo.`;
    audit("Conclusao de processo bloqueada", order.osNumber, `Processos - ${processLabel} / ${previousProcessOwner}`, "Processos", message);
    alert(message);
    return;
  }
  const concludedOrder = {
    ...voiceCheck.order,
    processDetails: processDetailsWithConclusion(voiceCheck.order, processKey, previousProcessOwner, today()),
    processEndDate: voiceCheck.order.processEndDate || today(),
    processStatus: "Concluido",
    updatedAt: new Date().toISOString()
  };
  const pendingKeysAfterConclusion = pendingProcessKeysByConclusion(concludedOrder);
  const updated = pendingKeysAfterConclusion.length
    ? {
        ...concludedOrder,
        processOwner: "Sem Responsavel",
        processStatus: "Aguardando",
        updatedAt: new Date().toISOString()
      }
    : restoreAfterProcess(concludedOrder);
  orders = orders.map((item) => item.id === order.id ? updated : item);
  addHistory(order, updated, "Processos");
  if (!pendingKeysAfterConclusion.length && updated.owner && updated.owner !== "Sem Responsavel") registerDistribution(updated, updated.owner, "Orcamento", "Manual");
  audit(
    "Processo concluido",
    order.osNumber,
    `Processos - ${processLabel} / ${previousProcessOwner}`,
    pendingKeysAfterConclusion.length ? `Processos / ${unassignedLabel}` : `Orcamento / ${updated.owner || "Sem Responsavel"}`,
    `Usuario: ${currentUser?.fullName || "Sistema"}. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}. Tipo de processo concluido: ${processLabel}. Data de conclusao gravada: ${today()}. ${pendingKeysAfterConclusion.length ? `Processos ainda pendentes: ${pendingKeysAfterConclusion.map(processLabelFromKey).join(", ")}.` : `Ultimo orcamentista de retorno: ${updated.owner || "Sem Responsavel"}.`}`
  );
  persist();
  render();
}

function adequacyKeyForOrder(order) {
  const activeTab = adequacyTabs.find((process) => process.label === activeAdequacyTab && orderAdequacyTypes(order).includes(process.key));
  return activeTab?.key || orderAdequacyTypes(order).find((key) => key !== "unidentified") || "unidentified";
}

function pendingAdequacyKeys(order) {
  const statusMap = order.adequacyStatus || {};
  return orderAdequacyTypes(order)
    .filter((key) => key !== "unidentified")
    .filter((key) => normalizeStatus(statusMap[key]) !== "CONCLUIDA");
}

function concludeAdequacyOrder(order) {
  const processKey = adequacyKeyForOrder(order);
  const processLabel = processKey === "unidentified" ? "Nao Identificado" : processLabelFromKey(processKey);
  const previousOwner = adequacyColumnOwner(order, processKey);
  if (!isUnassignedOwner(previousOwner) && !hasPermission("admin")) {
    const collaborator = currentCollaborator();
    if (!collaborator || collaborator.name !== previousOwner) {
      audit("Conclusao de adequacao bloqueada", order.osNumber, `Adequacoes - ${processLabel} / ${previousOwner}`, "Processos", `Usuario vinculado: ${collaborator?.name || "Sem colaborador"}. Motivo: apenas o responsavel da adequacao pode concluir.`);
      alert(`Apenas o responsavel ${previousOwner} pode concluir esta adequacao.`);
      return;
    }
  }
  const now = new Date().toISOString();
  const nextStatus = { ...(order.adequacyStatus || {}) };
  if (processKey !== "unidentified") nextStatus[processKey] = "Concluida";
  const nextCompletedAt = { ...(order.adequacyCompletedAt || {}) };
  if (processKey !== "unidentified") nextCompletedAt[processKey] = today();
  let updated = {
    ...order,
    adequacyStatus: nextStatus,
    adequacyCompletedAt: nextCompletedAt,
    processStatus: "Aguardando",
    updatedAt: now
  };
  const remaining = pendingAdequacyKeys(updated);
  if (remaining.length) {
    updated = {
      ...updated,
      stage: "Adequacoes",
      owner: "Sem Responsavel",
      adequacyState: { ...(order.adequacyState || {}), active: true, types: orderAdequacyTypes(order), lastCompletedAt: now }
    };
  } else {
    updated = {
      ...updated,
      stage: hasPendingProcessConclusion(updated) ? "Processos" : "Concluido",
      owner: "Sem Responsavel",
      processState: hasPendingProcessConclusion(updated)
        ? { ...(updated.processState || processReturnSnapshot(order)), active: true, openedAt: updated.processState?.openedAt || now, source: "Retorno de Adequacoes" }
        : { ...(updated.processState || {}), active: false, closedAt: now },
      adequacyState: { ...(order.adequacyState || {}), active: false, closedAt: now, closedByUser: currentUser?.login || "sistema", closedByName: currentUser?.fullName || "Sistema" },
      finishDate: hasPendingProcessConclusion(updated) ? updated.finishDate : (updated.finishDate || today()),
      completedAt: hasPendingProcessConclusion(updated) ? updated.completedAt : (updated.completedAt || now)
    };
  }
  orders = orders.map((item) => item.id === order.id ? updated : item);
  addHistory(order, updated, "Adequacoes");
  audit(
    "Adequacao concluida",
    order.osNumber,
    `Adequacoes - ${processLabel} / ${displayOwnerName(previousOwner)}`,
    `${updated.stage} / ${displayOwnerName(updated.owner || unassignedOwner)}`,
    `Usuario: ${currentUser?.fullName || "Sistema"}. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}. Processo corrigido: ${processLabel}. ${remaining.length ? `Adequacoes pendentes: ${remaining.map(processLabelFromKey).join(", ")}.` : "Todas as adequacoes foram concluidas."}`
  );
  persist();
  render();
}

function normalizeProcessFields(order, existing = null) {
  const labels = selectedProcessLabels(order);
  const wasActive = Boolean(existing?.processState?.active);
  const isNewOrder = !existing;
  const hasNewProcess = processTabs.some((process) => order[process.key] && !existing?.[process.key]);
  const wasClosed = Boolean(existing?.processState && existing.processState.active === false);
  const canEnterProcesses = isBudgetConcluded(order);
  order.processType = labels.join(" / ");
  if (labels.length && !canEnterProcesses) {
    if (!wasActive) order.processState = existing?.processState?.active ? existing.processState : null;
    order.processStatus = order.processStatus || "Aguardando";
  } else if (labels.length && (!wasClosed || hasNewProcess) && (isNewOrder || wasActive || hasNewProcess || !existing?.processState)) {
    activateProcessState(order, existing);
    const owner = preferredProcessOwner(order);
    if (owner) {
      order.processOwner = owner;
      order.processStatus = "Em andamento";
      order.processStartDate = order.processStartDate || today();
    }
  } else if (labels.length && existing?.processState) {
    order.processState = existing.processState;
  }
  if (!labels.length) {
    order.processOwner = "Sem Responsavel";
    order.processStatus = "Aguardando";
    order.processStartDate = "";
    order.processEndDate = "";
    order.processNotes = "";
    order.processLink = "";
    order.processFiles = "";
    order.processState = null;
  }
  if (labels.length && wasActive && normalizeStatus(order.processStatus) === "CONCLUIDO") {
    return restoreAfterProcess(order);
  }
  return order;
}

function auditProcessFieldChanges(before, after) {
  if (!before) return;
  const fieldsToTrack = [
    ["Tipo de processo", "processType"],
    ["Responsavel do processo", "processOwner"],
    ["Status do processo", "processStatus"],
    ["Data inicio processo", "processStartDate"],
    ["Data conclusao processo", "processEndDate"],
    ["Observacoes processo", "processNotes"],
    ["Link processo", "processLink"],
    ["Fotos/documentos processo", "processFiles"],
    ...processTabs.map((process) => [process.label, process.key])
  ];
  fieldsToTrack.forEach(([label, key]) => {
    const oldValue = before[key] ?? "";
    const newValue = after[key] ?? "";
    if (String(oldValue) !== String(newValue)) {
      audit("Alteracao em Dados de Processos", after.osNumber || before.osNumber, `${label}: ${oldValue || "-"}`, `${label}: ${newValue || "-"}`, `Campo alterado: ${label}. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}.`);
    }
  });
}

function auditResponsibleFieldChanges(before, after) {
  if (!before) return;
  [
    ["Tecnico", "fieldTech"],
    ["Cadista", "cadist"],
    ["Orcamentista", "budgeter"]
  ].forEach(([label, key]) => {
    const oldOwner = normalizeOwnerValue(before[key]);
    const newOwner = normalizeOwnerValue(after[key]);
    if (oldOwner !== newOwner) {
      audit(
        "Alteracao manual de responsavel",
        after.osNumber || before.osNumber,
        `${label}: ${displayOwnerName(oldOwner)}`,
        `${label}: ${displayOwnerName(newOwner)}`,
        `Etapa da ordem: ${after.stage}. Motivo: alteracao manual de responsavel. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}.`
      );
    }
  });
}

function auditVoiceChanges(before, after) {
  if (!before) return;
  const beforeVoices = normalizeVoices(before);
  const afterVoices = normalizeVoices(after);
  voiceDefinitions.forEach((voice) => {
    const oldValue = beforeVoices[voice.key];
    const newValue = afterVoices[voice.key];
    const oldText = `${oldValue.type || ""}|${oldValue.poles || ""}|${oldValue.code || ""}|${oldValue.repeat || "1x"}`;
    const newText = `${newValue.type || ""}|${newValue.poles || ""}|${newValue.code || ""}|${newValue.repeat || "1x"}`;
    if (oldText !== newText) {
      const action = !oldValue.code && newValue.code ? "Inclusao de VOZ" : oldValue.code && !newValue.code ? "Remocao de VOZ" : "Edicao de VOZ";
      audit(
        action,
        after.osNumber || before.osNumber,
        `${voice.label}: ${oldValue.code || "-"} / ${oldValue.poles || 0} postes / ${oldValue.repeat || "1x"}`,
        `${voice.label}: ${newValue.code || "-"} / ${newValue.poles || 0} postes / ${newValue.repeat || "1x"}`,
        `Tipo da VOZ: ${voice.label}. Quantidade de postes: ${newValue.poles || 0}. Codigo gerado: ${newValue.code || "-"}. Repeticoes: ${newValue.repeat || "1x"}. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}.`
      );
    }
  });
}

function auditProcessDetailChanges(before, after) {
  if (!before) return;
  const beforeDetails = normalizeProcessDetails(before);
  const afterDetails = normalizeProcessDetails(after);
  processTabs.forEach((process) => {
    const oldValue = beforeDetails[process.key] || {};
    const newValue = afterDetails[process.key] || {};
    const oldText = `${oldValue.owners || ""}|${oldValue.endDate || ""}|${oldValue.notes || ""}`;
    const newText = `${newValue.owners || ""}|${newValue.endDate || ""}|${newValue.notes || ""}`;
    if (oldText !== newText) {
      audit(
        "Edicao de dados de processo",
        after.osNumber || before.osNumber,
        `${process.label}: Responsavel ${oldValue.owners || "-"} / Conclusao ${oldValue.endDate || "-"} / Obs ${oldValue.notes || "-"}`,
        `${process.label}: Responsavel ${newValue.owners || "-"} / Conclusao ${newValue.endDate || "-"} / Obs ${newValue.notes || "-"}`,
        `Processo: ${process.label}. Usuario: ${currentUser?.fullName || "Sistema"}. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}.`
      );
    }
  });
}

function hasManualProcessRoutingSelection(order = {}) {
  return [order.fieldTech, order.cadist, order.budgeter].some((value) => importedStatus(value) === processRoutingOption);
}

function manualProcessKeys(order = {}) {
  return processTabs
    .filter((process) => !["processEvaluation", "processOnlyCompleted"].includes(process.key))
    .filter((process) => Boolean(order[process.key]))
    .map((process) => process.key);
}

function applyManualProcessRouting(order, existing = null) {
  if (!hasManualProcessRoutingSelection(order)) return order;
  const keys = manualProcessKeys(order);
  if (!keys.length) {
    return { ...order, _manualProcessRoutingError: true };
  }
  const now = new Date().toISOString();
  const source = existing || order;
  return {
    ...order,
    _manualProcessRouting: true,
    stage: "Processos",
    owner: unassignedOwner,
    fieldTech: "",
    cadist: "",
    budgeter: "",
    fieldStatus: processRoutingOption,
    cadStatus: processRoutingOption,
    budgetStatus: processRoutingOption,
    processExclusive: true,
    processOwner: unassignedOwner,
    processStatus: "NAO TRATADO",
    processStartDate: "",
    processState: {
      ...(source.processState?.active ? source.processState : processReturnSnapshot(source)),
      active: true,
      openedAt: source.processState?.openedAt || now,
      openedByUser: currentUser?.login || "sistema",
      openedByName: currentUser?.fullName || "Sistema",
      openedByCollaborator: currentCollaborator()?.name || "",
      source: "Selecao manual PROCESSOS em responsavel"
    },
    updatedAt: now
  };
}

function formOrder() {
  const base = orders.find((order) => order.id === fields.orderId.value);
  const order = makeOrder(base || {});
  Object.entries(fields).forEach(([key, input]) => {
    if (key === "orderId") return;
    order[key] = input.type === "checkbox" ? input.checked : input.value;
  });
  const generatedSharePointLink = sharePointLinkForOrder(order.osNumber);
  if (generatedSharePointLink && (!order.filesLink || isAutoSharePointOrderLink(order.filesLink))) {
    order.filesLink = generatedSharePointLink;
  }
  order.ans = calculatedAnsValue(order.receivedDate);
  order.voices = currentVoiceValues();
  order.processDetails = currentProcessDetails();
  const firstProcessDetail = Object.values(order.processDetails)[0] || {};
  order.processOwner = firstProcessDetail.owners || order.processOwner || "Sem Responsavel";
  order.processEndDate = firstProcessDetail.endDate || order.processEndDate || "";
  order.processNotes = firstProcessDetail.notes || order.processNotes || "";
  order.owner = ownerFromOrderResponsibles(order);
  order.id = fields.orderId.value || order.id;
  order.priority = priorityByAnsDays(daysSince(order.receivedDate));
  normalizeProcessFields(order, base || null);
  Object.assign(order, applyManualProcessRouting(order, base || null));
  order.updatedAt = new Date().toISOString();
  return order;
}

function saveOrder(event) {
  event.preventDefault();
  const editingExisting = Boolean(fields.orderId.value);
  if (editingExisting) {
    if (!canSaveExistingOrder()) {
      alert("Voce nao tem permissao para salvar esta OS.");
      audit("Acesso bloqueado", fields.osNumber?.value || "", "", "Permissao necessaria: limitedOrderEdit");
      return;
    }
  } else if (!requirePermission("createOrder")) {
    return;
  }
  let order = formOrder();
  const existing = orders.find((item) => item.id === order.id);
  if (order._manualProcessRoutingError) {
    alert("Para enviar diretamente para Processos, marque ao menos um processo complementar na ordem.");
    audit("Envio manual para Processos bloqueado", order.osNumber || fields.osNumber.value, existing ? summarizeOrder(existing) : "-", "Processos", "Motivo: PROCESSOS foi selecionado em Tecnico/Cadista/Orcamentista, mas nenhum processo complementar foi marcado.");
    return;
  }
  if (fields.orderId.value && !existing) {
    alert("Nao foi possivel salvar: esta ordem nao foi encontrada no banco carregado. Atualize a pagina antes de tentar novamente.");
    audit("Edicao de ordem bloqueada", order.osNumber || fields.osNumber.value, "", "", "Motivo: tentativa de editar uma ordem que nao existe no estado carregado. Salvamento cancelado para evitar perda de dados.");
    return;
  }
  if (!cleanOrderNumber(order.osNumber)) {
    alert("Nao foi possivel salvar: a ordem precisa ter numero de OS.");
    audit("Edicao de ordem bloqueada", order.osNumber || "", "", "", "Motivo: numero da OS vazio. Salvamento cancelado para evitar perda de dados.");
    return;
  }
  if (existing && !hasPermission("editOrder") && hasPermission("limitedOrderEdit")) {
    order = mergeLimitedOrderEdit(existing, order);
    if ((existing.clientName || "") !== (order.clientName || "")) {
      audit("Edicao limitada de cliente", order.osNumber, existing.clientName || "-", order.clientName || "-", `Usuario: ${currentUser?.fullName || "Sistema"}. Nivel minimo autorizado: 31.`);
    }
    auditVoiceChanges(existing, order);
    orders = orders.map((item) => item.id === order.id ? order : item);
    audit("Edicao limitada de ordem", order.osNumber, summarizeOrder(existing), summarizeOrder(order), "Campos permitidos: Cliente e quantidade de postes das VOZES.");
    persist();
    elements.modal.close();
    render();
    return;
  }
  if (order.stage === "Processos" && !canEnterProcesses(order) && !order._manualProcessRouting) {
    const message = processBlockedUntilBudgetMessage();
    audit("Envio para Processos bloqueado", order.osNumber, existing?.stage || order.stage || "-", "Processos", `Usuario: ${currentUser?.fullName || "Sistema"}. Motivo: ${message}`);
    alert(message);
    return;
  }
  auditProcessFieldChanges(existing, order);
  auditProcessDetailChanges(existing, order);
  auditResponsibleFieldChanges(existing, order);
  auditVoiceChanges(existing, order);
  if (existing?.processState?.active && order.processState && order.processState.active === false) {
    audit("Processo concluido", order.osNumber, `${existing.processType || "Processo"} / ${existing.processOwner || "Sem Responsavel"}`, `${order.stage} / ${order.owner || "Sem Responsavel"}`, `Ordem retornou ao fluxo apos conclusao do processo. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}.`);
  }
  if (existing && !canEditOrderStatus(existing) && statusChanged(existing, order)) {
    alert("Apenas o usuario vinculado ao responsavel desta OS pode alterar o status.");
    audit("Alteracao de status bloqueada", existing.osNumber, summarizeOrder(existing), summarizeOrder(order), "Usuario nao vinculado ao responsavel da OS.");
    return;
  }
  let releasedStage = "";
  if (existing && existing.stage !== "Concluido" && order.stage === "Concluido") {
    if (existing.stage === "Orcamento") order.budgetStatus = "CONCLUIDO";
    if (blockConclusionIfMissingVoices(order)) return;
    Object.assign(order, markCompletedOrder(order, existing.stage));
  }
  if (existing && existing.stage !== "Rejeitado" && order.stage === "Rejeitado") {
    order.rejectedAt = order.rejectedAt || new Date().toISOString();
    order.rejectedByOwner = existing.owner && existing.owner !== "Sem Responsavel" ? existing.owner : currentCollaborator()?.name || "";
    order.rejectedByUser = currentUser?.login || "sistema";
    order.rejectedByName = currentUser?.fullName || "Sistema";
  }
  if (existing && (existing.stage !== order.stage || existing.owner !== order.owner)) {
    addHistory(existing, order, "Edicao manual");
    if (order.owner && order.owner !== "Sem Responsavel") {
      const type = existing.stage === "Orcamento" && order.stage === "Criacao de CAD" ? "Retorno do orcamento para CAD" : "Manual";
      registerDistribution(order, order.owner, order.stage, type);
    }
  }
  if (order._manualProcessRouting) {
    audit(
      "Envio manual direto para Processos",
      order.osNumber,
      existing ? `${existing.stage} / ${displayOwnerName(existing.owner)}` : "Nova OS",
      `Processos / ${unassignedLabel}`,
      `Comando PROCESSOS selecionado em Tecnico/Cadista/Orcamentista. Processos marcados: ${manualProcessKeys(order).map(processLabelFromKey).join(", ")}. Campo, CAD e Orcamento foram limpos para evitar duplicidade.`
    );
  }
  if (!existing && order.owner && order.owner !== "Sem Responsavel") registerDistribution(order, order.owner, order.stage, "Manual");
  if (existing && existing.owner && existing.owner !== "Sem Responsavel" && statusReleasedCollaborator(existing, order)) {
    releasedStage = existing.stage;
  }
  delete order._manualProcessRouting;
  delete order._manualProcessRoutingError;
  orders = existing ? orders.map((item) => item.id === order.id ? order : item) : [order, ...orders];
  audit(existing ? "Edicao de ordem" : "Criacao de ordem", order.osNumber, existing ? summarizeOrder(existing) : "", summarizeOrder(order));
  persist();
  elements.modal.close();
  if (releasedStage) redistributeWaitingOrders(releasedStage);
  else render();
}

function statusChanged(before, after) {
  return before.fieldStatus !== after.fieldStatus
    || before.cadStatus !== after.cadStatus
    || before.budgetStatus !== after.budgetStatus;
}

function moveToNextStage(id) {
  const order = orders.find((item) => item.id === id);
  if (!order) return;
  if (hasPendency(order, "Suspender")) {
    audit("Tentativa de avanÃƒÂ§o bloqueada", order.osNumber, order.stage, "Proxima etapa", "Motivo: OS suspensa por pendencia.");
    alert("Esta OS esta suspensa. Remova a pendencia 'Suspender' antes de avanÃƒÂ§ar.");
    return;
  }
  if (order.pendencyState?.active) {
    audit("Tentativa de avanÃƒÂ§o bloqueada", order.osNumber, order.stage, "Proxima etapa", "Motivo: OS paralisada na aba Pendencias.");
    alert("Esta OS esta na aba Pendencias. Resolva todas as pendencias antes de avanÃƒÂ§ar.");
    return;
  }
  if (isAdequacyOpen(order)) {
    concludeAdequacyOrder(order);
    return;
  }
  if (order.processState?.active && order.stage === "Processos") {
    advanceProcessOrder(order);
    return;
  }
  if (order.stage === "Rejeitado") {
    const candidate = { ...order, stage: "Concluido", budgetStatus: order.budgetStatus || "CONCLUIDO" };
    if (blockConclusionIfMissingVoices(candidate)) return;
    const updated = markCompletedOrder({
      ...order,
      stage: "Concluido",
      finishDate: order.finishDate || today(),
      rejectionResolvedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, "Rejeitado");
    orders = orders.map((item) => item.id === id ? updated : item);
    audit(
      "RejeiÃƒÂ§ÃƒÂ£o concluÃƒÂ­da",
      order.osNumber,
      `${order.stage} / ${order.owner || "Sem Responsavel"}`,
      `${updated.stage} / ${updated.owner || "Sem Responsavel"}`,
      `Ordem retornou para Concluido apos correcao. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}`
    );
    persist();
    render();
    return;
  }

  const index = stages.indexOf(order.stage);
  const nextStage = stages[Math.min(index + 1, stages.length - 1)];

  if (order.stage === "Levantamento de Campo" && nextStage === "Criacao de CAD") {
    const now = new Date().toISOString();
    const fromFieldLane = fieldLaneStatus(order);
    const remoteDirectToCad = Boolean(order.remoteOrder && fromFieldLane === "Remoto");
    const updated = {
      ...moveOrderIntoQueueStage(order, nextStage),
      remoteEvaluated: fromFieldLane === "Remoto" ? true : order.remoteEvaluated,
      remoteEvaluatedAt: fromFieldLane === "Remoto" ? (order.remoteEvaluatedAt || now) : order.remoteEvaluatedAt,
      remoteEvaluationDestination: fromFieldLane === "Remoto" ? nextStage : order.remoteEvaluationDestination,
      remoteFastTrack: remoteDirectToCad ? true : order.remoteFastTrack,
      remoteFastTrackAt: remoteDirectToCad ? (order.remoteFastTrackAt || now) : order.remoteFastTrackAt,
      updatedAt: now
    };
    orders = orders.map((item) => item.id === id ? updated : item);
    audit(
      "Movimentacao Campo para CAD",
      order.osNumber,
      `${order.stage} / ${order.owner || "Sem Responsavel"}`,
      `${updated.stage} / ${displayOwnerName(updated.owner)}`,
      `${isUnassignedOwner(updated.owner) ? "Entrada inicial em Sem Responsavel. Tipo de distribuicao: automatica por fila." : `Cadista antecipado atribuido: ${updated.owner}. Fila automatica ignorada.`} Usuario: ${currentUser?.fullName || "Sistema"}. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}.`
    );
    if (fromFieldLane === "Remoto") {
      audit(
        "Avaliacao remota concluida",
        order.osNumber,
        "Remoto",
        nextStage,
        `Saida da baia Remoto em ${new Date(now).toLocaleString("pt-BR")}. Destino apos avaliacao: ${nextStage}.`
      );
    }
    if (remoteDirectToCad) {
      audit(
        "Identificacao visual de ordem remota",
        order.osNumber,
        "Sem borda remota",
        "Borda magenta",
        "Ordem importada como remota saiu diretamente de Levantamento de Campo para Criacao de CAD."
      );
    }
    if (isUnassignedOwner(updated.owner)) distributeNextWaitingOrder(nextStage, "entrada em CAD apos Levantamento de Campo", id);
    else registerDistribution(updated, updated.owner, nextStage, "Manual");
    persist();
    render();
    return;
  }

  if (order.stage === "Concluido" && nextStage === "Rejeitado") {
    const updated = {
      ...order,
      stage: "Rejeitado",
      owner: order.owner || "Sem Responsavel",
      rejectedAt: new Date().toISOString(),
      rejectedByOwner: order.owner && order.owner !== "Sem Responsavel" ? order.owner : currentCollaborator()?.name || "",
      rejectedByUser: currentUser?.login || "sistema",
      rejectedByName: currentUser?.fullName || "Sistema",
      updatedAt: new Date().toISOString()
    };
    orders = orders.map((item) => item.id === id ? updated : item);
    audit(
      "MovimentaÃƒÂ§ÃƒÂ£o para Rejeitado",
      order.osNumber,
      `${order.stage} / ${order.owner || "Sem Responsavel"}`,
      `${updated.stage} / ${updated.owner || "Sem Responsavel"}`,
      `Ordem concluida rejeitada para correcao. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}`
    );
    persist();
    render();
    return;
  }

  if (!order.owner || order.owner === "Sem Responsavel") {
    const assignedOwner = nextAvailableOwner(order.stage, id, order, "OS em Sem Responsavel acionada para atribuicao");
    if (!assignedOwner) {
      const message = `Nao ha ${queueRoleLabel(order.stage)} disponivel para ${order.stage}.`;
      audit("Tentativa de avanÃƒÂ§o bloqueada", order.osNumber, order.stage, nextStage, `Responsavel atual: Sem Responsavel. Motivo: ${message}`);
      alert(message);
      return;
    }

    const updated = { ...order, owner: assignedOwner, updatedAt: new Date().toISOString() };
    orders = orders.map((item) => item.id === id ? updated : item);
    registerDistribution(updated, assignedOwner, order.stage, "Automatica");
    audit("AtribuiÃƒÂ§ÃƒÂ£o automÃƒÂ¡tica", order.osNumber, "Sem Responsavel", assignedOwner, `Etapa atual: ${order.stage}. Proxima etapa pretendida: ${nextStage}. Motivo: proximo responsavel disponivel na fila.`);
    persist();
    render();
    alert(`OS atribuida para ${assignedOwner}. Ela permanecera em ${order.stage} ate o responsavel avancar a etapa.`);
    return;
  }

  if (!canAdvanceOrder(order)) {
    const collaborator = currentCollaborator();
    const message = `Apenas o responsavel ${order.owner} pode avancar esta OS.`;
    audit("Tentativa de avanÃƒÂ§o bloqueada", order.osNumber, order.stage, nextStage, `Responsavel atual: ${order.owner}. Usuario vinculado: ${collaborator?.name || "Sem colaborador"}. Motivo: usuario nao e o responsavel.`);
    alert(message);
    return;
  }

  if (nextStage === order.stage) return;
  let updated = ["Criacao de CAD", "Orcamento"].includes(nextStage)
    ? moveOrderIntoQueueStage(order, nextStage)
    : { ...order, stage: nextStage, updatedAt: new Date().toISOString() };
  if (nextStage === "Concluido") {
    if (order.stage === "Orcamento") updated.budgetStatus = "CONCLUIDO";
    if (blockConclusionIfMissingVoices(updated)) return;
    updated = markCompletedOrder(updated, order.stage);
  }
  addHistory(order, updated, "Sistema");
  orders = orders.map((item) => item.id === id ? updated : item);
  if (["Criacao de CAD", "Orcamento"].includes(nextStage)) {
    audit(
      "Entrada em fila de etapa",
      order.osNumber,
      `${order.stage} / ${order.owner || "Sem Responsavel"}`,
      `${nextStage} / ${displayOwnerName(updated.owner)}`,
      isUnassignedOwner(updated.owner)
        ? "Entrada inicial em Sem Responsavel. Tipo de distribuicao: automatica por fila."
        : `Responsavel antecipado atribuido: ${updated.owner}. Fila automatica ignorada.`
    );
    if (isUnassignedOwner(updated.owner)) distributeNextWaitingOrder(nextStage, `entrada em ${nextStage}`, id);
    else registerDistribution(updated, updated.owner, nextStage, "Manual");
  }
  persist();
  render();
}

function isOrderActiveForQueue(order) {
  return activeQueueStatuses.includes(normalizeStatus(stageStatus(order)));
}

function processKeyFromLabel(label) {
  return processTabs.find((process) => process.label === label || process.key === label)?.key || "";
}

function isProcessActiveOrder(order) {
  return Boolean(order.processState?.active)
    && !order.pendencyState?.active
    && !releaseQueueStatuses.includes(normalizeStatus(order.processStatus || stageStatus(order)));
}

function isProcessCollaboratorAvailable(owner, processKey, excludeOrderId = "") {
  if (!processKey) return true;
  return !orders.some((order) => order.id !== excludeOrderId
    && (order.processOwner || "Sem Responsavel") === owner
    && order[processKey]
    && isProcessActiveOrder(order));
}

function canAssignOwnerToContext(order, owner, contextStage) {
  if (isUnassignedOwner(owner)) return true;
  const processKey = processKeyFromLabel(contextStage);
  if (processKey) return isProcessCollaboratorAvailable(owner, processKey, order.id);
  if (["Criacao de CAD", "Orcamento"].includes(order.stage)) return isCollaboratorAvailable(owner, order.stage, order.id);
  return true;
}
function moveOrderIntoQueueStage(order, nextStage) {
  const plannedOwner = plannedOwnerForStage(order, nextStage);
  const updated = {
    ...order,
    stage: nextStage,
    owner: plannedOwner || unassignedOwner,
    updatedAt: new Date().toISOString()
  };
  if (nextStage === "Criacao de CAD") {
    updated.cadist = plannedOwner || "";
    updated.cadStatus = plannedOwner ? (updated.cadStatus === "NAO TRATADO" ? "EM ESPERA" : (updated.cadStatus || "EM ESPERA")) : (updated.cadStatus || "NAO TRATADO");
  }
  if (nextStage === "Orcamento") {
    updated.budgeter = plannedOwner || "";
    updated.budgetStatus = plannedOwner ? (updated.budgetStatus === "NAO TRATADO" ? "EM ESPERA" : (updated.budgetStatus || "EM ESPERA")) : (updated.budgetStatus || "NAO TRATADO");
  }
  return updated;
}

function distributeNextWaitingOrder(stage, reason = "fila automatica", preferredOrderId = "") {
  const waiting = orders
    .filter((order) => order.stage === stage && (!order.owner || order.owner === "Sem Responsavel"))
    .sort((a, b) => {
      if (preferredOrderId && a.id === preferredOrderId) return -1;
      if (preferredOrderId && b.id === preferredOrderId) return 1;
      return deadlineInfo(b).rank - deadlineInfo(a).rank || daysSince(b.receivedDate) - daysSince(a.receivedDate);
    });
  const order = waiting[0];
  if (!order) return false;
  const owner = nextAvailableOwner(stage, order.id, order, reason);
  if (!owner) return false;
  const field = stageResponsibleField(stage);
  const updated = {
    ...order,
    owner,
    [field]: owner,
    priority: priorityByAnsDays(daysSince(order.receivedDate)),
    updatedAt: new Date().toISOString()
  };
  orders = orders.map((item) => item.id === order.id ? updated : item);
  registerDistribution(updated, owner, stage, "Automatica");
  audit("Atribuicao automatica por fila", order.osNumber, `${stage} / Sem Responsavel`, `${stage} / ${owner}`, `Tipo: automatica por fila. Motivo: ${reason}.`);
  return true;
}
function clickedUserPreferredOwner(stage, excludeOrderId = "") {
  const collaborator = currentCollaborator();
  if (!collaborator) return "";
  const authorized = collaborator.stages.includes(stage);
  const available = isCollaboratorAvailable(collaborator.name, stage, excludeOrderId);
  return authorized && available ? collaborator.name : "";
}

function canAdvanceOrder(order) {
  if (hasPermission("admin")) return true;
  const collaborator = currentCollaborator();
  return Boolean(collaborator && order.owner === collaborator.name);
}

function queueRoleLabel(stage) {
  if (stage === "Criacao de CAD") return "cadista";
  if (stage === "Orcamento") return "orcamentista";
  if (stage === "Levantamento de Campo") return "tecnico de campo";
  return "responsavel";
}

function canManualAssignOrders() {
  return hasPermission("manualAssign");
}

function dropContextStage(contextStage, order) {
  if (stages.includes(contextStage)) return contextStage;
  if (processTabs.some((process) => process.label === contextStage || process.key === contextStage)) return order.stage;
  return order.stage;
}

function applyManualOwnerFields(order, owner, targetStage) {
  const targetOwner = owner || "Sem Responsavel";
  const updated = { ...order, stage: targetStage, owner: targetOwner, updatedAt: new Date().toISOString() };
  const field = stageResponsibleField(targetStage);
  if (field !== "owner") updated[field] = targetOwner === "Sem Responsavel" ? "" : targetOwner;
  if (targetStage === "Criacao de CAD" && !updated.cadStatus) updated.cadStatus = "EM ESPERA";
  if (targetStage === "Orcamento" && !updated.budgetStatus) updated.budgetStatus = "EM ESPERA";
  if (targetStage === "Levantamento de Campo" && (!updated.fieldStatus || (fieldLaneStatus(updated) === "Remoto" && (updated.remoteEvaluated || updated.remoteFastTrack)))) updated.fieldStatus = "Roteirizacao";
  return updated;
}

async function assignOwner(id, owner, contextStage = "") {
  if (movingOrderIds.has(id)) return;
  const targetOwner = normalizeOwnerValue(owner || unassignedOwner);
  if (!canDropOnColumn(targetOwner, contextStage) && !requirePermission("manualAssign")) return;
  const order = orders.find((item) => item.id === id);
  if (!order) return;

  const previousSnapshot = cloneStateSnapshot();
  const processKey = processKeyFromLabel(contextStage || "");
  const previousOwner = processKey ? (order.processOwners?.[processKey] || order.processOwner || unassignedOwner) : (order.owner || unassignedOwner);
  if (processKey && !isBudgetConcluded(order)) {
    const message = processBlockedUntilBudgetMessage();
    audit("Envio para Processos bloqueado", order.osNumber, contextStage || "Processos", `${contextStage || "Processos"} / ${displayOwnerName(targetOwner)}`, `Usuario: ${currentUser?.fullName || "Sistema"}. Motivo: ${message}`);
    alert(message);
    return;
  }
  if (processKey && processColumnOwner(order, processKey) === targetOwner) return;
  const targetStage = processKey ? order.stage : dropContextStage(contextStage || order.stage, order);
  if (!processKey && normalizeOwnerValue(order.owner) === targetOwner && order.stage === targetStage) return;

  movingOrderIds.add(id);
  try {
    if (processKey) {
      const updated = {
        ...order,
        processOwners: { ...(order.processOwners || {}), [processKey]: targetOwner },
        processOwner: targetOwner,
        processStatus: isUnassignedOwner(targetOwner) ? (order.processStatus || "Aguardando") : "Em andamento",
        processStartDate: isUnassignedOwner(targetOwner) ? order.processStartDate : (order.processStartDate || today()),
        updatedAt: new Date().toISOString()
      };
      orders = orders.map((item) => item.id === id ? updated : item);
      protectMovedOrder(updated);
      audit(
        "Atribuicao manual por arrastar",
        order.osNumber,
        `${contextStage} / ${displayOwnerName(previousOwner)}`,
        `${contextStage} / ${displayOwnerName(updated.processOwners?.[processKey] || updated.processOwner)}`,
        `Usuario: ${currentUser?.fullName || "Sistema"}. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}. Etapa: Processos. Tipo de movimentacao: Drag and Drop manual.`
      );
      render();
      await persistStrict();
      return;
    }

    if (!requirePermission("manualAssign")) return;
    const updated = applyManualOwnerFields(order, targetOwner, targetStage);
    orders = orders.map((item) => item.id === id ? updated : item);
    protectMovedOrder(updated);
    audit(
      "Atribuicao manual por arrastar",
      order.osNumber,
      `${order.stage} / ${displayOwnerName(previousOwner)}`,
      `${updated.stage} / ${displayOwnerName(updated.owner)}`,
      `Usuario: ${currentUser?.fullName || "Sistema"}. Colaborador vinculado: ${currentCollaborator()?.name || "Sem colaborador"}. Etapa: ${updated.stage}. Tipo de movimentacao: Drag and Drop manual.`
    );
    if (!isUnassignedOwner(targetOwner)) registerDistribution(updated, targetOwner, updated.stage, "Manual");
    render();
    await persistStrict();
  } catch (error) {
    releaseProtectedOrder(id);
    restoreSnapshot(previousSnapshot);
    console.error(error);
    alert("Nao foi possivel salvar a movimentacao no banco de dados. A ordem voltou para o local anterior.");
  } finally {
    movingOrderIds.delete(id);
    render();
  }
}
function nextAvailableOwner(stage, excludeOrderId = "", orderForAudit = null, reason = "fila automatica") {
  const candidates = rotateQueueAfterLast(stage, queueCollaborators(stage));
  if (!candidates.length) {
    if (orderForAudit) audit("Fila automatica sem candidatos", orderForAudit.osNumber, `${stage} / Sem Responsavel`, `${stage} / Sem Responsavel`, `Etapa: ${stage}. Usuario: ${currentUser?.fullName || "Sistema"}. Motivo: nenhum colaborador ativo cadastrado na fila.`);
    return "";
  }
  for (const person of candidates) {
    const available = isCollaboratorAvailable(person.name, stage, excludeOrderId);
    if (orderForAudit) {
      audit(
        "Verificacao de fila automatica",
        orderForAudit.osNumber,
        `${stage} / Sem Responsavel`,
        `${stage} / ${person.name}`,
        queueAttemptDetail(orderForAudit, stage, person, available, available ? `Livre para receber. Origem: ${reason}` : "Ja possui ordem ativa na baia.")
      );
    }
    if (available) return person.name;
  }
  if (orderForAudit) {
    audit(
      "Fila automatica sem responsavel disponivel",
      orderForAudit.osNumber,
      `${stage} / Sem Responsavel`,
      `${stage} / Sem Responsavel`,
      `Etapa: ${stage}. Usuario: ${currentUser?.fullName || "Sistema"}. Motivo: todos os colaboradores da fila possuem ordem ativa. A ordem permaneceu em Sem Responsavel.`
    );
  }
  return "";
}

function isCollaboratorAvailable(owner, stage, excludeOrderId = "") {
  return !orders.some((order) => {
    if (order.id === excludeOrderId) return false;
    return order.stage === stage
      && order.owner === owner
      && !order.pendencyState?.active
      && isOrderActiveForQueue(order);
  });
}

function redistributeWaitingOrders(stage) {
  if (movingOrderIds.size) return;
  const changed = distributeNextWaitingOrder(stage, "colaborador liberado e OS aguardando fila");
  if (changed) {
    persist();
    render();
  }
}

function statusReleasedCollaborator(before, after) {
  const beforeStatus = normalizeStatus(stageStatus(before));
  const afterStatus = normalizeStatus(stageStatus(after));
  return activeQueueStatuses.includes(beforeStatus) && releaseQueueStatuses.includes(afterStatus);
}

function addHistory(before, after, user) {
  const oldValue = `${before.stage} / ${before.owner || "Sem Responsavel"}`;
  const newValue = `${after.stage} / ${after.owner || "Sem Responsavel"}`;
  audit(user === "Drag and drop" ? "AlteraÃƒÂ§ÃƒÂ£o de responsÃƒÂ¡vel" : "MovimentaÃƒÂ§ÃƒÂ£o entre etapas", after.osNumber || before.osNumber, oldValue, newValue);
}

function nextOsNumber() {
  const numbers = orders.map((order) => Number(String(order.osNumber).replace(/\D/g, ""))).filter(Boolean);
  return `OS-${String((Math.max(1000, ...numbers) + 1)).padStart(4, "0")}`;
}

function saveCollaborator(event) {
  event.preventDefault();
  if (!requirePermission("admin")) return;
  const selectedStages = [...document.querySelectorAll("input[name='permission']:checked")].map((input) => input.value);
  const selectedProcesses = [...document.querySelectorAll("input[name='processPermission']:checked")].map((input) => input.value);
  const person = {
    id: elements.collaboratorId.value || newId(),
    name: elements.collaboratorName.value.trim(),
    stages: selectedStages,
    processes: selectedProcesses,
    queueActive: elements.queueActive.checked,
    queueOrder: {
      "Levantamento de Campo": Number(elements.queueCampo.value || 1),
      "Criacao de CAD": Number(elements.queueCad.value || 1),
      "Orcamento": Number(elements.queueOrcamento.value || 1)
    }
  };
  collaborators = collaborators.some((item) => item.id === person.id)
    ? collaborators.map((item) => item.id === person.id ? person : item)
    : [person, ...collaborators];
  elements.collaboratorForm.reset();
  elements.collaboratorId.value = "";
  elements.queueActive.checked = true;
  persist();
  audit("AlteraÃƒÂ§ÃƒÂ£o administrativa", "", "", `Colaborador ${person.name}`);
  render();
}

function editCollaborator(id) {
  const person = collaborators.find((item) => item.id === id);
  if (!person) return;
  elements.collaboratorId.value = person.id;
  elements.collaboratorName.value = person.name;
  elements.queueCampo.value = person.queueOrder?.["Levantamento de Campo"] || 1;
  elements.queueCad.value = person.queueOrder?.["Criacao de CAD"] || 1;
  elements.queueOrcamento.value = person.queueOrder?.["Orcamento"] || 1;
  elements.queueActive.checked = person.queueActive !== false;
  document.querySelectorAll("input[name='permission']").forEach((input) => {
    input.checked = person.stages.includes(input.value);
  });
  document.querySelectorAll("input[name='processPermission']").forEach((input) => {
    input.checked = collaboratorProcesses(person).includes(input.value);
  });
}

function deleteCollaborator(id) {
  if (!requirePermission("admin")) return;
  const person = collaborators.find((item) => item.id === id);
  collaborators = collaborators.filter((item) => item.id !== id);
  orders = orders.map((order) => order.owner === person?.name ? { ...order, owner: "Sem Responsavel" } : order);
  persist();
  audit("AlteraÃƒÂ§ÃƒÂ£o administrativa", "", person?.name || "", "Colaborador excluido");
  render();
}

async function importFile(file) {
  if (!requirePermission("importOrders")) {
    elements.importInput.value = "";
    return;
  }
  if (!file) return;

  setImportStatus(`Lendo ${file.name}...`, "");
  try {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv")) {
      const text = await file.text();
      const rows = csvToArrayRows(text);
      importDailyRows(rows, file.name);
      return;
    }
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
      throw new Error("Formato invalido. Use .xlsx, .xls ou .csv.");
    }
    if (!window.XLSX) {
      throw new Error("A biblioteca XLSX nao foi encontrada. O arquivo xlsx.full.min.js precisa estar na mesma pasta do sistema.");
    }
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    if (!workbook.SheetNames.length) throw new Error("A planilha nao possui abas.");
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    importDailyRows(rows, file.name);
  } catch (error) {
    const message = error?.message || "Erro desconhecido ao importar.";
    setImportStatus(message, "error");
    alert(`Nao foi possivel importar o arquivo.\n\n${message}`);
    audit("Falha na importaÃƒÂ§ÃƒÂ£o de base diÃƒÂ¡ria", "", file.name, message);
  } finally {
    elements.importInput.value = "";
  }
}

function headerRowToObjects(rows,firstRow=1) {
  const dataRows = rows.filter((row) => Array.isArray(row) && row.some((cell) => cleanImportCell(cell)));
  if (dataRows.length < 2) return [];
  const headers = dataRows[0].map((header) => cleanImportCell(header));
  return dataRows.slice(1).map((row) => {
    const item = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    Object.defineProperty(item,'__sourceRow',{value:rows.indexOf(row)+firstRow,enumerable:false});
    Object.defineProperty(item,'__headers',{value:headers,enumerable:false});
    Object.defineProperty(item, "__rowValues", {
      value: row,
      enumerable: false
    });
    return item;
  });
}

function cleanImportCell(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function importedStatus(value) {
  const normalized = normalizeStatus(cleanImportCell(value));
  const map = {
    PROGRAMADA: "PROGRAMADO",
    PROGRAMADO: "PROGRAMADO",
    CONCLUIDO: "CONCLUIDO",
    FINALIZADO: "FINALIZADO",
    FINALIZADA: "FINALIZADO",
    CANCELADA: "CANCELADA",
    CANCELADO: "CANCELADA",
    RETIRADA: "CANCELADA",
    RETIRADO: "CANCELADA",
    SUSPENSA: "SUSPENSA",
    SUSPENSO: "SUSPENSA",
    PROCESSO: "PROCESSOS",
    PROCESSOS: "PROCESSOS",
    ADEQUACAO: "ADEQUACAO",
    ADEQUAÇÃO: "ADEQUACAO",
    AVALIACAO: "AVALIACAO",
    AVALIAÇÃO: "AVALIACAO",
    SIM: "SIM",
    NAO: "NAO",
    NÃO: "NAO"
  };
  return map[normalized] || normalized;
}

function remoteImportFlag(value) {
  const text = cleanImportCell(value);
  if (!text) return false;
  const status = importedStatus(text);
  return !["NAO", "NÃO", "NO", "FALSO", "FALSE", "0"].includes(status);
}

function importedFieldLaneStatus(value) {
  const status = importedStatus(value);
  if (status === "REMOTO" || status === "REMOTA") return "Remoto";
  if (status === "ROTEIRIZACAO") return "Roteirizacao";
  if (status === "PROGRAMADO") return "Programado";
  if (status === "EM ANDAMENTO") return "Em Andamento";
  if (!status || status === "NAO TRATADO" || status === "EM ESPERA") return "Roteirizacao";
  return status;
}

function importedFieldUpdateStatus(value) {
  const raw = cleanImportCell(value);
  if (!raw) return "";
  const status = importedFieldLaneStatus(raw);
  return fieldKanbanStatuses.includes(status) ? status : "";
}

function importedFieldUpdateSection(value) {
  const normalized = normalizeStatus(value);
  if (!normalized) return "";
  if (normalized === "CAD") return "CAD";
  if (normalized.includes("TERMO")) return "Termo";
  if (normalized.includes("CVT")) return "CVT";
  if (normalized.includes("OC") || normalized.includes("PLC")) return "OC";
  if (normalized.includes("CANCEL")) return "Cancelar";
  if (normalized.includes("ENEL")) return "Aguardando Enel";
  return "";
}

function isExplicitClearValue(value) {
  return ["LIMPAR", "REMOVER", "VAZIO", "SEM RESPONSAVEL", "NAO TRATADO"].includes(normalizeStatus(value));
}

function collaboratorFromFieldUpdate(value, stage) {
  const raw = cleanImportCell(value);
  if (!raw) return { raw: "", owner: "", valid: false, clear: false };
  if (isExplicitClearValue(raw)) return { raw, owner: "", valid: true, clear: true };
  const person = findCollaboratorByName(raw);
  return {
    raw,
    owner: person?.stages?.includes(stage) ? person.name : "",
    valid: Boolean(person?.stages?.includes(stage)),
    clear: false
  };
}

function importedDate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return normalizeDate(value);
  const text = cleanImportCell(value);
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  return normalizeDate(text);
}

function importedPersonName(value) {
  const name = cleanImportCell(value);
  if (!name) return "";
  return findCollaboratorByName(name)?.name || name;
}

function importedResponsibleForStage(value, stage) {
  const raw = cleanImportCell(value);
  if (!raw || isNegativeSheetValue(raw)) return { raw: "", owner: "", valid: false, invalid: false };
  const person = findCollaboratorByName(raw);
  const valid = Boolean(person?.stages?.includes(stage));
  return {
    raw,
    owner: valid ? person.name : "",
    valid,
    invalid: !valid
  };
}

function pendencyFromFieldStatus(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "IMPRODUTIVO") return "Cancelar";
  if (normalized === "PENDENTE TERMO") return "Termo";
  if (normalized === "PENDENTE CVT") return "CVT";
  if ((normalized.includes("AGUARDANDO") || normalized.includes("PENDENTE") || normalized.includes("PENDENCIA")) && normalized.includes("ENEL")) return "Aguardando Enel";
  return "";
}

function pendencyFromImportText(value) {
  const normalized = normalizeStatus(value);
  if (!normalized || normalized === "NAO" || normalized === "NÃO") return "";
  if (normalized.includes("TERMO")) return "Termo";
  if (normalized.includes("CVT")) return "CVT";
  if (normalized.includes("FOTO")) return "Fotos";
  if (normalized.includes("OC") || normalized.includes("PLC")) return "OC";
  if (normalized.includes("CANCEL")) return "Cancelar";
  if (normalized.includes("SUSPEND") || normalized.includes("SUSPENS")) return "Suspender";
  if (normalized.includes("ENEL")) return "Aguardando Enel";
  return "";
}

function isNegativeSheetValue(value) {
  const status = importedStatus(value);
  return !status || ["NAO", "NÃO", "N", "NA", "N/A", "-", "0", "NAO SE APLICA", "NÃO SE APLICA"].includes(status);
}

function processExistsFromSheet(statusValue, doneDate = "") {
  const status = importedStatus(statusValue);
  return status === "SIM" || isProcessConcludedSheetStatus(statusValue, doneDate);
}

function processActiveFromSheet(statusValue, doneDate = "") {
  const status = importedStatus(statusValue);
  if (doneDate) return false;
  return status === "SIM";
}

function isProcessConcludedSheetStatus(value, doneDate = "") {
  const status = importedStatus(value);
  return Boolean(doneDate) || ["CONCLUIDO", "FINALIZADO", "CONCLUIDA", "FINALIZADA"].includes(status);
}

function processSheetSignal(value, ownerValue = "") {
  const raw = cleanImportCell(value);
  const owner = cleanImportCell(ownerValue);
  const status = importedStatus(raw);
  if (status === "SIM" || status === "PROCESSOS" || status === "ADEQUACAO" || status === "AVALIACAO") return true;
  if (isNegativeSheetValue(raw)) return false;
  if (raw) return true;
  return Boolean(owner && !isNegativeSheetValue(owner));
}

function importedProcessRoutingMode(values) {
  const statuses = values.map(importedStatus);
  if (statuses.includes("ADEQUACAO")) return "ADEQUACAO";
  if (statuses.includes("AVALIACAO")) return "AVALIACAO";
  if (statuses.includes("PROCESSOS")) return "PROCESSOS";
  return "";
}

function processImportSignals(row, ambientalOwnerInfo, travessiaOwnerInfo) {
  const ambientalStatus = getRowValue(row, "NECESSARIO DOC AMBIENTAL/PODA ?", "NECESSÁRIO DOC AMBIENTAL/PODA ?", "Necessario Doc Ambiental/Poda", "DOC AMBIENTAL", "AMBIENTAL");
  const paralelismoStatus = getRowValue(row, "PROCESSO PARALELISMO E TRAVESSIA ? 2", "Processo Paralelismo e Travessia", "PARALELISMO E TRAVESSIA", "PARALELISMO");
  const ltStatus = getRowValue(row, "TRAVESSIA LT", "TRAVESSIA DE LT", "PROCESSO TRAVESSIA LT");
  const ferroviaStatus = getRowValue(row, "TRAVESSIA FERROVIA", "TRAVESSIA DE FERROVIA", "PROCESSO TRAVESSIA FERROVIA");
  const acudeStatus = getRowValue(row, "TRAVESSIA ACUDE", "TRAVESSIA AÇUDE", "TRAVESSIA DE ACUDE", "TRAVESSIA DE AÇUDE", "PROCESSO TRAVESSIA ACUDE");
  const rioStatus = getRowValue(row, "TRAVESSIA RIO", "TRAVESSIA DE RIO", "PROCESSO TRAVESSIA RIO");
  const termoStatus = getRowValue(row, "TERMO DE PASSAGEM", "PROCESSO TERMO", "TERMO");
  const definitions = [
    { key: "processAmbiental", label: "Ambiental", field: "NECESSARIO DOC AMBIENTAL/PODA ?", value: ambientalStatus, ownerInfo: ambientalOwnerInfo },
    { key: "processParalelismo", label: "Paralelismo e Travessia", field: "PROCESSO PARALELISMO E TRAVESSIA ? 2", value: paralelismoStatus, ownerInfo: travessiaOwnerInfo },
    { key: "processLt", label: "Travessia LT", field: "TRAVESSIA LT", value: ltStatus, ownerInfo: { raw: "", owner: "", valid: false } },
    { key: "processFerrovia", label: "Travessia de Ferrovia", field: "TRAVESSIA DE FERROVIA", value: ferroviaStatus, ownerInfo: { raw: "", owner: "", valid: false } },
    { key: "processAcude", label: "Travessia de Acude", field: "TRAVESSIA DE ACUDE", value: acudeStatus, ownerInfo: { raw: "", owner: "", valid: false } },
    { key: "processRio", label: "Travessia de Rio", field: "TRAVESSIA DE RIO", value: rioStatus, ownerInfo: { raw: "", owner: "", valid: false } },
    { key: "processTermo", label: "Termo de Passagem", field: "TERMO DE PASSAGEM", value: termoStatus, ownerInfo: { raw: "", owner: "", valid: false } }
  ];
  const identified = definitions.filter((item) => processSheetSignal(item.value, item.ownerInfo?.raw));
  const owners = Object.fromEntries(identified
    .filter((item) => item.ownerInfo?.owner)
    .map((item) => [item.key, item.ownerInfo.owner]));
  const alerts = identified
    .filter((item) => item.ownerInfo?.raw && !item.ownerInfo.valid)
    .map((item) => ({ processKey: item.key, processLabel: item.label, field: item.field.includes("AMBIENTAL") ? "ELABORADOR" : "ELABORADOR2", value: item.ownerInfo.raw }));
  return { definitions, identified, keys: identified.map((item) => item.key), owners, alerts };
}

function importedProcessOwner(value) {
  const raw = cleanImportCell(value);
  if (!raw || isNegativeSheetValue(raw)) return { raw: "", owner: "", valid: false };
  const person = findCollaboratorByName(raw);
  return { raw, owner: person?.name || "", valid: Boolean(person) };
}

function importedPoleQuantity(value) {
  const text = cleanImportCell(value);
  if (!text) return "";
  const normalized = text.replace(/\./g, "").replace(",", ".");
  const match = normalized.match(/\d+(\.\d+)?/);
  if (!match) return "";
  return String(Math.max(0, Math.round(Number(match[0]))));
}

function projectWorkTypeFromSheet(value) {
  const raw = cleanImportCell(value);
  if (!raw) return "";
  const normalized = normalizeHeader(raw);
  return projectWorkTypeAliases[normalized]
    || Object.keys(projectVoiceCodes).find((type) => normalizeHeader(type) === normalized)
    || "";
}

function projectVoiceFromSheet(workTypeValue, poleValue) {
  const type = projectWorkTypeFromSheet(workTypeValue);
  const poles = importedPoleQuantity(poleValue);
  const projectVoice = voiceDefinitions.find((voice) => voice.key === "project");
  const code = type && poles !== "" && projectVoice ? voiceCodeFor(projectVoice, poles, type) : "";
  return { type, poles, code };
}

function voicePoleImportsFromSheet(row) {
  return {
    // Read named fields only: the current workbook has months and timers in the old positions.
    project: importedPoleQuantity(getRowValue(row, "POSTES PROJETO", "POSTES DO PROJETO", "QUANTIDADE POSTES PROJETO", "Nº POSTES DO PROJETO")),
    termo: importedPoleQuantity(getRowValue(row, "POSTES TERMO", "POSTES DO TERMO", "QUANTIDADE POSTES TERMO", "Nº POSTES TERMO DE PASSAGEM", "POSTES TERMO DE PASSAGEM")),
    ambiental: importedPoleQuantity(getRowValue(row, "POSTES AMBIENTAL", "POSTES DO AMBIENTAL", "QUANTIDADE POSTES AMBIENTAL")),
    paralelismo: importedPoleQuantity(getRowValue(row, "POSTES PARALELISMO", "POSTES DO PARALELISMO", "QUANTIDADE POSTES PARALELISMO")),
    travessiaRio: importedPoleQuantity(getRowValue(row, "POSTES TRAVESSIA", "POSTES DA TRAVESSIA", "QUANTIDADE POSTES TRAVESSIA"))
  };
}

function importedTerminalStage(statuses) {
  if (statuses.includes("CANCELADA") || statuses.includes("CANCELADO")) return "Cancelada";
  if (statuses.includes("SUSPENSA") || statuses.includes("SUSPENSO")) return "Suspensa";
  return "";
}
function buildStatusUpdate(row) {
  const finalStatus = importedStatus(getRowValue(row, "STATUS FINAL", "Status Final"));
  const regionalFromColumn = cleanImportCell(getRowValue(row, "REGIÃO", "REGIONAL"));
  const review = importedStatus(getRowValue(row, "NECESSITA DE REVISAO", "NECESSITA DE REVISÃO", "Necessita de Revisao", "Necessita Revisao"));
  const fieldStatus = importedStatus(getRowValue(row, "STATUS CAMPO", "Status Campo"));
  const cadStatus = importedStatus(getRowValue(row, "STATUS CAD", "Status CAD"));
  const budgetStatus = importedStatus(getRowValue(row, "STATUS ORCAMENTO", "STATUS ORÇAMENTO", "Status Orcamento"));
  const processStatusImport = importedStatus(getRowValue(row, "STATUS PROCESSOS", "STATUS PROCESSO", "Status Processos", "Status Processo"));
  const tecnicoRaw = getRowValue(row, "TECNICO", "TÉCNICO", "Tecnico");
  const cadistaRaw = getRowValue(row, "CADISTA", "Cadista");
  const orcamentistaRaw = getRowValue(row, "ORCAMENTISTA", "ORÇAMENTISTA", "Orcamentista");
  const tecnico = importedPersonName(tecnicoRaw);
  const cadInfo = importedResponsibleForStage(cadistaRaw, "Criacao de CAD");
  const budgetInfo = importedResponsibleForStage(orcamentistaRaw, "Orcamento");
  const cadista = cadInfo.owner;
  const orcamentista = budgetInfo.owner;
  const receivedDate = importedDate(getRowValue(row, "DATA RECEBIMENTO", "DATA DE RECEBIMENTO", "Data Recebimento"));
  const finalDate = importedDate(getRowValue(row, "DATA FECHAMENTO", "Data Fechamento"));
  const fieldDate = importedDate(getRowValue(row, "DATA FINAL CAMPO", "Data Final Campo"));
  const cadDate = importedDate(getRowValue(row, "DATA FINAL CAD", "Data Final CAD", "DATA FINAL"));
  const budgetDate = importedDate(getRowValue(row, "DATA FINAL ORCAMENTO", "DATA FINAL ORÇAMENTO", "Data Final Orcamento"));
  const ambientalStatus = getRowValue(row, "NECESSARIO DOC AMBIENTAL/PODA ?", "NECESSÁRIO DOC AMBIENTAL/PODA ?", "Necessario Doc Ambiental/Poda", "DOC AMBIENTAL", "AMBIENTAL");
  const ambientalDoneDate = importedDate(getRowValue(row, "DATA AMBIENTAL FINALIZADO", "Data Ambiental Finalizado"));
  const ambientalPendingDays = cleanImportCell(getRowValue(row, "TIMER AMBIENTAL"));
  const ambientalOwnerInfo = importedProcessOwner(getRowValue(row, "ELABORADOR", "Elaborador"));
  const ambientalOwner = ambientalOwnerInfo.owner;
  const paralelismoStatus = getRowValue(row, "PROCESSO PARALELISMO E TRAVESSIA ? 2", "Processo Paralelismo e Travessia", "PARALELISMO E TRAVESSIA", "PARALELISMO");
  const travessiaDoneDate = importedDate(getRowValue(row, "DATA TRAVESSIA FINALIZADO", "Data Travessia Finalizado"));
  const travessiaPendingDays = cleanImportCell(getRowValue(row, "TIMER PERMISSÃO", "TIMER PERMISSAO"));
  const travessiaOwnerInfo = importedProcessOwner(getRowValue(row, "ELABORADOR2", "Elaborador2", "ELABORADOR 2"));
  const travessiaOwner = travessiaOwnerInfo.owner;
  const revisionDoneDate = importedDate(getRowValue(row, "DATA REVISAO FEITA FINALIZADA", "DATA REVISÃO FEITA FINALIZADA", "Data Revisao Feita Finalizada"));
  const projectWorkTypeRaw = getRowValue(row, "TIPO DE OBRA", "Tipo de Obra");
  const voicePoleImports = voicePoleImportsFromSheet(row);
  const projectVoice = projectVoiceFromSheet(projectWorkTypeRaw, voicePoleImports.project);
  const remoteRaw = getRowValue(row, "ORDEM REMOTA", "Ordem Remota", "REMOTO", "Remoto", "APTA PARA REMOTO", "APTO PARA REMOTO", "APTA REMOTO");
  const remoteOrder = remoteImportFlag(remoteRaw);

  const needsAmbiental = processExistsFromSheet(ambientalStatus, ambientalDoneDate);
  const needsParalelismo = processExistsFromSheet(paralelismoStatus, travessiaDoneDate);
  const activeAmbiental = processActiveFromSheet(ambientalStatus, ambientalDoneDate);
  const activeParalelismo = processActiveFromSheet(paralelismoStatus, travessiaDoneDate);
  const processSignals = processImportSignals(row, ambientalOwnerInfo, travessiaOwnerInfo);
  const processMode = importedProcessRoutingMode([fieldStatus, cadStatus, budgetStatus, processStatusImport, tecnicoRaw, cadistaRaw, orcamentistaRaw]);
  const sheetProcessKeys = [...new Set([
    ...processSignals.keys,
    ...(needsAmbiental ? ["processAmbiental"] : []),
    ...(needsParalelismo ? ["processParalelismo"] : [])
  ])];
  const hasIdentifiedProcess = sheetProcessKeys.length > 0;
  const effectiveProcessKeys = hasIdentifiedProcess ? sheetProcessKeys : (processMode === "AVALIACAO" ? ["processEvaluation"] : []);
  const processConclusionByKey = {
    processAmbiental: isProcessConcludedSheetStatus(ambientalStatus, ambientalDoneDate),
    processParalelismo: isProcessConcludedSheetStatus(paralelismoStatus, travessiaDoneDate)
  };
  const processOnlyCompleted = processMode === "PROCESSOS"
    && effectiveProcessKeys.length > 0
    && effectiveProcessKeys.every((key) => processConclusionByKey[key]);
  const hasGenericProcess = processStatusImport === "SIM" || activeAmbiental || activeParalelismo || hasIdentifiedProcess || Boolean(processMode);
  const budgetConcluded = budgetStatus === "CONCLUIDO";
  const isFinalized = finalStatus === "FINALIZADO" || finalStatus === "CONCLUIDO";
  const finalStatusClearsPendency = isFinalized || ["CANCELADO", "CANCELADA", "SUSPENSO", "SUSPENSA"].includes(finalStatus);
  const revisionCorrected = review === "SIM" && isFinalized;
  const pendingType = pendencyFromFieldStatus(fieldStatus) || pendencyFromFieldStatus(cadStatus) || pendencyFromFieldStatus(budgetStatus);
  const activePendency = Boolean(pendingType && !finalStatusClearsPendency);
  const terminalStage = importedTerminalStage([finalStatus, fieldStatus, cadStatus, budgetStatus]);
  const processOwners = {
    ...(needsAmbiental && ambientalOwner ? { processAmbiental: ambientalOwner } : {}),
    ...(needsParalelismo && travessiaOwner ? { processParalelismo: travessiaOwner } : {}),
    ...processSignals.owners
  };
  const processOwnerAlerts = [
    ...(needsAmbiental && ambientalOwnerInfo.raw && !ambientalOwnerInfo.valid ? [{ processKey: "processAmbiental", processLabel: "Ambiental", field: "ELABORADOR", value: ambientalOwnerInfo.raw }] : []),
    ...(needsParalelismo && travessiaOwnerInfo.raw && !travessiaOwnerInfo.valid ? [{ processKey: "processParalelismo", processLabel: "Paralelismo e Travessia", field: "ELABORADOR2", value: travessiaOwnerInfo.raw }] : []),
    ...processSignals.alerts
  ];

  let stage = "Levantamento de Campo";
  if (processMode === "PROCESSOS" && !hasIdentifiedProcess) stage = "";
  else if (processMode === "ADEQUACAO") stage = "Adequacoes";
  else if (processMode === "AVALIACAO" || processMode === "PROCESSOS") stage = "Processos";
  else if (terminalStage) stage = terminalStage;
  else if (isFinalized || revisionCorrected) stage = "Concluido";
  else if (activePendency) stage = "Pendencias";
  else if (hasGenericProcess && budgetConcluded) stage = "Processos";
  else if (review === "SIM") stage = "Rejeitado";
  else if (budgetStatus && !["AGUARDANDO CAD", "NAO TRATADO"].includes(budgetStatus)) stage = "Orcamento";
  else if (cadStatus && !["AGUARDANDO CAMPO", "NAO TRATADO"].includes(cadStatus)) stage = "Criacao de CAD";
  else if (budgetStatus === "NAO TRATADO" || (budgetStatus && orcamentista)) stage = "Orcamento";
  else if (cadStatus === "NAO TRATADO" || (cadStatus && cadista)) stage = "Criacao de CAD";

  let owner = unassignedOwner;
  if (stage === "Levantamento de Campo") owner = tecnico || unassignedOwner;
  if (stage === "Criacao de CAD") owner = cadista || unassignedOwner;
  if (stage === "Orcamento") owner = orcamentista || unassignedOwner;
  if (stage === "Processos") owner = unassignedOwner;
  if (stage === "Adequacoes") owner = unassignedOwner;
  if (["Cancelada", "Suspensa"].includes(stage)) owner = orcamentista || cadista || tecnico || unassignedOwner;

  return {
    osNumber: cleanOrderNumber(getRowValue(row, "OS", "Numero da Ordem", "Número da Ordem", "NÚMERO DA ORDEM")),
    stage,
    owner,
    processMode,
    processRoutingError: Boolean(processMode === "PROCESSOS" && !hasIdentifiedProcess),
    identifiedProcessKeys: effectiveProcessKeys,
    processOnlyCompleted,
    processConclusionByKey,
    processUnidentified: Boolean(processMode === "ADEQUACAO" && !hasIdentifiedProcess),
    pendingType,
    clearPendencyByFinalStatus: finalStatusClearsPendency,
    fieldTech: processMode ? "" : tecnico,
    cadist: processMode ? "" : cadista,
    budgeter: processMode ? "" : orcamentista,
    regional: regionalFromColumn,
    regionalColumnEmpty: !regionalFromColumn,
    cadResponsibleAlert: !processMode && cadInfo.invalid ? { field: "CADISTA", value: cadInfo.raw, sector: "Criacao de CAD" } : null,
    budgetResponsibleAlert: !processMode && budgetInfo.invalid ? { field: "ORCAMENTISTA", value: budgetInfo.raw, sector: "Orcamento" } : null,
    receivedDate,
    fieldStatus: processMode ? "PROCESSOS" : importedFieldLaneStatus(fieldStatus),
    cadStatus: processMode ? "PROCESSOS" : (cadStatus || "NAO TRATADO"),
    budgetStatus: processMode ? "PROCESSOS" : (budgetStatus || "NAO TRATADO"),
    finishDate: finalDate || revisionDoneDate,
    rejectedAt: stage === "Rejeitado" ? new Date().toISOString() : "",
    revisionCorrected,
    remoteOrder,
    remoteRaw: cleanImportCell(remoteRaw),
    ...Object.fromEntries(processTabs.map((process) => [process.key, effectiveProcessKeys.includes(process.key) || (process.key === "processAmbiental" && needsAmbiental) || (process.key === "processParalelismo" && (needsParalelismo || (processStatusImport === "SIM" && !needsAmbiental)))])),
    processStatusImport,
    processActive: !processOnlyCompleted && ((hasGenericProcess && budgetConcluded) || ["PROCESSOS", "AVALIACAO"].includes(processMode)) && stage === "Processos",
    adequacyActive: processMode === "ADEQUACAO" && stage === "Adequacoes",
    processOwners,
    processOwnerAlerts,
    processOwnerFromSheet: travessiaOwner || ambientalOwner,
    processEndDateFromSheet: travessiaDoneDate || ambientalDoneDate,
    projectVoice,
    voicePoleImports,
    projectWorkTypeRaw: cleanImportCell(projectWorkTypeRaw),
    projectedPolesRaw: cleanImportCell(voicePoleImports.project),
    statusImport: { finalStatus, regional: regionalFromColumn, review, fieldStatus, cadStatus, budgetStatus, processStatus: processStatusImport, processMode, identifiedProcessKeys: effectiveProcessKeys, processOnlyCompleted, receivedDate, fieldDate, cadDate, budgetDate, finalDate, revisionDoneDate, ambientalStatus: cleanImportCell(ambientalStatus), ambientalDoneDate, ambientalPendingDays, ambientalOwner, ambientalOwnerRaw: ambientalOwnerInfo.raw, paralelismoStatus: cleanImportCell(paralelismoStatus), travessiaDoneDate, travessiaPendingDays, travessiaOwner, travessiaOwnerRaw: travessiaOwnerInfo.raw, projectWorkTypeRaw: cleanImportCell(projectWorkTypeRaw), projectedPolesRaw: cleanImportCell(voicePoleImports.project), voicePoleImports, projectVoiceType: projectVoice.type, projectVoicePoles: projectVoice.poles, projectVoiceCode: projectVoice.code, remoteRaw: cleanImportCell(remoteRaw) }
  };
}
const linkedStatusDb = {
  name: "ordem-certa-linked-files",
  store: "handles",
  key: "statusWorkbook"
};

function openLinkedStatusDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(linkedStatusDb.name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(linkedStatusDb.store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getLinkedStatusHandle() {
  const db = await openLinkedStatusDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(linkedStatusDb.store, "readonly");
    const request = tx.objectStore(linkedStatusDb.store).get(linkedStatusDb.key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function saveLinkedStatusHandle(handle) {
  const db = await openLinkedStatusDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(linkedStatusDb.store, "readwrite");
    tx.objectStore(linkedStatusDb.store).put(handle, linkedStatusDb.key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function chooseLinkedStatusHandle() {
  if (!window.showOpenFilePicker) {
    throw new Error("Seu navegador nao permite vincular arquivo local. Use o botao Atualizar Status e selecione a planilha manualmente.");
  }
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [{
      description: "Planilha de status",
      accept: {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
        "application/vnd.ms-excel": [".xls"],
        "text/csv": [".csv"]
      }
    }]
  });
  await saveLinkedStatusHandle(handle);
  return handle;
}

async function ensureLinkedStatusPermission(handle) {
  const options = { mode: "read" };
  if ((await handle.queryPermission(options)) === "granted") return true;
  return (await handle.requestPermission(options)) === "granted";
}

function statusHeaderRowsToObjects(rows, firstRow = 1) {
  let headerIndex = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row) || !row.some((cell) => cleanImportCell(cell))) continue;
    const names = row.map((cell) => normalizeHeader(cleanImportCell(cell)));
    const hasOs = names.some((name) => ["os", "numerodaordem"].includes(name));
    const statusFields = ["tipodeobra", "statuscampo", "statuscad", "statusorcamento", "statusfinal"].filter((name) => names.includes(name));
    if (headerIndex < 0 || (hasOs && statusFields.length >= 2)) {
      headerIndex = index;
    } else break;
  }
  // A comparison workbook may have the old and current headers on consecutive rows.
  // Use the last header before data, preserving the original worksheet line numbers.
  return headerIndex < 0 ? [] : headerRowToObjects(rows.slice(headerIndex), firstRow + headerIndex);
}

async function rowsFromStatusFile(file) {
  desktopSource={file:file.name,sheet:null};
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return csvToRows(await file.text());
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) throw new Error("Formato invalido. Use .xlsx, .xls ou .csv.");
  if (!window.XLSX) throw new Error("A biblioteca XLSX nao foi encontrada. O arquivo xlsx.full.min.js precisa estar na mesma pasta do sistema.");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  if (!workbook.SheetNames.length) throw new Error("A planilha nao possui abas.");
  const preferredSheet = workbook.SheetNames.find((sheetName) => normalizeHeader(sheetName) === "ciprojetos") || workbook.SheetNames[0];
  const sheet = workbook.Sheets[preferredSheet];
  desktopSource.sheet=preferredSheet;
  return statusHeaderRowsToObjects(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }),sheet['!ref']?XLSX.utils.decode_range(sheet['!ref']).s.r+1:1);
}

async function rowsFromHeaderSheetFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return csvToRows(await file.text());
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) throw new Error("Formato invalido. Use .xlsx, .xls ou .csv.");
  if (!window.XLSX) throw new Error("A biblioteca XLSX nao foi encontrada. O arquivo xlsx.full.min.js precisa estar na mesma pasta do sistema.");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  if (!workbook.SheetNames.length) throw new Error("A planilha nao possui abas.");
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return headerRowToObjects(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }));
}

function fieldUpdateObservation(row) {
  return cleanImportCell(getRowValue(row, "OBSERVACAO", "OBSERVAÇÃO", "Observacao", "Observação"));
}

function fieldUpdateCoordinateX(row) {
  return coordinateCell(getRowColumnValue(row, 6) || getRowValue(row, "X", "COORDENADA X", "COORDENADA X UTM 24S", "Coordenada X UTM 24S"));
}

function fieldUpdateCoordinateY(row) {
  return coordinateCell(getRowColumnValue(row, 7) || getRowValue(row, "Y", "COORDENADA Y", "COORDENADA Y UTM 24S", "Coordenada Y UTM 24S"));
}

async function applyFieldUpdateRows(rows, fileName = "Atualizacao de Campo") {
  const existingByNumber = new Map(orders.map((order) => [normalizeOrderNumber(order.osNumber), order]));
  const updates = new Map();
  const errors = [];
  const auditEntries = [];
  const actor = currentUser || { fullName: "Sistema", login: "sistema", accessLevel: 100 };
  const linked = currentUser ? currentCollaborator() : null;
  let processed = 0;
  let updatedCount = 0;
  let notFound = 0;
  let cadAssigned = 0;
  let budgetAssigned = 0;
  let invalidNames = 0;
  let ignoredWithoutOs = 0;
  let coordinatesUpdated = 0;
  let coordinatesEmpty = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    processed += 1;
    if (index && index % 100 === 0) {
      setImportStatus(`Importando atualizacao de Campo... ${index}/${rows.length} linhas processadas.`, "");
      await sleep(0);
    }
    const osNumber = cleanOrderNumber(getRowValue(row, "NÚMERO DA ORDEM", "NUMERO DA ORDEM", "Numero da Ordem", "Número da Ordem", "OS"));
    const key = normalizeOrderNumber(osNumber);
    if (!key) {
      ignoredWithoutOs += 1;
      continue;
    }
    const order = updates.get(key) || existingByNumber.get(key);
    if (!order) {
      notFound += 1;
      errors.push(`Linha ${index + 2}: OS ${osNumber} nao encontrada.`);
      continue;
    }

    const statusRaw = getRowValue(row, "STATUS", "Status");
    const sectionRaw = getRowValue(row, "SEÇÃO", "SECAO", "Secao", "Seção");
    const cadRaw = getRowValue(row, "CADISTA", "Cadista");
    const budgetRaw = getRowValue(row, "ORÇAMENTISTA", "ORCAMENTISTA", "Orcamentista");
    const observation = fieldUpdateObservation(row);
    const coordinateX = fieldUpdateCoordinateX(row);
    const coordinateY = fieldUpdateCoordinateY(row);
    const status = importedFieldUpdateStatus(statusRaw);
    const section = importedFieldUpdateSection(sectionRaw);
    const cadInfo = collaboratorFromFieldUpdate(cadRaw, "Criacao de CAD");
    const budgetInfo = collaboratorFromFieldUpdate(budgetRaw, "Orcamento");
    const before = { ...order };
    const next = { ...order, updatedAt: new Date().toISOString() };
    const changes = [];

    if (cleanImportCell(statusRaw) && !status) {
      errors.push(`Linha ${index + 2}: STATUS invalido para OS ${osNumber}: ${cleanImportCell(statusRaw)}.`);
    } else if (status && next.fieldStatus !== status) {
      changes.push(["Status Campo", next.fieldStatus || "-", status]);
      next.fieldStatus = status;
    }

    if (cleanImportCell(sectionRaw) && !section) {
      errors.push(`Linha ${index + 2}: SECAO invalida para OS ${osNumber}: ${cleanImportCell(sectionRaw)}.`);
    } else if (section && section !== "CAD") {
      const pendency = normalizePendencyName(section);
      const currentPendencies = orderPendencies(next);
      if (pendency && !currentPendencies.includes(pendency)) {
        next.pendencies = normalizePendencies([...currentPendencies, pendency]);
        changes.push(["Secao/Pendencia", currentPendencies.join(", ") || "-", next.pendencies.join(", ")]);
      }
      if (pendency && before.stage === "Levantamento de Campo" && !next.pendencyState?.active) {
        next.pendencyState = {
          active: true,
          previousStage: before.stage,
          previousOwner: before.owner || unassignedOwner,
          openedByUser: currentUser?.login || "sistema",
          openedByName: currentUser?.fullName || "Sistema",
          openedByCollaborator: currentCollaborator()?.name || "",
          openedAt: new Date().toISOString(),
          note: observation
        };
        next.stage = "Pendencias";
        next.owner = unassignedOwner;
        changes.push(["Etapa", before.stage, "Pendencias"]);
      }
    } else if (section === "CAD") {
      changes.push(["Secao", "-", "CAD"]);
    }

    if (cleanImportCell(cadRaw)) {
      if (cadInfo.valid) {
        if (next.cadist !== cadInfo.owner) {
          changes.push(["Cadista", next.cadist || "-", cadInfo.owner || "-"]);
          next.cadist = cadInfo.owner;
          cadAssigned += 1;
        }
      } else {
        invalidNames += 1;
        errors.push(`Linha ${index + 2}: cadista invalido para OS ${osNumber}: ${cadInfo.raw}.`);
      }
    }

    if (cleanImportCell(budgetRaw)) {
      if (budgetInfo.valid) {
        if (next.budgeter !== budgetInfo.owner) {
          changes.push(["Orcamentista", next.budgeter || "-", budgetInfo.owner || "-"]);
          next.budgeter = budgetInfo.owner;
          budgetAssigned += 1;
        }
      } else {
        invalidNames += 1;
        errors.push(`Linha ${index + 2}: orcamentista invalido para OS ${osNumber}: ${budgetInfo.raw}.`);
      }
    }

    if (coordinateX || coordinateY) {
      const nextX = coordinateX || next.coordinateX || "";
      const nextY = coordinateY || next.coordinateY || "";
      if ((next.coordinateX || "") !== nextX || (next.coordinateY || "") !== nextY) {
        changes.push(["Coordenadas UTM 24S", `X: ${next.coordinateX || "-"} | Y: ${next.coordinateY || "-"}`, `X: ${nextX || "-"} | Y: ${nextY || "-"}`]);
        next.coordinateX = nextX;
        next.coordinateY = nextY;
        coordinatesUpdated += 1;
      }
    } else {
      coordinatesEmpty += 1;
    }

    if (observation) {
      next.fieldUpdateNotes = [...(next.fieldUpdateNotes || []), {
        date: new Date().toISOString(),
        user: currentUser?.login || "sistema",
        note: observation,
        fileName
      }];
      changes.push(["Observacao", "-", observation]);
    }

    if (!changes.length) continue;
    updates.set(key, next);
    updatedCount += 1;
    auditEntries.push({
      id: newId(),
      fullName: actor.fullName,
      login: actor.login,
      collaboratorName: linked?.name || "",
      accessLevel: actor.accessLevel,
      date: new Date().toISOString(),
      action: cleanAuditText("Importacao atualizacao de Campo"),
      osNumber: cleanAuditText(next.osNumber),
      oldValue: cleanAuditText(`Status: ${before.fieldStatus || "-"} | Secao: ${before.stage || "-"} | Cadista: ${before.cadist || "-"} | Orcamentista: ${before.budgeter || "-"} | X: ${before.coordinateX || "-"} | Y: ${before.coordinateY || "-"}`),
      newValue: cleanAuditText(`Status: ${next.fieldStatus || "-"} | Secao: ${section || "-"} | Cadista: ${next.cadist || "-"} | Orcamentista: ${next.budgeter || "-"} | X: ${next.coordinateX || "-"} | Y: ${next.coordinateY || "-"}`),
      detail: cleanAuditText(`Arquivo: ${fileName}. Alteracoes: ${changes.map(([field, oldValue, newValue]) => `${field}: ${oldValue} -> ${newValue}`).join("; ")}. Observacao importada: ${observation || "-"}. Usuario: ${currentUser?.fullName || "Sistema"}.`)
    });
  }

  if (!processed) throw new Error("Nenhuma linha valida encontrada na planilha de Campo.");
  if (auditEntries.length) {
    historyEntries.push(...auditEntries);
  }
  if (updates.size) {
    orders = orders.map((order) => updates.get(normalizeOrderNumber(order.osNumber)) || order);
    persist();
    render();
  }
  const summary = `Campo: ${processed} processadas. Atualizadas: ${updatedCount}. Nao encontradas: ${notFound}. Cadistas: ${cadAssigned}. Orcamentistas: ${budgetAssigned}. Coordenadas atualizadas: ${coordinatesUpdated}. Coordenadas vazias: ${coordinatesEmpty}. Nomes invalidos: ${invalidNames}. Erros: ${errors.length}.`;
  setImportStatus(summary, errors.length ? "error" : "success");
  alert(`Importacao de Campo concluida:\n\nTotal de ordens processadas: ${processed}\nOrdens atualizadas: ${updatedCount}\nOrdens nao encontradas: ${notFound}\nCadistas atribuidos: ${cadAssigned}\nOrcamentistas atribuidos: ${budgetAssigned}\nCoordenadas atualizadas: ${coordinatesUpdated}\nLinhas com X/Y vazios: ${coordinatesEmpty}\nNomes invalidos: ${invalidNames}\nLinhas sem OS: ${ignoredWithoutOs}\nErros encontrados: ${errors.length}${errors.length ? `\n\n${errors.slice(0, 12).join("\n")}${errors.length > 12 ? "\n..." : ""}` : ""}`);
}

async function importFieldUpdateFile(file) {
  if (!requirePermission("updateStatuses")) {
    if (elements.fieldUpdateInput) elements.fieldUpdateInput.value = "";
    return;
  }
  if (!file) return;
  setImportStatus(`Importando atualizacao de Campo por ${file.name}...`, "");
  try {
    const rows = await rowsFromHeaderSheetFile(file);
    await applyFieldUpdateRows(rows, file.name);
  } catch (error) {
    const message = error?.message || "Erro desconhecido ao importar atualizacao de Campo.";
    setImportStatus(message, "error");
    alert(`Nao foi possivel importar a atualizacao de Campo.\n\n${message}`);
    audit("Falha na importacao de atualizacao de Campo", "", file.name, message);
  } finally {
    if (elements.fieldUpdateInput) elements.fieldUpdateInput.value = "";
  }
}

function chooseStatusWorkbookFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.addEventListener("change", () => {
      const file = input.files?.[0] || null;
      input.remove();
      resolve(file);
    }, { once: true });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

async function importStatusFile(file) {
  if (!requirePermission("updateStatuses")) {
    if (elements.statusUpdateInput) elements.statusUpdateInput.value = "";
    return;
  }
  if (!file) return;

  setImportStatus(`Atualizando status por ${file.name}...`, "");
  try {
    const rows = await rowsFromStatusFile(file);
    updateOrderStatusesFromRows(rows, file.name);
  } catch (error) {
    const message = error?.message || "Erro desconhecido ao atualizar status.";
    setImportStatus(message, "error");
    alert(`Nao foi possivel atualizar os status.\n\n${message}`);
    audit("Falha na atualizaÃ§Ã£o de status por planilha", "", file.name, message);
  } finally {
    if (elements.statusUpdateInput) elements.statusUpdateInput.value = "";
  }
}

async function rowsFromSimpleSheetFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return csvToArrayRows(await file.text());
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) throw new Error("Formato invalido. Use .xlsx, .xls ou .csv.");
  if (!window.XLSX) throw new Error("A biblioteca XLSX nao foi encontrada. O arquivo xlsx.full.min.js precisa estar na mesma pasta do sistema.");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  if (!workbook.SheetNames.length) throw new Error("A planilha nao possui abas.");
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
}

function coordinateCell(value) {
  return cleanImportCell(value);
}

function updateCoordinatesFromRows(rows, fileName = "Coordenadas") {
  const dataRows = rows.filter((row) => Array.isArray(row) && row.some((cell) => cleanImportCell(cell)));
  if (!dataRows.length) throw new Error("Nenhuma linha valida encontrada na planilha de coordenadas.");
  const first = dataRows[0] || [];
  const hasHeader = normalizeHeader(first[0] || "").includes("os") || normalizeHeader(first[1] || "").includes("x") || normalizeHeader(first[2] || "").includes("y");
  const rowsToRead = hasHeader ? dataRows.slice(1) : dataRows;
  const existingByNumber = new Map(orders.map((order) => [normalizeOrderNumber(order.osNumber), order]));
  const updates = new Map();
  let ignoredWithoutOs = 0;
  let ignoredMissing = 0;
  let ignoredEmptyCoordinates = 0;

  rowsToRead.forEach((row) => {
    const osNumber = cleanOrderNumber(row[0]);
    const key = normalizeOrderNumber(osNumber);
    const coordinateX = coordinateCell(row[1]);
    const coordinateY = coordinateCell(row[2]);
    if (!key) {
      ignoredWithoutOs += 1;
      return;
    }
    if (!existingByNumber.has(key)) {
      ignoredMissing += 1;
      return;
    }
    if (!coordinateX && !coordinateY) {
      ignoredEmptyCoordinates += 1;
      return;
    }
    updates.set(key, { coordinateX, coordinateY });
  });

  let changed = 0;
  orders = orders.map((order) => {
    const update = updates.get(normalizeOrderNumber(order.osNumber));
    if (!update) return order;
    const next = {
      ...order,
      coordinateX: update.coordinateX || order.coordinateX || "",
      coordinateY: update.coordinateY || order.coordinateY || "",
      updatedAt: new Date().toISOString()
    };
    if ((order.coordinateX || "") === (next.coordinateX || "") && (order.coordinateY || "") === (next.coordinateY || "")) return order;
    changed += 1;
    audit(
      "Atualizacao de coordenadas por planilha",
      order.osNumber,
      `X: ${order.coordinateX || "-"} | Y: ${order.coordinateY || "-"}`,
      `X: ${next.coordinateX || "-"} | Y: ${next.coordinateY || "-"}`,
      `Arquivo: ${fileName}. Formato esperado: coluna 1 OS, coluna 2 X, coluna 3 Y.`
    );
    return next;
  });
  persist();
  render();
  setImportStatus(`Coordenadas atualizadas: ${changed}. Ignoradas sem OS: ${ignoredWithoutOs}. OS nao encontradas: ${ignoredMissing}. Sem coordenadas: ${ignoredEmptyCoordinates}.`, "success");
  alert(`Importacao de coordenadas concluida:\n\nLinhas lidas: ${rowsToRead.length}\nOrdens atualizadas: ${changed}\nLinhas sem OS: ${ignoredWithoutOs}\nOrdens nao encontradas: ${ignoredMissing}\nLinhas sem X/Y: ${ignoredEmptyCoordinates}`);
}

async function importCoordinatesFile(file) {
  if (!requirePermission("updateStatuses")) {
    if (elements.coordinatesInput) elements.coordinatesInput.value = "";
    return;
  }
  if (!file) return;
  setImportStatus(`Importando coordenadas por ${file.name}...`, "");
  try {
    const rows = await rowsFromSimpleSheetFile(file);
    updateCoordinatesFromRows(rows, file.name);
  } catch (error) {
    const message = error?.message || "Erro desconhecido ao importar coordenadas.";
    setImportStatus(message, "error");
    alert(`Nao foi possivel importar as coordenadas.\n\n${message}`);
    audit("Falha na importacao de coordenadas", "", file.name, message);
  } finally {
    if (elements.coordinatesInput) elements.coordinatesInput.value = "";
  }
}

async function importLinkedStatusWorkbook() {
  if (!requirePermission("updateStatuses")) return;
  try {
    const file = await chooseStatusWorkbookFile();
    if (!file) {
      setImportStatus("Nenhuma planilha selecionada.", "");
      return;
    }
    setImportStatus(`Atualizando pela planilha selecionada: ${file.name}...`, "");
    const rows = await rowsFromStatusFile(file);
    updateOrderStatusesFromRows(rows, `${file.name} (selecionada manualmente)`);
  } catch (error) {
    const message = error?.message || "Erro desconhecido ao atualizar pela planilha selecionada.";
    setImportStatus(message, "error");
    alert(`Nao foi possivel atualizar pela planilha selecionada.\n\n${message}`);
    audit("Falha na atualizacao por planilha selecionada", "", "Planilha selecionada", message);
  }
}

function valueForAudit(value) {
  if (Array.isArray(value)) return value.join(", ") || "-";
  if (value === true) return "Sim";
  if (value === false) return "Nao";
  return value || "-";
}

function trackSheetChange(changes, field, oldValue, newValue) {
  if (JSON.stringify(oldValue ?? "") === JSON.stringify(newValue ?? "")) return;
  changes.push({ field, oldValue: valueForAudit(oldValue), newValue: valueForAudit(newValue) });
}

function applyImportedPendency(order, next, pendingType, now) {
  if (!pendingType) return false;
  const previousPendencies = orderPendencies(order);
  const pendencies = previousPendencies.includes(pendingType) ? previousPendencies : [...previousPendencies, pendingType];
  const wasActive = order.stage === "Pendencias" && order.pendencyState?.active;
  next.pendencies = pendencies;
  next.stage = "Pendencias";
  next.owner = "Sem Responsavel";
  next.pendencyState = {
    ...(order.pendencyState || {}),
    active: true,
    previousStage: wasActive ? (order.pendencyState?.previousStage || "Levantamento de Campo") : order.stage,
    previousOwner: wasActive ? (order.pendencyState?.previousOwner || order.owner || "Sem Responsavel") : (order.owner || "Sem Responsavel"),
    openedAt: order.pendencyState?.openedAt || now,
    openedByUser: order.pendencyState?.openedByUser || currentUser?.login || "sistema",
    openedByName: order.pendencyState?.openedByName || currentUser?.fullName || "Sistema",
    openedByCollaborator: order.pendencyState?.openedByCollaborator || currentCollaborator()?.name || "",
    note: order.pendencyState?.note || `Reconhecida automaticamente pela atualizacao de status: ${pendingType}`
  };
  return !wasActive || !previousPendencies.includes(pendingType);
}

function voicesWithProjectImport(order, update) {
  const voices = normalizeVoices(order);
  const imported = update.projectVoice || {};
  const poleImports = update.voicePoleImports || {};
  const hasProcessPoleImport = Object.entries(poleImports).some(([key, value]) => key !== "project" && value !== "");
  if (!imported.type && imported.poles === "" && !hasProcessPoleImport) return voices;
  const projectVoice = voiceDefinitions.find((voice) => voice.key === "project");
  const previous = voices.project || { code: "", poles: "", repeat: "1x", type: "" };
  const type = imported.type || previous.type || "";
  const poles = imported.poles !== "" && imported.poles !== undefined ? imported.poles : (previous.poles ?? "");
  const nextVoices = {
    ...voices,
    project: {
      ...previous,
      type,
      poles,
      code: projectVoice && type && poles !== "" ? voiceCodeFor(projectVoice, poles, type) : previous.code || "",
      repeat: previous.repeat || "1x"
    }
  };
  ["termo", "ambiental", "paralelismo", "travessiaRio"].forEach((voiceKey) => {
    const importedPoles = poleImports[voiceKey];
    if (importedPoles === "" || importedPoles === undefined) return;
    const voice = voiceDefinitions.find((item) => item.key === voiceKey);
    const previousVoice = nextVoices[voiceKey] || { code: "", poles: "", repeat: "1x", type: "" };
    nextVoices[voiceKey] = {
      ...previousVoice,
      poles: importedPoles,
      code: voice ? voiceCodeFor(voice, importedPoles) : previousVoice.code,
      repeat: previousVoice.repeat || "1x"
    };
  });
  return nextVoices;
}

function processDetailsWithSheetCompletion(order, update) {
  const details = structuredClone(order.processDetails || {});
  const dates = {
    processAmbiental: update.statusImport?.ambientalDoneDate,
    processParalelismo: update.statusImport?.travessiaDoneDate
  };
  const pendingDays = {
    processAmbiental: update.statusImport?.ambientalPendingDays,
    processParalelismo: update.statusImport?.travessiaPendingDays
  };
  Object.entries(pendingDays).forEach(([processKey, value]) => {
    if (value === "" || value === undefined) return;
    details[processKey] = { ...(details[processKey] || {}), pendingDays: value };
  });
  Object.entries(dates).forEach(([processKey, endDate]) => {
    // Only the explicit date of this process can fill its conclusion date.
    if (!endDate) return;
    details[processKey] = {
      ...(details[processKey] || {}),
      owners: update.processOwners?.[processKey] || details[processKey]?.owners || order.processOwners?.[processKey] || "",
      endDate,
      notes: details[processKey]?.notes || "Data de conclusao importada da planilha."
    };
  });
  return details;
}

function updateOrderStatusesFromRows(rows, fileName = "Import") {
  if (!rows.length) throw new Error("Nenhuma linha valida encontrada na planilha de status.");
  desktopBeginImport(rows,fileName);
  const existingByNumber = new Map(orders.map((order) => [normalizeOrderNumber(order.osNumber), order]));
  const updates = new Map();
  let ignoredWithoutOs = 0;
  let ignoredMissing = 0;
  let unchanged = 0;

  for (const row of rows) {
    const update = buildStatusUpdate(row);
    const key = normalizeOrderNumber(update.osNumber);
    if (!key) {
      desktopImportRow(row,update,'Ignorada: número da OS vazio');
      ignoredWithoutOs += 1;
      continue;
    }
    if (!existingByNumber.has(key)) {
      desktopImportRow(row,update,'Ignorada: OS não existe na base');
      ignoredMissing += 1;
      continue;
    }
    if(updates.has(key))for(const previous of desktopImportContext.rows)if(normalizeOrderNumber(previous.osNumber)===key)previous.status='Linha duplicada: substituída pela última linha da mesma OS';
    desktopImportRow(row,update,update.processRoutingError?'Bloqueada na leitura: PROCESSOS sem tipo identificado':'Reconhecida: conferir campos pendentes e validação do servidor');
    updates.set(key, update);
  }

  let changed = 0;
  let sentToPendencies = 0;
  let sentToCancelada = 0;
  let sentToSuspensa = 0;
  let sentToProcessos = 0;
  let receivedDateUpdates = 0;
  let cadAssigned = 0;
  let budgetAssigned = 0;
  let keptUnassigned = 0;
  let invalidResponsibleNames = 0;
  let regionalUpdates = 0;
  let regionalUnchanged = 0;
  let regionalEmpty = 0;
  let regionalErrors = 0;
  let processExclusiveCount = 0;
  let processEvaluationCount = 0;
  let adequacyCount = 0;
  let adequacyAmbientalCount = 0;
  let adequacyParalelismoCount = 0;
  let processUnassignedCount = 0;
  let processDirectAssignedCount = 0;
  let multiProcessCount = 0;
  let missingProcessTypeCount = 0;
  let processOnlyCompletedCount = 0;
  const now = new Date().toISOString();

  orders = orders.map((order) => {
    const update = updates.get(normalizeOrderNumber(order.osNumber));
    if (!update) return order;
    if (update.processRoutingError) {
      missingProcessTypeCount += 1;
      unchanged += 1;
      const actor = currentUser || { fullName: "Sistema", login: "sistema", accessLevel: 100 };
      const linked = currentUser ? currentCollaborator() : null;
      historyEntries.push({
        id: newId(),
        fullName: actor.fullName,
        login: actor.login,
        collaboratorName: linked?.name || "",
        accessLevel: actor.accessLevel,
        date: now,
        action: "Atualizacao de Processos bloqueada",
        osNumber: order.osNumber,
        oldValue: `${order.stage} / ${displayOwnerName(order.owner)}`,
        newValue: `${order.stage} / ${displayOwnerName(order.owner)}`,
        detail: `Arquivo: ${fileName}. A ordem foi marcada como PROCESSOS, mas nenhum tipo de processo necessario foi identificado.`
      });
      return order;
    }

    const terminalStatus = update.stage === "Cancelada" ? "CANCELADA" : update.stage === "Suspensa" ? "SUSPENSA" : "";
    const nextProcessOwners = {
      ...(order.processOwners || {}),
      ...(update.processOwners || {})
    };
    const assignedProcessOwner = Object.values(update.processOwners || {}).find((owner) => owner && !isUnassignedOwner(owner)) || "";
    const processMarkedBySheet = Boolean(update.identifiedProcessKeys?.length || update.processAmbiental || update.processParalelismo || update.processStatusImport === "SIM");
    const processFlagUpdates = Object.fromEntries(processTabs.map((process) => [process.key, Boolean(update[process.key] || order[process.key])]));
    const holdProcessUntilBudget = processMarkedBySheet && !update.processActive;
    const shouldEnterRemoteLane = Boolean(update.remoteOrder && update.stage === "Levantamento de Campo" && !order.remoteEvaluated && !order.remoteFastTrack);
    const next = {
      ...order,
      ...processFlagUpdates,
      stage: update.stage,
      owner: normalizeOwnerValue(update.owner),
      fieldTech: update.processMode ? "" : (update.fieldTech || order.fieldTech),
      cadist: update.processMode ? "" : (update.cadist || ((update.cadResponsibleAlert || update.cadStatus === "NAO TRATADO") ? "" : order.cadist)),
      budgeter: update.processMode ? "" : (update.budgeter || ((update.budgetResponsibleAlert || update.budgetStatus === "NAO TRATADO") ? "" : order.budgeter)),
      regional: update.regional || order.regional,
      receivedDate: update.receivedDate || order.receivedDate,
      ans: calculatedAnsValue(update.receivedDate || order.receivedDate),
      status: terminalStatus || (update.stage === "Concluido" ? "FINALIZADO" : order.status),
      fieldStatus: terminalStatus || (shouldEnterRemoteLane ? "Remoto" : update.fieldStatus || order.fieldStatus),
      cadStatus: terminalStatus || update.cadStatus || order.cadStatus,
      budgetStatus: terminalStatus || update.budgetStatus || order.budgetStatus,
      remoteOrder: update.remoteOrder || order.remoteOrder,
      processOwners: nextProcessOwners,
      processOnlyCompleted: update.processOnlyCompleted || order.processOnlyCompleted,
      processDetails: processDetailsWithSheetCompletion(order, update),
      processOwner: update.processActive ? normalizeOwnerValue(update.processMode === "AVALIACAO" ? unassignedOwner : (assignedProcessOwner || order.processOwner || unassignedOwner)) : normalizeOwnerValue(holdProcessUntilBudget ? (assignedProcessOwner || order.processOwner || unassignedOwner) : order.processOwner),
      processStatus: update.processOnlyCompleted ? "CONCLUIDO" : (update.adequacyActive ? "ADEQUACAO" : (update.processMode === "AVALIACAO" ? "AVALIACAO" : (update.processActive ? (assignedProcessOwner && update.processMode !== "AVALIACAO" ? "Em andamento" : "NAO TRATADO") : (holdProcessUntilBudget ? "Aguardando" : (update.processEndDateFromSheet ? "Concluido" : order.processStatus))))),
      processState: update.processOnlyCompleted
        ? { ...(order.processState || processReturnSnapshot(order)), active: false, openedAt: order.processState?.openedAt || now, closedAt: now, closedByUser: currentUser?.login || "sistema", closedByName: currentUser?.fullName || "Sistema", source: "Atualizacao via planilha - PROCESSOS concluido" }
        : (update.adequacyActive ? null : (update.processActive ? { ...(order.processState || processReturnSnapshot(order)), active: true, openedAt: order.processState?.openedAt || now, openedByUser: currentUser?.login || "sistema", openedByName: currentUser?.fullName || "Sistema", openedByCollaborator: currentCollaborator()?.name || "", source: `Atualizacao via planilha${update.processMode ? ` - ${update.processMode}` : ""}` } : (holdProcessUntilBudget ? null : order.processState))),
      adequacyState: update.adequacyActive ? { ...(order.adequacyState || processReturnSnapshot(order)), active: true, types: update.identifiedProcessKeys, openedAt: order.adequacyState?.openedAt || now, openedByUser: currentUser?.login || "sistema", openedByName: currentUser?.fullName || "Sistema", source: "Atualizacao via planilha - ADEQUACAO" } : order.adequacyState,
      adequacyTypes: update.adequacyActive ? update.identifiedProcessKeys : order.adequacyTypes,
      adequacyUnidentified: update.adequacyActive ? update.processUnidentified : order.adequacyUnidentified,
      adequacyOwners: update.adequacyActive ? { ...(order.adequacyOwners || {}), ...nextProcessOwners } : order.adequacyOwners,
      adequacyStatus: update.adequacyActive ? { ...(order.adequacyStatus || {}), ...Object.fromEntries(update.identifiedProcessKeys.map((key) => [key, "Aberta"])) } : order.adequacyStatus,
    processEndDate: update.processEndDateFromSheet || order.processEndDate || "",
      finishDate: update.stage === "Concluido" ? (update.finishDate || order.finishDate || "") : order.finishDate,
      completedAt: update.stage === "Concluido" ? (order.completedAt || now) : order.completedAt,
      completedByOwner: update.stage === "Concluido" ? (order.completedByOwner || (isUnassignedOwner(update.owner) ? "" : update.owner) || order.owner || update.budgeter || update.cadist || update.fieldTech || "") : order.completedByOwner,
      completedCadist: update.stage === "Concluido" ? (order.completedCadist || update.cadist || order.cadist || "") : order.completedCadist,
      completedFromStage: update.stage === "Concluido" ? (order.completedFromStage || order.stage) : order.completedFromStage,
      rejectedAt: update.stage === "Rejeitado" ? (order.rejectedAt || update.rejectedAt) : order.rejectedAt,
      rejectedByOwner: update.stage === "Rejeitado" ? (order.rejectedByOwner || update.owner || order.owner || "") : order.rejectedByOwner,
      rejectionResolvedAt: update.revisionCorrected ? now : order.rejectionResolvedAt,
      revisionStatus: update.revisionCorrected ? "Corrigida" : order.revisionStatus,
      rejectionStatus: update.revisionCorrected ? "Concluida" : order.rejectionStatus,
      pendencies: update.clearPendencyByFinalStatus ? [] : order.pendencies,
      pendencyState: update.clearPendencyByFinalStatus
        ? { ...(order.pendencyState || {}), active: false, resolvedAt: now, resolvedByUser: currentUser?.login || "sistema", resolvedByName: currentUser?.fullName || "Sistema", note: `Pendencia removida automaticamente pela atualizacao de STATUS FINAL: ${update.statusImport?.finalStatus || "-"}` }
        : (update.revisionCorrected && order.stage === "Rejeitado" ? { ...(order.pendencyState || {}), active: false, resolvedAt: now, resolvedByUser: currentUser?.login || "sistema", resolvedByName: currentUser?.fullName || "Sistema" } : order.pendencyState),
      voices: voicesWithProjectImport(order, update),
      statusImport: update.statusImport,
      updatedAt: now
    };

    if (processMarkedBySheet && !isBudgetConcluded(next) && !update.clearPendencyByFinalStatus && !update.processMode) {
      next.processState = null;
      next.processOwner = normalizeOwnerValue(assignedProcessOwner || order.processOwner || unassignedOwner);
      next.processStatus = "Aguardando";
      if (next.stage === "Processos" || next.stage === "Concluido") {
        next.stage = ["Levantamento de Campo", "Criacao de CAD", "Orcamento"].includes(order.stage)
          ? order.stage
          : (next.budgetStatus && next.budgetStatus !== "NAO TRATADO" ? "Orcamento" : "Criacao de CAD");
        next.owner = normalizeOwnerValue(ownerFromOrderResponsibles(next));
      }
      next.finishDate = order.finishDate || "";
      next.completedAt = order.completedAt || "";
      next.completedByOwner = order.completedByOwner || "";
      next.completedCadist = order.completedCadist || "";
      next.completedFromStage = order.completedFromStage || "";
    }



    const pendencyCreated = update.clearPendencyByFinalStatus ? false : applyImportedPendency(order, next, update.pendingType, now);
    const changes = [];
    const hasNewImportedProcess = Boolean(
      (update.processAmbiental && !order.processAmbiental)
      || (update.processParalelismo && !order.processParalelismo)
    );
    const budgetConcludedNow = !isBudgetConcluded(order) && isBudgetConcluded(next);
    trackSheetChange(changes, "Etapa", order.stage, next.stage);
    trackSheetChange(changes, "Responsavel", displayOwnerName(order.owner), displayOwnerName(next.owner));
    trackSheetChange(changes, "Status Campo", order.fieldStatus, next.fieldStatus);
    trackSheetChange(changes, "Ordem remota", order.remoteOrder ? "Sim" : "Nao", next.remoteOrder ? "Sim" : "Nao");
    trackSheetChange(changes, "Status CAD", order.cadStatus, next.cadStatus);
    trackSheetChange(changes, "Status Orcamento", order.budgetStatus, next.budgetStatus);
    trackSheetChange(changes, "Responsavel CAD", order.cadist, next.cadist);
    trackSheetChange(changes, "Responsavel Orcamento", order.budgeter, next.budgeter);
    trackSheetChange(changes, "Regional", order.regional, next.regional);
    trackSheetChange(changes, "Processos", order.processState?.active ? "Sim" : "Nao", next.processState?.active ? "Sim" : "Nao");
    trackSheetChange(changes, "Responsavel Processo", displayOwnerName(order.processOwner), displayOwnerName(next.processOwner));
    trackSheetChange(changes, "Revisao", order.revisionStatus, next.revisionStatus);
    trackSheetChange(changes, "Rejeicao", order.rejectionStatus, next.rejectionStatus);
    trackSheetChange(changes, "Data de Recebimento", order.receivedDate, next.receivedDate);
    trackSheetChange(changes, "Tipo de Obra", normalizeVoices(order).project?.type, normalizeVoices(next).project?.type);
    trackSheetChange(changes, "Postes Voz do Projeto", normalizeVoices(order).project?.poles, normalizeVoices(next).project?.poles);
    trackSheetChange(changes, "Codigo Voz do Projeto", normalizeVoices(order).project?.code, normalizeVoices(next).project?.code);
    trackSheetChange(changes, "Postes Voz Termo", normalizeVoices(order).termo?.poles, normalizeVoices(next).termo?.poles);
    trackSheetChange(changes, "Codigo Voz Termo", normalizeVoices(order).termo?.code, normalizeVoices(next).termo?.code);
    trackSheetChange(changes, "Postes Voz Ambiental", normalizeVoices(order).ambiental?.poles, normalizeVoices(next).ambiental?.poles);
    trackSheetChange(changes, "Codigo Voz Ambiental", normalizeVoices(order).ambiental?.code, normalizeVoices(next).ambiental?.code);
    trackSheetChange(changes, "Postes Voz Paralelismo", normalizeVoices(order).paralelismo?.poles, normalizeVoices(next).paralelismo?.poles);
    trackSheetChange(changes, "Codigo Voz Paralelismo", normalizeVoices(order).paralelismo?.code, normalizeVoices(next).paralelismo?.code);
    trackSheetChange(changes, "Postes Voz Travessia", normalizeVoices(order).travessiaRio?.poles, normalizeVoices(next).travessiaRio?.poles);
    trackSheetChange(changes, "Codigo Voz Travessia", normalizeVoices(order).travessiaRio?.code, normalizeVoices(next).travessiaRio?.code);
    trackSheetChange(changes, "Pendencia", orderPendencies(order), orderPendencies(next));
    trackSheetChange(changes, "Processo Ambiental", order.processAmbiental, next.processAmbiental);
    trackSheetChange(changes, "Processo Paralelismo", order.processParalelismo, next.processParalelismo);
    processTabs
      .filter((process) => !["processAmbiental", "processParalelismo"].includes(process.key))
      .forEach((process) => trackSheetChange(changes, `Processo ${process.label}`, order[process.key], next[process.key]));
    trackSheetChange(changes, "Responsaveis por Processo", order.processOwners || {}, next.processOwners || {});
    trackSheetChange(changes, "Modo de Processo da planilha", order.statusImport?.processMode, update.processMode);
    trackSheetChange(changes, "Adequacoes", order.adequacyState?.active ? "Sim" : "Nao", next.adequacyState?.active ? "Sim" : "Nao");
    trackSheetChange(changes, "Pendencia da planilha", order.statusImport?.pendencia, update.statusImport?.pendencia);
    trackSheetChange(changes, "Dias pendente Ambiental", order.processDetails?.processAmbiental?.pendingDays, next.processDetails?.processAmbiental?.pendingDays);
    trackSheetChange(changes, "Dias pendente Paralelismo e Travessia", order.processDetails?.processParalelismo?.pendingDays, next.processDetails?.processParalelismo?.pendingDays);
    if (update.clearPendencyByFinalStatus && (order.pendencyState?.active || orderPendencies(order).length)) {
      changes.push({
        field: "Pendencia removida por STATUS FINAL",
        oldValue: orderPendencies(order).join(", ") || "Pendencia ativa",
        newValue: `Removida automaticamente porque STATUS FINAL veio como ${update.statusImport?.finalStatus || "-"}. Nova etapa: ${next.stage}.`
      });
    }
    if (update.cadist && update.cadStatus === "NAO TRATADO") {
      changes.push({
        field: "Responsavel CAD priorizado",
        oldValue: displayOwnerName(order.cadist || unassignedOwner),
        newValue: `${update.cadist}. Status importado: NAO TRATADO. O nome da coluna CADISTA teve prioridade sobre o status.`
      });
    }
    if (update.budgeter && update.budgetStatus === "NAO TRATADO") {
      changes.push({
        field: "Responsavel Orcamento priorizado",
        oldValue: displayOwnerName(order.budgeter || unassignedOwner),
        newValue: `${update.budgeter}. Status importado: NAO TRATADO. O nome da coluna ORCAMENTISTA teve prioridade sobre o status.`
      });
    }
    if (update.cadResponsibleAlert) {
      changes.push({
        field: "Erro de validacao CADISTA",
        oldValue: "-",
        newValue: `Valor encontrado: ${update.cadResponsibleAlert.value}. Colaborador inexistente ou fora do setor CAD. OS mantida em ${unassignedLabel} quando estiver em CAD.`
      });
    }
    if (update.budgetResponsibleAlert) {
      changes.push({
        field: "Erro de validacao ORCAMENTISTA",
        oldValue: "-",
        newValue: `Valor encontrado: ${update.budgetResponsibleAlert.value}. Colaborador inexistente ou fora do setor Orcamento. OS mantida em ${unassignedLabel} quando estiver em Orcamento.`
      });
    }
    if (update.regionalColumnEmpty) {
      regionalEmpty += 1;
    } else if (cleanImportCell(order.regional) !== cleanImportCell(next.regional)) {
      regionalUpdates += 1;
    } else {
      regionalUnchanged += 1;
    }
    if (update.processAmbiental) {
      changes.push({
        field: "Processo identificado",
        oldValue: "-",
        newValue: `Campo: NECESSARIO DOC AMBIENTAL/PODA ? / ELABORADOR. Valor: ${valueForAudit(update.statusImport?.ambientalStatus || update.statusImport?.ambientalOwnerRaw)}. Processo: Ambiental. Colaborador: ${displayOwnerName(next.processOwners?.processAmbiental || unassignedOwner)}.`
      });
    }
    if (update.processParalelismo) {
      changes.push({
        field: "Processo identificado",
        oldValue: "-",
        newValue: `Campo: PROCESSO PARALELISMO E TRAVESSIA ? 2 / ELABORADOR2. Valor: ${valueForAudit(update.statusImport?.paralelismoStatus || update.statusImport?.travessiaOwnerRaw)}. Processo: Paralelismo e Travessia. Colaborador: ${displayOwnerName(next.processOwners?.processParalelismo || unassignedOwner)}.`
      });
    }
    if (hasNewImportedProcess && !isBudgetConcluded(next)) {
      changes.push({
        field: "Processo identificado antes do Orcamento",
        oldValue: "-",
        newValue: `Processo complementar marcado na OS, mas a ordem permaneceu em ${next.stage} porque o STATUS ORCAMENTO ainda nao esta CONCLUIDO.`
      });
    }
    if (budgetConcludedNow) {
      changes.push({
        field: "Orcamento concluido",
        oldValue: order.budgetStatus || "NAO TRATADO",
        newValue: `CONCLUIDO em ${new Date(now).toLocaleString("pt-BR")}`
      });
    }
    if (shouldEnterRemoteLane && fieldLaneStatus(order) !== "Remoto") {
      changes.push({
        field: "Entrada na baia Remoto",
        oldValue: fieldLaneStatus(order),
        newValue: `Remoto. Ordem apta para remoto identificada na planilha em ${new Date(now).toLocaleString("pt-BR")}.`
      });
    }
    if (update.projectWorkTypeRaw && !update.projectVoice?.type) {
      changes.push({
        field: "Tipo de Obra nao reconhecido",
        oldValue: "-",
        newValue: `Valor encontrado na planilha: ${update.projectWorkTypeRaw}. A Voz do Projeto nao foi alterada porque o tipo nao esta mapeado.`
      });
    }
    if (next.processState?.active && !order.processState?.active) {
      changes.push({
        field: "Envio automatico para Processos",
        oldValue: `${order.stage} / ${displayOwnerName(order.owner)}`,
        newValue: `Processos / ${displayOwnerName(next.processOwner || unassignedOwner)}. Motivo: ${update.processMode || "Orcamento concluido e processo complementar marcado"}.`
      });
    }
    if (next.adequacyState?.active && !order.adequacyState?.active) {
      changes.push({
        field: "Envio para Adequacoes",
        oldValue: `${order.stage} / ${displayOwnerName(order.owner)}`,
        newValue: `Adequacoes / ${update.identifiedProcessKeys.map(processLabelFromKey).join(", ") || "Nao Identificado"}. Motivo: status ADEQUACAO recebido na planilha.`
      });
    }
    if (update.processOnlyCompleted) {
      changes.push({
        field: "Concluido apenas processo",
        oldValue: `${order.stage} / ${displayOwnerName(order.owner)}`,
        newValue: `Processos / Concluido apenas processo. Processos: ${update.identifiedProcessKeys.map(processLabelFromKey).join(", ")}. Campo/CAD/Orcamento marcados como PROCESSOS.`
      });
    }
    (update.processOwnerAlerts || []).forEach((alertInfo) => {
      changes.push({
        field: "Alerta de Processo",
        oldValue: "-",
        newValue: `Campo: ${alertInfo.field}. Valor encontrado: ${alertInfo.value}. Processo: ${alertInfo.processLabel}. Colaborador nao existe no cadastro; OS mantida em ${unassignedLabel}.`
      });
    });

    if (!changes.length) {
      unchanged += 1;
      return order;
    }

    changed += 1;
    if (pendencyCreated || (next.stage === "Pendencias" && order.stage !== "Pendencias")) sentToPendencies += 1;
    if (next.stage === "Cancelada" && order.stage !== "Cancelada") sentToCancelada += 1;
    if (next.stage === "Suspensa" && order.stage !== "Suspensa") sentToSuspensa += 1;
    if ((next.processState?.active && !order.processState?.active) || (next.stage === "Processos" && order.stage !== "Processos")) sentToProcessos += 1;
    if ((order.receivedDate || "") !== (next.receivedDate || "")) receivedDateUpdates += 1;
    if (update.cadist && next.cadist === update.cadist) cadAssigned += 1;
    if (update.budgeter && next.budgeter === update.budgeter) budgetAssigned += 1;
    if ((next.stage === "Criacao de CAD" || next.stage === "Orcamento") && isUnassignedOwner(next.owner)) keptUnassigned += 1;
    if (update.cadResponsibleAlert) invalidResponsibleNames += 1;
    if (update.budgetResponsibleAlert) invalidResponsibleNames += 1;
    invalidResponsibleNames += update.processOwnerAlerts?.length || 0;
    if (update.processMode === "PROCESSOS") processExclusiveCount += 1;
    if (update.processMode === "AVALIACAO") processEvaluationCount += 1;
    if (update.processMode === "ADEQUACAO") adequacyCount += 1;
    if (update.processMode === "ADEQUACAO" && update.identifiedProcessKeys?.includes("processAmbiental")) adequacyAmbientalCount += 1;
    if (update.processMode === "ADEQUACAO" && update.identifiedProcessKeys?.includes("processParalelismo")) adequacyParalelismoCount += 1;
    if (update.identifiedProcessKeys?.length > 1) multiProcessCount += 1;
    if (update.processOnlyCompleted) processOnlyCompletedCount += 1;
    if (next.stage === "Processos" && isUnassignedOwner(next.processOwner)) processUnassignedCount += 1;
    if (next.stage === "Processos" && !isUnassignedOwner(next.processOwner)) processDirectAssignedCount += 1;

    const actor = currentUser || { fullName: "Sistema", login: "sistema", accessLevel: 100 };
    const linked = currentUser ? currentCollaborator() : null;
    changes.forEach((change) => {
      historyEntries.push({
        id: newId(),
        fullName: actor.fullName,
        login: actor.login,
        collaboratorName: linked?.name || "",
        accessLevel: actor.accessLevel,
        date: now,
        action: "Atualizacao de Status via planilha",
        osNumber: order.osNumber,
        oldValue: `${change.field}: ${change.oldValue}`,
        newValue: `${change.field}: ${change.newValue}`,
        detail: `Arquivo: ${fileName}. Campo alterado: ${change.field}. Origem da alteracao: Atualizacao de Status via planilha. Nenhuma OS nova foi criada.`
      });
    });

    return next;
  });

  const summary = [
    `Arquivo: ${fileName}`,
    `Total de ordens lidas: ${rows.length}`,
    `Ordens atualizadas: ${changed}`,
    `Ordens ignoradas por nao existirem: ${ignoredMissing}`,
    `Linhas sem OS: ${ignoredWithoutOs}`,
    `Enviadas para Pendencias: ${sentToPendencies}`,
    `Enviadas para Cancelada: ${sentToCancelada}`,
    `Enviadas para Suspensa: ${sentToSuspensa}`,
    `Enviadas para Processos: ${sentToProcessos}`,
    `Marcadas como PROCESSOS exclusivo: ${processExclusiveCount}`,
    `Marcadas como AVALIACAO: ${processEvaluationCount}`,
    `Marcadas como ADEQUACAO: ${adequacyCount}`,
    `Adequacoes Ambiental: ${adequacyAmbientalCount}`,
    `Adequacoes Paralelismo: ${adequacyParalelismoCount}`,
    `Processos sem responsavel: ${processUnassignedCount}`,
    `Processos atribuidos diretamente: ${processDirectAssignedCount}`,
    `Concluidas apenas processo: ${processOnlyCompletedCount}`,
    `Ordens com mais de um processo: ${multiProcessCount}`,
    `Marcadas como PROCESSOS sem tipo identificado: ${missingProcessTypeCount}`,
    `Datas de recebimento atualizadas: ${receivedDateUpdates}`,
    `Regionais atualizadas: ${regionalUpdates}`,
    `Regionais sem alteracao: ${regionalUnchanged}`,
    `Regionais com REGIAO/REGIONAL ausente ou vazia: ${regionalEmpty}`,
    `Erros na Regional: ${regionalErrors}`,
    `Atribuidas a cadistas: ${cadAssigned}`,
    `Atribuidas a orcamentistas: ${budgetAssigned}`,
    `Mantidas em Nao Tratado: ${keptUnassigned}`,
    `Nomes invalidos: ${invalidResponsibleNames}`,
    `Sem mudanca: ${unchanged}`
  ].join(". ");
  const actor = currentUser || { fullName: "Sistema", login: "sistema", accessLevel: 100 };
  const linked = currentUser ? currentCollaborator() : null;
  historyEntries.push({
    id: newId(),
    fullName: actor.fullName,
    login: actor.login,
    collaboratorName: linked?.name || "",
    accessLevel: actor.accessLevel,
    date: now,
    action: "Resumo da atualizacao de status por planilha",
    osNumber: "",
    oldValue: "",
    newValue: summary,
    detail: "Resumo salvo em lote para evitar falhas de gravacao durante importacoes grandes."
  });
  persist();
  render();
  desktopFinishImport(summary);
  setImportStatus(`Preparadas para salvar: ${changed}. Processos: ${sentToProcessos}. Concluidas so processo: ${processOnlyCompletedCount}. Adequacoes: ${adequacyCount}. Avaliacoes: ${processEvaluationCount}. Sem tipo: ${missingProcessTypeCount}.`, "");
  alert(`Leitura concluida; o salvamento ainda depende da validacao do servidor.\n\nTotal de ordens lidas na planilha: ${rows.length}\nOrdens atualizadas: ${changed}\nOrdens ignoradas por nao existirem: ${ignoredMissing}\nRegionais atualizadas: ${regionalUpdates}\nRegionais sem alteracao: ${regionalUnchanged}\nColuna I vazia: ${regionalEmpty}\nErros na atualizacao da Regional: ${regionalErrors}\nOrdens atribuidas a cadistas: ${cadAssigned}\nOrdens atribuidas a orcamentistas: ${budgetAssigned}\nOrdens mantidas em Nao Tratado: ${keptUnassigned}\nNomes invalidos: ${invalidResponsibleNames}\nOrdens enviadas para Pendencias: ${sentToPendencies}\nOrdens enviadas para Cancelada: ${sentToCancelada}\nOrdens enviadas para Suspensa: ${sentToSuspensa}\nOrdens enviadas para Processos: ${sentToProcessos}\nPROCESSOS exclusivo: ${processExclusiveCount}\nConcluidas apenas processo: ${processOnlyCompletedCount}\nAVALIACAO: ${processEvaluationCount}\nADEQUACAO: ${adequacyCount}\nAdequacoes Ambiental: ${adequacyAmbientalCount}\nAdequacoes Paralelismo: ${adequacyParalelismoCount}\nProcessos sem responsavel: ${processUnassignedCount}\nProcessos atribuidos diretamente: ${processDirectAssignedCount}\nOrdens com mais de um processo: ${multiProcessCount}\nMarcadas como PROCESSOS sem tipo identificado: ${missingProcessTypeCount}\nDatas de recebimento atualizadas: ${receivedDateUpdates}\nLinhas sem OS: ${ignoredWithoutOs}\nSem mudanca: ${unchanged}\n\nNenhuma OS nova foi adicionada.`);
}
function setImportStatus(message, type = "") {
  if(type==='error' && desktopImportContext)desktopFinishImport('Falha na leitura: '+message);
  elements.importStatus.textContent = message;
  elements.importStatus.className = `import-status ${type}`.trim();
}

function csvToRows(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const firstLine = lines.shift() || "";
  const delimiter = firstLine.includes(";") ? ";" : firstLine.includes("\t") ? "\t" : ",";
  const headers = firstLine.split(delimiter).map((item) => item.trim());
  return lines.map((line) => {
    const values = line.split(delimiter);
    const item = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
    Object.defineProperty(item, "__rowValues", {
      value: values,
      enumerable: false
    });
    return item;
  });
}

function csvToArrayRows(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const firstLine = lines[0] || "";
  const delimiter = firstLine.includes(";") ? ";" : firstLine.includes("\t") ? "\t" : ",";
  return lines.map((line) => line.split(delimiter).map((value) => value.trim()));
}

function importDailyRows(rows, fileName = "base diaria") {
  const dataRows = rows.filter((row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim()));
  if (!dataRows.length) {
    throw new Error("Nenhuma linha valida encontrada na planilha.");
  }
  const existingNumbers = new Set(orders.map((order) => normalizeOrderNumber(order.osNumber)));
  const imported = [];
  let ignored = 0;
  let priorityCount = 0;
  let remoteCount = 0;

  for (const row of dataRows) {
    const order = mapDailyRow(row);
    if (!order.osNumber || normalizeHeader(order.osNumber).includes("numerodaordem")) continue;
    const key = normalizeOrderNumber(order.osNumber);
    if (!key || existingNumbers.has(key)) {
      ignored += 1;
      continue;
    }
    existingNumbers.add(key);
    if (order.priority === "Alta") priorityCount += 1;
    if (order.remoteOrder) remoteCount += 1;
    imported.push(order);
  }

  orders = [...imported, ...orders];
  persist();
  const summary = `Arquivo: ${fileName}. Encontradas: ${dataRows.length}. Novas: ${imported.length}. Ignoradas: ${ignored}. Prioridade: ${priorityCount}. Remotas: ${remoteCount}.`;
  audit("ImportaÃƒÂ§ÃƒÂ£o de base diÃƒÂ¡ria", "", "", summary);
  imported.filter((order) => order.remoteOrder).forEach((order) => {
    audit(
      "Entrada na baia Remoto",
      order.osNumber,
      "Importacao XLSX",
      "Levantamento de Campo / Remoto",
      `Ordem apta para remoto importada em ${new Date().toLocaleString("pt-BR")}.`
    );
  });
  render();
  setImportStatus(`Importado: ${imported.length} novas, ${ignored} ignoradas.`, "success");
  alert(`Importacao concluida:\n\nOrdens encontradas: ${dataRows.length}\nNovas adicionadas: ${imported.length}\nIgnoradas existentes: ${ignored}\nCom prioridade: ${priorityCount}\nRemotas: ${remoteCount}`);
}

function mapDailyRow(row) {
  const get = (index) => row[index - 1] ?? "";
  const priorityText = String(get(7) || "").trim();
  const remoteText = String(get(24) || "").trim();
  const isRemote = remoteImportFlag(remoteText);
  return makeOrder({
    osNumber: cleanOrderNumber(get(1)),
    ans: calculatedAnsValue(today()),
    priority: priorityByAnsDays(daysSince(today())),
    clientName: String(get(8) || "").trim(),
    city: String(get(9) || "").trim(),
    regional: String(get(10) || "").trim(),
    orderValidator: String(get(13) || "").trim(),
    remoteOrder: isRemote,
    fieldStatus: isRemote ? "Remoto" : "Roteirizacao",
    notes: remoteText ? `Ordem remota: ${remoteText}` : "",
    stage: stages[0],
    owner: "Sem Responsavel",
    raw: {
      source: "base-diaria",
      columns: row
    }
  });
}

function cleanOrderNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const cleaned = text.replace(/^0+(?=\d)/, "");
  return cleaned || "0";
}

function sharePointLinkForOrder(osNumber) {
  const os = cleanOrderNumber(osNumber);
  if (!os) return "";
  return `${sharePointOrderSearchUrl}&q=${encodeURIComponent(os)}`;
}

function isAutoSharePointOrderLink(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  try {
    const url = new URL(text);
    return url.hostname === "portalsatelbrasil.sharepoint.com"
      && url.pathname.includes("/sites/SatelCE/")
      && url.searchParams.has("q");
  } catch {
    return false;
  }
}

function refreshSharePointLinkField() {
  const generatedLink = sharePointLinkForOrder(fields.osNumber.value);
  if (generatedLink && (!fields.filesLink.value || isAutoSharePointOrderLink(fields.filesLink.value))) {
    fields.filesLink.value = generatedLink;
  }
  const targetLink = fields.filesLink.value || generatedLink;
  if (elements.sharePointButton) {
    elements.sharePointButton.href = targetLink || "#";
    elements.sharePointButton.hidden = !targetLink;
  }
  if (elements.openFilesLinkButton) {
    elements.openFilesLinkButton.disabled = !targetLink;
  }
}

function openFilesLink() {
  refreshSharePointLinkField();
  const link = fields.filesLink.value.trim();
  if (!link) {
    alert("Nenhum link de arquivos informado para esta OS.");
    return;
  }
  window.open(link, "_blank", "noopener");
}

function normalizeOrderNumber(value) {
  return cleanOrderNumber(value).toUpperCase();
}

function normalizeHeader(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeDate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return date.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return "";
}

function exportJson() {
  if (!requirePermission("exportData")) return;
  const blob = new Blob([JSON.stringify({ orders, collaborators, historyEntries }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ordem-certa-backup-${today()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  audit("ExportaÃƒÂ§ÃƒÂ£o de dados", "", "", "Backup JSON gerado");
}

function monthlyExportDateCandidates(order) {
  const processDetails = normalizeProcessDetails(order);
  return [
    order.receivedDate,
    order.startDate,
    order.finishDate,
    order.completedAt,
    order.updatedAt,
    order.createdAt,
    order.rejectedAt,
    order.rejectionResolvedAt,
    order.processStartDate,
    order.processEndDate,
    order.processState?.openedAt,
    order.processState?.closedAt,
    order.pendencyState?.openedAt,
    order.pendencyState?.resolvedAt,
    ...Object.values(order.statusImport || {}),
    ...Object.values(processDetails).map((detail) => detail.endDate)
  ].map(dateOnly).filter(Boolean);
}

function orderMatchesExportMonth(order, month) {
  if (!month) return true;
  return monthlyExportDateCandidates(order).some((date) => date.startsWith(month));
}

function isCanceledOrSuspendedOrder(order) {
  const values = [order.stage, stageStatus(order), order.fieldStatus, order.cadStatus, order.budgetStatus, order.finalStatus]
    .map(normalizeStatus);
  return values.some((value) => ["CANCELADO", "CANCELADA", "SUSPENSO", "SUSPENSA"].includes(value));
}

function isConcludedOrder(order) {
  const values = [order.stage, stageStatus(order), order.finalStatus].map(normalizeStatus);
  return values.includes("CONCLUIDO") || values.includes("FINALIZADO") || Boolean(order.completedAt || order.finishDate);
}

function orderMatchesExportType(order, type) {
  if (type === "open") return !isConcludedOrder(order) && !isCanceledOrSuspendedOrder(order);
  if (type === "concluded") return isConcludedOrder(order);
  if (type === "cancelSusp") return isCanceledOrSuspendedOrder(order);
  if (type === "pendencies") return orderPendencies(order).length > 0 || Boolean(order.pendencyState?.active);
  return true;
}

function orderExportTypeLabel(type) {
  return {
    all: "Todas existentes",
    open: "Nao concluidas",
    concluded: "Concluidas",
    cancelSusp: "Canceladas e suspensas",
    pendencies: "Com pendencias"
  }[type] || "Todas existentes";
}

function processDetailsSummary(order) {
  const details = normalizeProcessDetails(order);
  return processTabs
    .filter((process) => order[process.key])
    .map((process) => {
      const detail = details[process.key] || {};
      return `${process.label}: ${detail.owners || unassignedLabel}${detail.endDate ? ` / concluido em ${detail.endDate}` : ""}${detail.pendingDays !== "" && detail.pendingDays !== undefined ? ` / ${detail.pendingDays} dias entre fechamento e conclusao` : ""}${detail.notes ? ` / obs: ${detail.notes}` : ""}`;
    })
    .join(" | ");
}

function orderToExportRow(order) {
  const voices = normalizeVoices(order);
  const details = normalizeProcessDetails(order);
  const info = deadlineInfo(order);
  const row = {
    "Numero da OS": order.osNumber || "",
    "Cliente": order.clientName || "",
    "Municipio": order.city || "",
    "Coordenada X UTM 24S": order.coordinateX || "",
    "Coordenada Y UTM 24S": order.coordinateY || "",
    "Regional": order.regional || "",
    "Etapa": order.stage || "",
    "Status atual": stageStatus(order),
    "Responsavel atual": displayOwnerName(order.owner || unassignedOwner),
    "Tecnico": order.fieldTech || "",
    "Cadista": order.cadist || "",
    "Orcamentista": order.budgeter || "",
    "Responsavel processo": order.processOwner || "",
    "Data de Recebimento": order.receivedDate || "",
    "ANS calculado": calculatedAnsValue(order.receivedDate),
    "Prazo ANS": info.label,
    "Prioridade": order.priority || info.priority || "",
    "Status Campo": order.fieldStatus || "",
    "Status CAD": order.cadStatus || "",
    "Status Orcamento": order.budgetStatus || "",
    "Status Processo": order.processStatus || "",
    "Pendencias": orderPendencies(order).join(", "),
    "Pendencia ativa": order.pendencyState?.active ? "Sim" : "Nao",
    "Observacao pendencia": order.pendencyState?.note || "",
    "Processos marcados": selectedProcessLabels(order).join(", "),
    "Dados de processos": processDetailsSummary(order),
    "Observacoes": order.notes || "",
    "Link arquivos": order.filesLink || "",
    "Link SharePoint": sharePointLinkForOrder(order.osNumber),
    "Ordem remota": order.remoteOrder ? "Sim" : "Nao",
    "Remoto avaliado": order.remoteEvaluated ? "Sim" : "Nao",
    "Destino avaliacao remota": order.remoteEvaluationDestination || "",
    "Remoto direto para CAD": order.remoteFastTrack ? "Sim" : "Nao",
    "Data criacao": order.createdAt || "",
    "Ultima atualizacao": order.updatedAt || "",
    "Data conclusao": order.finishDate || order.completedAt || "",
    "Rejeitada em": order.rejectedAt || "",
    "Rejeicao corrigida em": order.rejectionResolvedAt || ""
  };
  processTabs.forEach((process) => {
    const detail = details[process.key] || {};
    row[`Processo - ${process.label}`] = order[process.key] ? "Sim" : "Nao";
    row[`Responsavel - ${process.label}`] = detail.owners || "";
    row[`Conclusao - ${process.label}`] = detail.endDate || "";
    row[`Obs - ${process.label}`] = detail.notes || "";
  });
  voiceDefinitions.forEach((voice) => {
    const value = voices[voice.key] || {};
    row[`${voice.label} - Tipo`] = value.type || "";
    row[`${voice.label} - Postes`] = value.poles ?? "";
    row[`${voice.label} - Codigo`] = value.code || "";
    row[`${voice.label} - Repeticao`] = value.repeat || "";
  });
  return row;
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadOrdersCsv(rows, filename) {
  const headers = Object.keys(rows[0] || { "Sem dados": "" });
  const csv = [headers.map(csvCell).join(";"), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(";"))].join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/\.xlsx$/i, ".csv");
  link.click();
  URL.revokeObjectURL(url);
}

function exportOrdersXlsx() {
  if (!requirePermission("exportData")) return;
  const month = elements.ordersExportMonth?.value || "";
  const type = elements.ordersExportType?.value || "all";
  const rows = orders
    .filter((order) => orderMatchesExportMonth(order, month))
    .filter((order) => orderMatchesExportType(order, type))
    .map(orderToExportRow);
  const label = orderExportTypeLabel(type);
  const filename = `ordens-${slug(label)}-${month || "todos-os-meses"}.xlsx`;
  if (!rows.length) {
    alert(`Nenhuma ordem encontrada para ${label}${month ? ` em ${month}` : ""}.`);
    return;
  }
  if (!window.XLSX) {
    downloadOrdersCsv(rows, filename);
    audit("Exportacao de planilha de ordens", "", "", `CSV gerado. Tipo: ${label}. Mes: ${month || "Todos"}. Total: ${rows.length}`);
    return;
  }
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Ordens");
  XLSX.writeFile(workbook, filename);
  audit("Exportacao de planilha de ordens", "", "", `XLSX gerado. Tipo: ${label}. Mes: ${month || "Todos"}. Total: ${rows.length}`);
}

function summarizeOrder(order) {
  const voices = voiceSummary(order);
  return `${order.stage} | ${order.owner || "Sem Responsavel"} | ${stageStatus(order)} | ${voices ? `${voices} | ` : ""}${order.notes || ""}`;
}

function cleanAuditText(value) {
  return String(value ?? "")
    .replaceAll("EdiÃƒÂ§ÃƒÂ£o", "Edicao")
    .replaceAll("EdiÃ§Ã£o", "Edicao")
    .replaceAll("Edi��o", "Edicao")
    .replaceAll("CriaÃƒÂ§ÃƒÂ£o", "Criacao")
    .replaceAll("CriaÃ§Ã£o", "Criacao")
    .replaceAll("ExclusÃƒÂ£o", "Exclusao")
    .replaceAll("ExclusÃ£o", "Exclusao")
    .replaceAll("AlteraÃƒÂ§ÃƒÂ£o", "Alteracao")
    .replaceAll("AlteraÃ§Ã£o", "Alteracao")
    .replaceAll("avanÃƒÂ§o", "avanco")
    .replaceAll("avanÃ§o", "avanco")
    .replaceAll("AtribuiÃƒÂ§ÃƒÂ£o", "Atribuicao")
    .replaceAll("AtribuiÃ§Ã£o", "Atribuicao")
    .replaceAll("MovimentaÃƒÂ§ÃƒÂ£o", "Movimentacao")
    .replaceAll("MovimentaÃ§Ã£o", "Movimentacao")
    .replaceAll("atualizaÃ§Ã£o", "atualizacao")
    .replaceAll("atualizaÃƒÂ§ÃƒÂ£o", "atualizacao")
    .replaceAll("responsÃƒÂ¡vel", "responsavel")
    .replaceAll("responsÃ¡vel", "responsavel")
    .replaceAll("ImportaÃƒÂ§ÃƒÂ£o", "Importacao")
    .replaceAll("ImportaÃ§Ã£o", "Importacao")
    .replaceAll("diÃƒÂ¡ria", "diaria")
    .replaceAll("diÃ¡ria", "diaria")
    .replaceAll("usuÃƒÂ¡rios", "usuarios")
    .replaceAll("usuÃ¡rios", "usuarios")
    .replaceAll("ExportaÃƒÂ§ÃƒÂ£o", "Exportacao")
    .replaceAll("ExportaÃ§Ã£o", "Exportacao");
}

function normalizeHistoryEntries(entries) {
  return Array.isArray(entries) ? entries.map((entry) => ({
    ...entry,
    fullName: cleanAuditText(entry.fullName),
    login: cleanAuditText(entry.login),
    collaboratorName: cleanAuditText(entry.collaboratorName),
    action: cleanAuditText(entry.action),
    osNumber: cleanAuditText(entry.osNumber),
    oldValue: cleanAuditText(entry.oldValue),
    newValue: cleanAuditText(entry.newValue),
    detail: cleanAuditText(entry.detail)
  })) : [];
}

function audit(action, osNumber = "", oldValue = "", newValue = "", detail = "") {
  const actor = currentUser || { fullName: "Sistema", login: "sistema", accessLevel: 100 };
  const linked = currentUser ? currentCollaborator() : null;
  historyEntries.push({
    id: newId(),
    fullName: actor.fullName,
    login: actor.login,
    collaboratorName: linked?.name || "",
    accessLevel: actor.accessLevel,
    date: new Date().toISOString(),
    action: cleanAuditText(action),
    osNumber: cleanAuditText(osNumber),
    oldValue: cleanAuditText(oldValue),
    newValue: cleanAuditText(newValue),
    detail: cleanAuditText(detail)
  });
  persist();
}

function renderUsers() {
  renderUserCollaboratorOptions();
  const linkedUsers = new Set();
  const collaboratorRows = collaborators.map((person) => {
    const user = users.find((item) => item.collaboratorId === person.id);
    if (user) linkedUsers.add(user.id);
    const processNames = processTabs.filter((process) => collaboratorProcesses(person).includes(process.key)).map((process) => process.label);
    return `
    <div class="user-item unified-person-item">
      <div>
        <strong>${escapeHtml(user?.fullName || person.name)}</strong>
        <div class="user-meta">
          <span>Login: ${escapeHtml(user?.login || "Sem login")}</span>
          <span>${user ? roleName(user.accessLevel) : "Sem acesso"}</span>
          <span>Nivel ${user?.accessLevel ?? "-"}</span>
          <span>Fila: ${person.queueActive === false ? "Inativa" : "Ativa"}</span>
        </div>
        <div class="os-sub">Etapas: ${person.stages?.length ? person.stages.map(escapeHtml).join(" / ") : "Nenhuma"}</div>
        <div class="os-sub">Processos: ${processNames.length ? processNames.map(escapeHtml).join(" / ") : "Nenhum"}</div>
      </div>
      <div class="collaborator-actions">
        <button type="button" data-action="edit-person" data-user-id="${user?.id || ""}" data-collaborator-id="${person.id}">Editar</button>
        ${user ? `<button type="button" data-action="reset-user" data-id="${user.id}">Resetar</button>` : ""}
        ${user ? `<button type="button" data-action="delete-user" data-id="${user.id}">Excluir acesso</button>` : `<button type="button" data-action="delete-collaborator" data-id="${person.id}">Excluir</button>`}
      </div>
    </div>
  `;
  });
  const orphanUserRows = users.filter((user) => !linkedUsers.has(user.id)).map((user) => `
    <div class="user-item unified-person-item">
      <div>
        <strong>${escapeHtml(user.fullName)}</strong>
        <div class="user-meta">
          <span>Login: ${escapeHtml(user.login)}</span>
          <span>Sem colaborador vinculado</span>
          <span>${roleName(user.accessLevel)}</span>
          <span>Nivel ${user.accessLevel}</span>
        </div>
      </div>
      <div class="collaborator-actions">
        <button type="button" data-action="edit-person" data-user-id="${user.id}" data-collaborator-id="">Editar</button>
        <button type="button" data-action="reset-user" data-id="${user.id}">Resetar</button>
        <button type="button" data-action="delete-user" data-id="${user.id}">Excluir acesso</button>
      </div>
    </div>
  `);
  elements.userList.innerHTML = [...collaboratorRows, ...orphanUserRows].join("") || `<div class="history-item">Nenhuma pessoa cadastrada.</div>`;
}

function renderUserCollaboratorOptions() {
  const selected = elements.userCollaboratorId.value;
  elements.userCollaboratorId.innerHTML = `<option value="">Selecione...</option>` + collaborators
    .map((person) => `<option value="${person.id}" ${person.id === selected ? "selected" : ""}>${escapeHtml(person.name)}</option>`)
    .join("");
}

function allowedAdminTab(tab) {
  return hasPermission("admin") || tab === "data";
}

function applyAdminTabPermissions() {
  if (!elements.adminTabs?.length) return;
  elements.adminTabs.forEach((button) => {
    button.hidden = !allowedAdminTab(button.dataset.adminTab);
  });
  const activeTab = [...elements.adminTabs].find((button) => button.classList.contains("active"))?.dataset.adminTab;
  if (activeTab && !allowedAdminTab(activeTab)) showAdminTab("data");
}

function showAdminTab(tab) {
  const targetTab = allowedAdminTab(tab) ? tab : "data";
  elements.adminTabs.forEach((button) => button.classList.toggle("active", button.dataset.adminTab === targetTab));
  elements.adminSections.forEach((section) => section.classList.toggle("active", section.id === `adminTab${capitalize(targetTab)}`));
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function renderPermissionsTable() {
  const rows = [
    ["0 a 50", "Consulta", "Apenas abas Ordens e Processos"],
    ["51 a 60", "Lider", "Ordens e Dashboard"],
    ["61 a 70", "Supervisor", "Visualizacao e Gestao de Dados para importacoes/exportacoes"],
    ["71 a 80", "Supervisor avancado", "Movimentacao manual de ordens por arrastar e soltar"],
    ["81 a 90", "Gestor", "Criar OS e usar a Gestao de Dados"],
    ["91 a 100", "Administrador Master", "Controle total, usuarios, permissoes, exclusoes e auditoria"]
  ];
  elements.permissionsTable.innerHTML = rows.map(([level, role, description]) => `
    <div class="permission-row">
      <strong>Nivel ${level} - ${role}</strong>
      <div class="permission-meta">${description}</div>
    </div>
  `).join("");
}

function queueInputByStage(stage) {
  return {
    "Levantamento de Campo": elements.queueCampo,
    "Criacao de CAD": elements.queueCad,
    "Orcamento": elements.queueOrcamento
  }[stage];
}

function queueOrderFromForm(stage) {
  const input = queueInputByStage(stage);
  return Math.max(1, Number(input?.value || 1));
}

function nextQueueOrderForStage(stage, ignoredCollaboratorId = "") {
  const used = collaborators
    .filter((person) => person.id !== ignoredCollaboratorId && person.stages?.includes(stage))
    .map((person) => Number(person.queueOrder?.[stage] || 0))
    .filter((value) => value > 0);
  return used.length ? Math.max(...used) + 1 : 1;
}

function setNextQueueOrderDefaults(ignoredCollaboratorId = "") {
  ["Levantamento de Campo", "Criacao de CAD", "Orcamento"].forEach((stage) => {
    const input = queueInputByStage(stage);
    if (input) input.value = nextQueueOrderForStage(stage, ignoredCollaboratorId);
  });
}

function duplicatedQueueStage(selectedStages, queueOrder, collaboratorId) {
  return selectedStages.find((stage) => collaborators.some((person) =>
    person.id !== collaboratorId &&
    person.stages?.includes(stage) &&
    Number(person.queueOrder?.[stage] || 0) === Number(queueOrder[stage] || 0)
  ));
}

async function saveUser(event) {
  event.preventDefault();
  if (!requirePermission("admin")) return;
  const userId = elements.userId.value || newId();
  const collaboratorId = elements.collaboratorId.value || elements.userCollaboratorId.value || newId();
  const existingUser = users.find((user) => user.id === userId);
  const existingCollaborator = collaborators.find((person) => person.id === collaboratorId);
  const password = elements.userPassword.value;
  const selectedStages = [...document.querySelectorAll("input[name='permission']:checked")].map((input) => input.value);
  const selectedProcesses = [...document.querySelectorAll("input[name='processPermission']:checked")].map((input) => input.value);
  const personName = elements.userFullName.value.trim();
  const queueOrder = {
    "Levantamento de Campo": queueOrderFromForm("Levantamento de Campo"),
    "Criacao de CAD": queueOrderFromForm("Criacao de CAD"),
    "Orcamento": queueOrderFromForm("Orcamento")
  };
  const duplicatedStage = duplicatedQueueStage(selectedStages, queueOrder, collaboratorId);
  if (duplicatedStage) {
    alert(`Ja existe uma pessoa na posicao ${queueOrder[duplicatedStage]} da fila de ${duplicatedStage}. Use o proximo numero disponivel.`);
    return;
  }
  const collaborator = {
    id: collaboratorId,
    name: personName,
    stages: selectedStages,
    processes: selectedProcesses,
    queueActive: elements.queueActive.checked,
    queueOrder
  };
  if (existingCollaborator?.name && existingCollaborator.name !== collaborator.name) {
    orders = orders.map((order) => order.owner === existingCollaborator.name ? { ...order, owner: collaborator.name } : order);
  }
  collaborators = existingCollaborator
    ? collaborators.map((item) => item.id === collaborator.id ? collaborator : item)
    : [collaborator, ...collaborators];
  const user = {
    ...(existingUser || {}),
    id: userId,
    fullName: personName,
    login: elements.userLoginName.value.trim(),
    collaboratorId,
    accessLevel: Math.max(0, Math.min(100, Number(elements.userAccessLevel.value || 0))),
    passwordHash: password ? await hashPassword(password) : existingUser?.passwordHash || ""
  };
  users = existingUser ? users.map((item) => item.id === userId ? user : item) : [user, ...users];
  elements.userForm.reset();
  elements.userId.value = "";
  elements.collaboratorId.value = "";
  elements.userCollaboratorId.value = "";
  elements.queueActive.checked = true;
  setNextQueueOrderDefaults();
  persist();
  audit("Alteracao administrativa", "", existingUser ? existingUser.login : "", `Pessoa ${user.login} salva`);
  render();
}

function editUser(id) {
  const user = users.find((item) => item.id === id);
  editPerson(user?.id || "", user?.collaboratorId || "");
}

function editPerson(userId, collaboratorId) {
  const user = users.find((item) => item.id === userId);
  const person = collaborators.find((item) => item.id === collaboratorId) || collaborators.find((item) => item.id === user?.collaboratorId);
  elements.userId.value = user?.id || "";
  elements.collaboratorId.value = person?.id || "";
  elements.userCollaboratorId.value = person?.id || "";
  elements.userFullName.value = user?.fullName || person?.name || "";
  elements.userLoginName.value = user?.login || "";
  elements.userPassword.value = "";
  elements.userAccessLevel.value = user?.accessLevel ?? 0;
  if (person) {
    elements.queueCampo.value = person.queueOrder?.["Levantamento de Campo"] || 1;
    elements.queueCad.value = person.queueOrder?.["Criacao de CAD"] || 1;
    elements.queueOrcamento.value = person.queueOrder?.["Orcamento"] || 1;
  } else {
    setNextQueueOrderDefaults();
  }
  elements.queueActive.checked = person?.queueActive !== false;
  document.querySelectorAll("input[name='permission']").forEach((input) => {
    input.checked = Boolean(person?.stages?.includes(input.value));
  });
  document.querySelectorAll("input[name='processPermission']").forEach((input) => {
    input.checked = person ? collaboratorProcesses(person).includes(input.value) : false;
  });
}

async function resetUser(id) {
  if (!requirePermission("admin")) return;
  users = await Promise.all(users.map(async (user) => user.id === id ? { ...user, passwordHash: await hashPassword("123456") } : user));
  persist();
  audit("Reset de senha", "", "", `Usuario ${users.find((user) => user.id === id)?.login || id}`);
  render();
  alert("Senha resetada para 123456.");
}

function deleteUser(id) {
  if (!requirePermission("admin")) return;
  const user = users.find((item) => item.id === id);
  users = users.filter((item) => item.id !== id);
  persist();
  audit("AlteraÃƒÂ§ÃƒÂ£o administrativa", "", user?.login || "", "Usuario excluido");
  render();
}

async function importUsersCsv(file) {
  if (!requirePermission("admin") || !file) return;
  const text = await file.text();
  const imported = await usersFromRows(csvToRows(text));
  if (!imported.length) {
    alert("Nenhum usuario valido encontrado no CSV.");
    return;
  }
  users = imported;
  persist();
  audit("ImportaÃƒÂ§ÃƒÂ£o de usuÃƒÂ¡rios", "", "", `${imported.length} usuarios importados`);
  render();
}

function renderAuditFilters() {
  const currentUserFilter = elements.auditUserFilter.value || "Todos";
  const currentActionFilter = elements.auditActionFilter.value || "Todas";
  const usersOptions = ["Todos", ...new Set(historyEntries.map((entry) => entry.login).filter(Boolean))];
  const actionOptions = ["Todas", ...new Set(historyEntries.map((entry) => entry.action).filter(Boolean))];
  elements.auditUserFilter.innerHTML = usersOptions.map((item) => `<option ${item === currentUserFilter ? "selected" : ""}>${escapeHtml(item)}</option>`).join("");
  elements.auditActionFilter.innerHTML = actionOptions.map((item) => `<option ${item === currentActionFilter ? "selected" : ""}>${escapeHtml(item)}</option>`).join("");
}

function filteredAudit() {
  const search = elements.auditSearch.value.trim().toLowerCase();
  const user = elements.auditUserFilter.value || "Todos";
  const os = elements.auditOsFilter.value.trim().toLowerCase();
  const action = elements.auditActionFilter.value || "Todas";
  const start = elements.auditStartDate.value ? new Date(`${elements.auditStartDate.value}T00:00:00`) : null;
  const end = elements.auditEndDate.value ? new Date(`${elements.auditEndDate.value}T23:59:59`) : null;
  return historyEntries.filter((entry) => {
    const date = new Date(entry.date);
    const text = `${entry.fullName} ${entry.login} ${entry.action} ${entry.osNumber} ${entry.oldValue} ${entry.newValue}`.toLowerCase();
    return (!search || text.includes(search))
      && (user === "Todos" || entry.login === user)
      && (!os || String(entry.osNumber || "").toLowerCase().includes(os))
      && (action === "Todas" || entry.action === action)
      && (!start || date >= start)
      && (!end || date <= end);
  });
}

function exportAuditCsv() {
  if (!requirePermission("audit")) return;
  const header = ["Data", "Usuario", "Login", "Acao", "OS", "Valor anterior", "Novo valor", "Detalhe"];
  const rows = filteredAudit().map((entry) => [
    new Date(entry.date).toLocaleString("pt-BR"),
    entry.fullName,
    entry.login,
    entry.action,
    entry.osNumber,
    entry.oldValue,
    entry.newValue,
    entry.detail
  ]);
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell || "").replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `auditoria-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  audit("ExportaÃƒÂ§ÃƒÂ£o de auditoria", "", "", "CSV gerado");
}

function exportAuditPdf() {
  if (!requirePermission("audit")) return;
  const rows = filteredAudit().map((entry) => `
    <tr><td>${new Date(entry.date).toLocaleString("pt-BR")}</td><td>${escapeHtml(entry.fullName)}</td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.osNumber || "")}</td><td>${escapeHtml(entry.oldValue || "")}</td><td>${escapeHtml(entry.newValue || "")}</td><td>${escapeHtml(entry.detail || "")}</td></tr>
  `).join("");
  const win = window.open("", "_blank");
  win.document.write(`<title>Auditoria</title><h1>Auditoria Ordem Certa</h1><table border="1" cellspacing="0" cellpadding="6"><tr><th>Data</th><th>Usuario</th><th>Acao</th><th>OS</th><th>Anterior</th><th>Novo</th><th>Detalhe</th></tr>${rows}</table>`);
  win.document.close();
  win.print();
  audit("ExportaÃƒÂ§ÃƒÂ£o de auditoria", "", "", "PDF gerado");
}

elements.loginForm.addEventListener("submit", login);
elements.logoutButton.addEventListener("click", logout);
if (elements.profileForm) elements.profileForm.addEventListener("submit", saveProfile);
if (elements.passwordForm) elements.passwordForm.addEventListener("submit", changeOwnPassword);
if (elements.profilePhotoInput) elements.profilePhotoInput.addEventListener("change", handleProfilePhotoChange);
if (elements.profilePhotoRemove) elements.profilePhotoRemove.addEventListener("click", removeProfilePhoto);
if (elements.distributionToggleButton) elements.distributionToggleButton.addEventListener("click", toggleDistributionPanel);
elements.navItems.forEach((item) => item.addEventListener("click", () => showScreen(item.dataset.screen)));
elements.adminTabs.forEach((button) => button.addEventListener("click", () => showAdminTab(button.dataset.adminTab)));
elements.newOrderButton.addEventListener("click", () => {
  if (requirePermission("createOrder")) openOrder();
});
if (elements.exportButton) elements.exportButton.addEventListener("click", exportJson);
if (elements.exportOrdersXlsxButton) elements.exportOrdersXlsxButton.addEventListener("click", exportOrdersXlsx);
elements.importInput.addEventListener("change", async (event) => {
  try {
    await importFile(event.target.files[0]);
  } finally {
    event.target.value = "";
  }
});
if (elements.statusUpdateInput) {
  elements.statusUpdateInput.addEventListener("change", async (event) => {
    try {
      await importStatusFile(event.target.files[0]);
    } finally {
      event.target.value = "";
    }
  });
}
if (elements.fieldUpdateInput) {
  elements.fieldUpdateInput.addEventListener("change", async (event) => {
    try {
      await importFieldUpdateFile(event.target.files[0]);
    } finally {
      event.target.value = "";
    }
  });
}
if (elements.coordinatesInput) {
  elements.coordinatesInput.addEventListener("change", async (event) => {
    try {
      await importCoordinatesFile(event.target.files[0]);
    } finally {
      event.target.value = "";
    }
  });
}
if (elements.linkedStatusButton) {
  elements.linkedStatusButton.addEventListener("click", importLinkedStatusWorkbook);
}
elements.searchInput.addEventListener("input", renderBoard);
elements.urgencyFilter.addEventListener("change", renderBoard);
elements.processSearchInput.addEventListener("input", renderProcesses);
elements.processUrgencyFilter.addEventListener("change", renderProcesses);
if (elements.adequacySearchInput) elements.adequacySearchInput.addEventListener("input", renderAdequacies);
if (elements.adequacyUrgencyFilter) elements.adequacyUrgencyFilter.addEventListener("change", renderAdequacies);
elements.pendencySearchInput.addEventListener("input", renderPendencies);
if (elements.pendencyTypeFilter) elements.pendencyTypeFilter.addEventListener("change", renderPendencies);
[elements.dashboardStageFilter, elements.dashboardCollaboratorFilter, elements.dashboardRegionalFilter, elements.dashboardDeadlineFilter, elements.dashboardProcessFilter, elements.dashboardPendencyFilter, elements.dashboardPeriodPreset, elements.dashboardStartDate, elements.dashboardEndDate]
  .filter(Boolean)
  .forEach((input) => input.addEventListener("change", renderDashboard));
[elements.dashboardStartDate, elements.dashboardEndDate].filter(Boolean).forEach((input) => input.addEventListener("input", () => {
  if (elements.dashboardPeriodPreset) elements.dashboardPeriodPreset.value = "custom";
  renderDashboard();
}));
document.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='field-status']");
  if (!button || !elements.kanbanBoard.contains(button)) return;
  event.preventDefault();
  event.stopPropagation();
  changeFieldStatus(button.dataset.id, button.dataset.status);
}, true);
elements.kanbanBoard.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "open") openOrder(orders.find((order) => order.id === button.dataset.id));
  if (button.dataset.action === "pendency") openPendencyModal(orders.find((order) => order.id === button.dataset.id));
  if (button.dataset.action === "next") moveToNextStage(button.dataset.id);
  if (button.dataset.action === "field-status") changeFieldStatus(button.dataset.id, button.dataset.status);
});
elements.processGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "open") openOrder(orders.find((order) => order.id === button.dataset.id));
  if (button.dataset.action === "pendency") openPendencyModal(orders.find((order) => order.id === button.dataset.id));
  if (button.dataset.action === "next") moveToNextStage(button.dataset.id);
});
if (elements.adequacyGrid) {
  elements.adequacyGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "open") openOrder(orders.find((order) => order.id === button.dataset.id));
    if (button.dataset.action === "pendency") openPendencyModal(orders.find((order) => order.id === button.dataset.id));
    if (button.dataset.action === "next") moveToNextStage(button.dataset.id);
  });
}
elements.pendencyList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "open") openOrder(orders.find((order) => order.id === button.dataset.id));
  if (button.dataset.action === "pendency") openPendencyModal(orders.find((order) => order.id === button.dataset.id));
  if (button.dataset.action === "send-cancelada") sendPendencyOrderToTerminalStage(button.dataset.id, "Cancelada");
  if (button.dataset.action === "send-suspensa") sendPendencyOrderToTerminalStage(button.dataset.id, "Suspensa");
});
elements.orderForm.addEventListener("submit", saveOrder);
elements.closeModalButton.addEventListener("click", () => elements.modal.close());
elements.closePendencyButton.addEventListener("click", () => elements.pendencyModal.close());
elements.pendencyForm.addEventListener("submit", savePendencies);
elements.deleteOrderButton.addEventListener("click", deleteCurrentOrder);
elements.returnToCadButton.addEventListener("click", returnCurrentOrderToField);
elements.returnToCadStageButton.addEventListener("click", returnCurrentOrderToCad);
elements.nextStageButton.addEventListener("click", () => {
  if (!fields.orderId.value) return;
  moveToNextStage(fields.orderId.value);
  elements.modal.close();
});
fields.stage.addEventListener("change", () => {
  updateHiddenOwnerFromResponsibles();
  applyStageLocks();
});
fields.receivedDate.addEventListener("input", updateCalculatedAnsField);
fields.receivedDate.addEventListener("change", updateCalculatedAnsField);
fields.osNumber.addEventListener("input", refreshSharePointLinkField);
fields.osNumber.addEventListener("change", refreshSharePointLinkField);
fields.filesLink.addEventListener("input", refreshSharePointLinkField);
fields.filesLink.addEventListener("change", refreshSharePointLinkField);
if (elements.openFilesLinkButton) elements.openFilesLinkButton.addEventListener("click", openFilesLink);
[fields.fieldTech, fields.cadist, fields.budgeter].forEach((input) => {
  input.addEventListener("change", updateHiddenOwnerFromResponsibles);
});
processTabs.map((process) => fields[process.key]).filter(Boolean).forEach((input) => {
  input.addEventListener("change", refreshProcessDependentFields);
});
[
  fields.poles,
  ...voiceDefinitions.flatMap((voice) => [fields[voice.polesField], fields[voice.repeatField], voice.typeField ? fields[voice.typeField] : null])
].filter(Boolean).forEach((input) => {
  input.addEventListener("input", updateVoiceCodes);
  input.addEventListener("change", updateVoiceCodes);
});
elements.collaboratorForm.addEventListener("submit", saveCollaborator);
elements.collaboratorList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "edit-collaborator") editCollaborator(button.dataset.id);
  if (button.dataset.action === "delete-collaborator") deleteCollaborator(button.dataset.id);
});
elements.userForm.addEventListener("submit", saveUser);
elements.permissionGrid.addEventListener("change", (event) => {
  const input = event.target.closest("input[name='permission']");
  if (!input || !input.checked || elements.collaboratorId.value) return;
  const queueInput = queueInputByStage(input.value);
  if (queueInput) queueInput.value = nextQueueOrderForStage(input.value);
});
elements.userCsvInput.addEventListener("change", async (event) => {
  try {
    await importUsersCsv(event.target.files[0]);
  } finally {
    event.target.value = "";
  }
});
elements.userList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "edit-user") editUser(button.dataset.id);
  if (button.dataset.action === "edit-person") editPerson(button.dataset.userId || "", button.dataset.collaboratorId || "");
  if (button.dataset.action === "reset-user") await resetUser(button.dataset.id);
  if (button.dataset.action === "delete-user") deleteUser(button.dataset.id);
  if (button.dataset.action === "delete-collaborator") deleteCollaborator(button.dataset.id);
});
[elements.auditSearch, elements.auditUserFilter, elements.auditOsFilter, elements.auditActionFilter, elements.auditStartDate, elements.auditEndDate]
  .forEach((input) => input.addEventListener("input", renderHistory));
elements.exportAuditCsvButton.addEventListener("click", exportAuditCsv);
elements.exportAuditPdfButton.addEventListener("click", exportAuditPdf);

async function init() {
  cleanupHeavyBrowserCache();
  await loadServerState();
  await ensureUsersLoaded();
  retryPendingOfflineSnapshot();
  renderStageOptions();
  currentUser = currentSession();
  if (currentUser) showApp();
  else showLogin();
}

window.addEventListener("online", retryPendingOfflineSnapshot);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    retryPendingOfflineSnapshot();
    void heartbeatPresence();
    void pollPresence();
  }
});
window.addEventListener("beforeunload", () => {
  if (pendingSaveSnapshot) storeLocalStateSnapshot(pendingSaveSnapshot);
});

init().catch(error => { hideSatelLoader(); const box=document.getElementById("bootError"); if(box)box.style.display="block"; const text=document.getElementById("bootErrorMessage"); if(text)text.textContent=error.message; });








































































