import { same, log, collections } from "./common.mjs";
export function changesBetween(before, after) {
  const changes = [];
  for (const collection of collections) {
    const previous = new Map(before[collection].map((x) => [x.id, x]));
    const current = new Map(after[collection].map((x) => [x.id, x]));
    for (const id of new Set([...previous.keys(), ...current.keys()])) {
      const old = previous.get(id),
        next = current.get(id);
      if (same(old, next)) continue;
      if (collection === "distributionEntries" && !next) continue; // retention is not a user deletion
      const fields = [
        ...new Set([...Object.keys(old || {}), ...Object.keys(next || {})]),
      ].filter(
        (k) =>
          !["updatedAt", "timeTracking"].includes(k) &&
          !same(old?.[k], next?.[k]),
      );
      if (!fields.length && old && next) continue;
      changes.push({ collection, id, before: old, after: next, fields });
    }
  }
  return changes;
}
export function logApplicationChanges(changes, user, revision, requestId) {
  const names = {
    orders: "OS",
    users: "CONTA",
    collaborators: "COLABORADOR",
    distributionEntries: "DISTRIBUICAO",
  };
  for (const c of changes) {
    const item = c.after || c.before;
    const meta = {
      requisicao: requestId,
      usuario: user.login,
      registro: c.id,
      revisao: revision,
    };
    if (c.collection === "historyEntries") {
      log("TMSRV.ACAO_INFORMADA_PELO_CLIENTE", {
        ...meta,
        acao: item.action || "Historico registrado",
        os: item.osNumber || "-",
      });
      continue;
    }
    const action = !c.before ? "CRIADA" : !c.after ? "EXCLUIDA" : "ALTERADA";
    log("TMSRV." + names[c.collection] + "_" + action, {
      ...meta,
      ...(c.collection === "orders"
        ? { os: item.osNumber, etapa: item.stage, responsavel: item.owner }
        : {}),
      ...(c.collection === "users" ? { conta: item.login } : {}),
      ...(c.collection === "collaborators" ? { colaborador: item.name } : {}),
      ...(c.collection === "distributionEntries"
        ? {
            os: item.osNumber,
            responsavel: item.owner,
            etapa: item.stage,
            tipo: item.type,
          }
        : {}),
      campos: c.fields.map((k) => (k === "passwordHash" ? "credencial" : k)),
    });
  }
}
export function logAccountChanges(changes, actor, revision) {
  for (const c of changes.filter((c) => c.collection === "users")) {
    log(
      "DBSRV.CONTA_" + (!c.before ? "CRIADA" : !c.after ? "EXCLUIDA" : "SALVA"),
      {
        usuario: actor,
        conta: (c.after || c.before).login,
        registro: c.id,
        revisao: revision,
        campos: c.fields.map((k) => (k === "passwordHash" ? "credencial" : k)),
      },
    );
  }
}
