import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('../Servidor/public/xlsx.full.min.js');
const app = fs.readFileSync(new URL('../Servidor/public/app.js', import.meta.url), 'utf8');
const diagnostics = fs.readFileSync(new URL('../Servidor/public/desktop-diagnostics.js', import.meta.url), 'utf8');
const fixture = JSON.parse(fs.readFileSync(new URL('./cabecalhos-planilha.json', import.meta.url), 'utf8'));
const ctx = vm.createContext({ XLSX, window: { XLSX }, collaborators: [], localStorage: { getItem: () => null, setItem() {} } });
// Load production function declarations, without executing UI startup or making server requests.
vm.runInContext([...app.matchAll(/^(?:async )?function \w+\([^\n]*\) \{[\s\S]*?^\}/gm)].map(m => m[0]).join('\n'), ctx);
vm.runInContext(app.slice(app.indexOf('const stages ='), app.indexOf('const sharePointOrderSearchUrl =')), ctx);
vm.runInContext(diagnostics, ctx);
const norm = h => String(h).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const values = {
  OS: 'TESTE-IMPORT-001', 'TIPO DE OBRA': 'Melhoria', REGIÃO: 'Fortaleza',
  'STATUS CAMPO': 'PROGRAMADO', 'DATA RECEBIMENTO': '01/10/2026', 'DATA FINAL': '15/10/2026',
  'DATA FINAL CAD': '15/10/2026', 'Nº POSTES DO PROJETO': 12, 'POSTES PROJETO': 12,
  'Nº POSTES TERMO DE PASSAGEM': 4, 'POSTES TERMO': 4, 'POSTES AMBIENTAL': 6,
  'POSTES PARALELISMO': 8, 'POSTES TRAVESSIA': 10,
  'MÊS2': 999, OBSERVAÇÕES3: 'observacao 888', 'TIMER AMBIENTAL': 777, 'TIMER PERMISSÃO': 666,
  VALORAÇÃO: 555, VOZES: 444, 'NECESSARIO DOC AMBIENTAL/PODA ?': 'NAO',
  'PROCESSO PARALELISMO E TRAVESSIA ? 2': 'NAO'
};
const byHeader = Object.fromEntries(Object.entries(values).map(([k,v]) => [norm(k), v]));
const cells = headers => headers.map(h => byHeader[norm(h)] ?? '');
const parse = headers => ctx.statusHeaderRowsToObjects([headers, cells(headers)])[0];
const plain = x => JSON.parse(JSON.stringify(x));
const current = parse(fixture.current);
ctx.desktopBeginImport([current], 'novo-formato.xlsx');
const updated = plain(ctx.buildStatusUpdate(current));
assert.deepEqual(updated.voicePoleImports, { project:'12', termo:'4', ambiental:'6', paralelismo:'8', travessiaRio:'10' });
assert.equal(updated.regional, 'Fortaleza');
assert.equal(updated.statusImport.cadDate, '2026-10-15');
assert.equal(updated.receivedDate, '2026-10-01');
assert.equal(updated.processAmbiental, false);
assert.equal(updated.processParalelismo, false);
assert.equal(updated.projectVoice.code, '5000011690');
const lookups = vm.runInContext('Object.values(desktopImportContext.lookups)', ctx);
assert.ok(lookups.some(x => x.header === 'Nº POSTES DO PROJETO' && x.column === 33));
assert.ok(lookups.some(x => x.header === 'Nº POSTES TERMO DE PASSAGEM' && x.column === 34));
ctx.desktopFinishImport('teste');
for (const headers of [fixture.model, [...fixture.current].reverse()]) {
  assert.deepEqual(plain(ctx.buildStatusUpdate(parse(headers))), updated);
}
const emptyPoles = fixture.current.map(h => /postes/.test(norm(h)) ? '' : byHeader[norm(h)] ?? '');
const empty = ctx.statusHeaderRowsToObjects([fixture.current, emptyPoles])[0];
assert.deepEqual(plain(ctx.voicePoleImportsFromSheet(empty)), { project:'', termo:'', ambiental:'', paralelismo:'', travessiaRio:'' });
const zeros = fixture.current.map(h => /postes/.test(norm(h)) ? 0 : byHeader[norm(h)] ?? '');
assert.equal(ctx.voicePoleImportsFromSheet(ctx.statusHeaderRowsToObjects([fixture.current, zeros])[0]).project, '0');
const minimal = ctx.statusHeaderRowsToObjects([['OS','STATUS CAMPO'],['TESTE','PROGRAMADO']])[0];
assert.equal(ctx.buildStatusUpdate(minimal).regional, '');
const blankProcesses = { ...current, 'NECESSARIO DOC AMBIENTAL/PODA ?': '', 'PROCESSO PARALELISMO E TRAVESSIA ? 2': '' };
Object.defineProperty(blankProcesses, '__rowValues', {value:current.__rowValues});
assert.equal(ctx.buildStatusUpdate(blankProcesses).processAmbiental, false);
assert.equal(ctx.buildStatusUpdate(blankProcesses).processParalelismo, false);
const twoHeaders = ctx.statusHeaderRowsToObjects([fixture.model, fixture.current, cells(fixture.current)]);
assert.equal(twoHeaders.length, 1);
assert.equal(twoHeaders[0].__sourceRow, 3);
assert.deepEqual(plain(ctx.buildStatusUpdate(twoHeaders[0])), updated);
assert.equal(ctx.statusHeaderRowsToObjects([fixture.model, fixture.current]).length, 0);
if (process.argv[2]) {
  const buffer = fs.readFileSync(process.argv[2]);
  const rows = await ctx.rowsFromStatusFile({ name:'referencia.xlsx', arrayBuffer:async()=>buffer });
  assert.equal(rows.length, 0, 'Arquivo de referencia contem apenas cabecalhos, nao ordens.');
}
console.log('PASS: formato atual, modelo anterior, colunas reordenadas, postes/VOZ, datas CAD, regional, processos, campos vazios/zero, diagnostico e duas linhas de cabecalho. Sem gravar dados de producao.');
