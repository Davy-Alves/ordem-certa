import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config, empty, collections } from "./common.mjs";
const cfg = config();
const source = process.argv[2];
if (!source)
  throw new Error(
    'Uso: runtime\\node.exe src\\migrate.mjs "pasta data original"',
  );
const file = path.join(cfg.dataDir, "ordem-certa.sqlite");
if (fs.existsSync(file))
  throw new Error(
    "Migracao cancelada: o banco de destino ja existe. Use uma pasta nova para evitar sobrescrever dados.",
  );
const orders = JSON.parse(
  fs.readFileSync(path.join(source, "orders.json"), "utf8"),
);
const accounts = JSON.parse(
  fs.readFileSync(path.join(source, "accounts.json"), "utf8"),
);
const state = {
  ...empty(),
  ...orders,
  ...accounts,
  orders: orders.orders,
  historyEntries: orders.historyEntries,
  distributionEntries: orders.distributionEntries,
  deletedOrderIds: orders.deletedOrderIds || [],
};
delete state.loginBlocks;
for (const key of collections) {
  if (!Array.isArray(state[key])) throw new Error("Colecao invalida: " + key);
  const ids = new Set();
  for (const item of state[key]) {
    if (!item.id || ids.has(item.id))
      throw new Error("ID ausente/duplicado em " + key);
    ids.add(item.id);
  }
}
if (!state.users.some((u) => u.accessLevel >= 91))
  throw new Error("A origem nao possui administrador ativo.");
fs.mkdirSync(cfg.dataDir, { recursive: true });
const db = new DatabaseSync(file);
db.exec(
  "CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL)",
);
db.prepare("INSERT INTO state VALUES(1,1,?)").run(JSON.stringify(state));
const check = JSON.parse(db.prepare("SELECT payload FROM state").get().payload);
if (JSON.stringify(check) !== JSON.stringify(state))
  throw new Error("Falha na verificacao da migracao.");
db.close();
console.log(
  JSON.stringify(
    {
      ok: true,
      counts: Object.fromEntries(collections.map((k) => [k, state[k].length])),
      sourceUnchanged: true,
    },
    null,
    2,
  ),
);
