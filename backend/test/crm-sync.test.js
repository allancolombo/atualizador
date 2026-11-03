import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import { resolveCompanyModules } from '../src/modules.js';
import { defaultForGroup, syncCrm } from '../src/crm-sync.js';

// Ids como foram criados no Perfex em 03/11/2026.
const groups = [
  { id: 27, name: 'Goo Site' }, { id: 28, name: 'Goo Delivery' }, { id: 29, name: 'Goo Salão' }, { id: 30, name: 'Goo Max' },
  { id: 32, name: 'Adicional Fiscal: emissão' }, { id: 34, name: 'Adicional Ficha técnica' }, { id: 35, name: 'Adicional Estoque' },
  { id: 37, name: 'Adicional Garçom (por aparelho)' }, { id: 38, name: 'Adicional Garçom ilimitado' },
  { id: 41, name: 'Adicional App do motoboy' }, { id: 42, name: 'Adicional Localização do motoboy' }, { id: 99, name: 'Grupo novo' }
];

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'central-crm-'));
  const db = openDatabase(path.join(directory, 'test.db'));
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return db;
}
const company = (db, document) => db.prepare('SELECT * FROM license_company WHERE document=?').get(document);
const resolve = (db, document) => resolveCompanyModules(db, company(db, document).id);

test('recognizes groups by name, ignoring accents and case', () => {
  assert.equal(defaultForGroup('GOO SALAO').plan, 'goo_salao');
  assert.deepEqual(defaultForGroup('Adicional Garçom ilimitado').unlimited, ['mesas.garcom']);
  assert.equal(defaultForGroup('Grupo novo'), null);
});

test('creates the pre-registration and maps plan plus add-ons', t => {
  const db = setup(t);
  const result = syncCrm(db, { groups, customers: [
    { id: 1, name: 'Loja A', document: '12.345.678/0001-90', userCode: '501', active: true, groups: [28, 32, 34, 35], phone: '48999', city: 'Tubarão' },
    { id: 2, name: 'Sem CNPJ', document: '', groups: [30] }
  ] });
  assert.equal(result.created, 1);
  assert.deepEqual(result.skipped.map(item => item.reason), ['sem_cnpj']);
  assert.equal(db.prepare('SELECT kind FROM crm_group WHERE id=99').get().kind, 'ignore');
  const a = company(db, '12345678000190');
  assert.equal(a.crm_user_code, '501');
  assert.equal(JSON.parse(a.crm_data).city, 'Tubarão');
  const resolved = resolve(db, '12345678000190');
  assert.equal(resolved.plan, 'goo_delivery');
  assert.equal(resolved.planSource, 'crm');
  for (const key of ['venda_balcao', 'relatorios', 'pagamento_online.pix', 'fiscal.nfce', 'custo.ficha', 'estoque', 'estoque.insumos']) assert.equal(resolved.modules[key], true, key);
  assert.equal(resolved.modules.mesas, undefined);
  assert.deepEqual(resolved.outsidePlan, []);
});

test('stock plus recipe only together turns on the ingredient write-off', t => {
  const db = setup(t);
  syncCrm(db, { groups, customers: [{ id: 1, document: '12345678000190', groups: [28, 35] }] });
  assert.equal(resolve(db, '12345678000190').modules['estoque.insumos'], undefined);
});

test('waiter devices: two in Salão, unlimited group removes the limit', t => {
  const db = setup(t);
  syncCrm(db, { groups, customers: [
    { id: 1, document: '12345678000190', groups: [29] },
    { id: 2, document: '98765432000110', groups: [29, 38] },
    { id: 3, document: '11222333000181', groups: [29, 37], limits: { 'mesas.garcom': { aparelhos: 5 } } }
  ] });
  assert.deepEqual(resolve(db, '12345678000190').modules['mesas.garcom'], { limits: { aparelhos: 2 } });
  assert.equal(resolve(db, '98765432000110').modules['mesas.garcom'], true);
  assert.deepEqual(resolve(db, '11222333000181').modules['mesas.garcom'], { limits: { aparelhos: 5 } });
});

test('add-on outside the plan is granted but flagged', t => {
  const db = setup(t);
  syncCrm(db, { groups, customers: [{ id: 1, document: '12345678000190', groups: [27, 41, 42] }] });
  const resolved = resolve(db, '12345678000190');
  assert.equal(resolved.plan, 'goo_site');
  assert.equal(resolved.modules['motoboy.app'], undefined, 'app precisa de motoboy, que o Site não tem');
  syncCrm(db, { groups, customers: [{ id: 1, document: '12345678000190', groups: [27, 37] }] });
  assert.deepEqual(resolve(db, '12345678000190').outsidePlan, []);
  db.prepare("INSERT INTO license_module(company_id,module_key,enabled) VALUES(?,'mesas',1)").run(company(db, '12345678000190').id);
  assert.deepEqual(resolve(db, '12345678000190').outsidePlan.sort(), ['mesas', 'mesas.garcom']);
});

test('highest plan wins and the manual plan wins over the CRM', t => {
  const db = setup(t);
  syncCrm(db, { groups, customers: [{ id: 1, document: '12345678000190', groups: [27, 30] }] });
  assert.equal(resolve(db, '12345678000190').plan, 'goo_max');
  const second = syncCrm(db, { groups, customers: [{ id: 1, document: '12345678000190', groups: [28] }] });
  assert.equal(second.changed, 1);
  const a = company(db, '12345678000190');
  assert.ok(db.prepare("SELECT 1 FROM license_event WHERE company_id=? AND action='crm_changed'").get(a.id));
  const site = db.prepare("SELECT id FROM plan WHERE code='goo_site'").get();
  db.prepare('UPDATE license_company SET plan_id=? WHERE id=?').run(site.id, a.id);
  assert.equal(resolve(db, '12345678000190').plan, 'goo_site');
  db.prepare("INSERT INTO license_module(company_id,module_key,enabled) VALUES(?,'whatsapp',0)").run(a.id);
  assert.equal(resolve(db, '12345678000190').modules.whatsapp, undefined, 'exceção manual vence');
  assert.equal(syncCrm(db, { groups, customers: [{ id: 1, document: '12345678000190', groups: [28] }] }).changed, 0);
});

test('customer leaving the CRM list loses the CRM grants but keeps the record', t => {
  const db = setup(t);
  syncCrm(db, { groups, customers: [{ id: 1, document: '12345678000190', groups: [30] }, { id: 2, document: '98765432000110', groups: [30] }] });
  const result = syncCrm(db, { groups, customers: [{ id: 2, document: '98765432000110', groups: [30] }] });
  assert.equal(result.removed, 1);
  assert.equal(company(db, '12345678000190').crm_customer_id, null);
  assert.deepEqual(resolve(db, '12345678000190').modules, {});
});

test('rejects an empty customer list and repeated CNPJ', t => {
  const db = setup(t);
  assert.throws(() => syncCrm(db, { groups, customers: [] }), /customers_required/);
  const result = syncCrm(db, { groups, customers: [{ id: 1, document: '12345678000190' }, { id: 2, document: '12.345.678/0001-90' }] });
  assert.deepEqual(result.skipped.map(item => item.reason), ['cnpj_repetido']);
});
