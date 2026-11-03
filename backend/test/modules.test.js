import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import {
  buildEntitlements, dependencyClosure, dependentClosure, loadCatalog, loadSigningKey, normalizeDocument,
  normalizePlanModules, resolveCompanyModules, verifyEntitlements
} from '../src/modules.js';

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'central-modulos-'));
  const db = openDatabase(path.join(directory, 'test.db'));
  const signer = loadSigningKey({ MODULES_SIGNING_KEY_PATH: path.join(directory, 'key.pem') });
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const clientId = Number(db.prepare("INSERT INTO client(external_id,name,document) VALUES('c1','Cliente','12.345.678/0001-90')").run().lastInsertRowid);
  const terminalId = Number(db.prepare("INSERT INTO terminal(external_id,client_id,name,product_code) VALUES('t1',?,'Caixa','pdv')").run(clientId).lastInsertRowid);
  const reg = { client: { id: clientId, external_id: 'c1' }, terminal: { id: terminalId, external_id: 't1' } };
  const catalog = new Map(loadCatalog(db).map(item => [item.key, item]));
  return { db, signer, reg, catalog, directory };
}

test('seeds the Goo plans with included and available modules', t => {
  const { db } = setup(t);
  const modes = code => Object.fromEntries(db.prepare('SELECT m.module_key,m.mode FROM plan_module m JOIN plan p ON p.id=m.plan_id WHERE p.code=?').all(code).map(row => [row.module_key, row.mode]));
  assert.deepEqual(db.prepare('SELECT code FROM plan ORDER BY id').all().map(row => row.code), ['goo_site', 'goo_delivery', 'goo_salao', 'goo_max']);
  const site = modes('goo_site');
  assert.equal(site['pagamento_online.pix'], 'included');
  assert.equal(site.fiscal, 'available');
  assert.equal(site['custo.ficha'], undefined, 'ficha só a partir do Delivery');
  assert.equal(modes('goo_delivery')['custo.ficha'], 'available');
  assert.equal(modes('goo_delivery').relatorios, 'included');
  const salao = db.prepare("SELECT m.limits FROM plan_module m JOIN plan p ON p.id=m.plan_id WHERE p.code='goo_salao' AND m.module_key='mesas.garcom'").get();
  assert.deepEqual(JSON.parse(salao.limits), { aparelhos: 2 });
  const max = db.prepare("SELECT m.limits,m.mode FROM plan_module m JOIN plan p ON p.id=m.plan_id WHERE p.code='goo_max' AND m.module_key='mesas.garcom'").get();
  assert.deepEqual(max, { limits: null, mode: 'included' });
  assert.ok(!db.prepare("SELECT 1 FROM plan_module WHERE module_key='fiscal.nfe'").get());
});

test('computes dependency closures', t => {
  const { catalog } = setup(t);
  assert.deepEqual([...dependencyClosure(catalog, 'estoque.insumos')].sort(), ['custo.ficha', 'custo.insumos', 'estoque']);
  const children = dependentClosure(catalog, 'custo.insumos');
  for (const key of ['custo.ficha', 'custo.cmv', 'custo.producao', 'custo.historico', 'estoque.insumos']) assert.ok(children.has(key), key);
  assert.ok(!children.has('custo.projecao'));
});

test('plan normalization adds missing dependencies and rejects reserved modules', t => {
  const { catalog } = setup(t);
  const { modules, added } = normalizePlanModules(catalog, [{ key: 'marketing', limits: { mensagens: '500' } }]);
  assert.deepEqual(modules.get('marketing'), { limits: { mensagens: 500 }, mode: 'included' });
  assert.deepEqual(added, ['whatsapp']);
  assert.throws(() => normalizePlanModules(catalog, ['fiscal.nfe']), /reserved_module/);
});

test('new CNPJ is born without modules and the license is signed', t => {
  const { db, signer, reg } = setup(t);
  const token = buildEntitlements(db, signer, reg, undefined);
  const body = verifyEntitlements(signer.publicKeyPem, token);
  assert.equal(body.schema, 1);
  assert.equal(body.terminal, 't1');
  assert.deepEqual(body.companies['12345678000190'], { plan: null, enforce: false, modules: {} });
  assert.ok(new Date(body.expiresAt) > new Date(body.issuedAt));
  const tampered = { ...token, payload: Buffer.from(JSON.stringify({ ...body, companies: {} })).toString('base64') };
  assert.throws(() => verifyEntitlements(signer.publicKeyPem, tampered), /invalid_entitlements_signature/);
});

test('plan, overrides and dependencies resolve per company', t => {
  const { db, signer, reg } = setup(t);
  buildEntitlements(db, signer, reg, [{ document: '12345678000190' }, { document: '98765432000110', name: 'Filial' }]);
  const company = db.prepare("SELECT id FROM license_company WHERE document='12345678000190'").get();
  const plan = db.prepare("SELECT id FROM plan WHERE code='goo_delivery'").get();
  db.prepare('UPDATE license_company SET plan_id=? WHERE id=?').run(plan.id, company.id);
  db.prepare("INSERT INTO license_module(company_id,module_key,enabled) VALUES(?,'custo.ficha',1),(?,'custo.projecao',1),(?,'estoque',1),(?,'estoque.insumos',1)").run(company.id, company.id, company.id, company.id);
  db.prepare("INSERT INTO license_module(company_id,module_key,enabled) VALUES(?,'custo.insumos',0)").run(company.id);
  db.prepare("INSERT INTO license_module(company_id,module_key,enabled,limits) VALUES(?,'marketing',1,'{\"mensagens\":300}')").run(company.id);
  const resolved = resolveCompanyModules(db, company.id);
  assert.equal(resolved.modules['custo.insumos'], undefined);
  assert.equal(resolved.modules['custo.ficha'], undefined);
  assert.equal(resolved.modules['estoque.insumos'], undefined);
  assert.equal(resolved.modules['custo.projecao'], true);
  assert.deepEqual(resolved.modules.marketing, { limits: { mensagens: 300 } });
  assert.ok(resolved.blocked.has('custo.ficha'));

  const body = verifyEntitlements(signer.publicKeyPem, buildEntitlements(db, signer, reg, [{ document: '12.345.678/0001-90' }, { document: '98765432000110' }]));
  assert.equal(body.companies['12345678000190'].plan, 'goo_delivery');
  assert.deepEqual(body.companies['98765432000110'].modules, {});
});

test('expired override stops counting', t => {
  const { db, signer, reg } = setup(t);
  buildEntitlements(db, signer, reg, undefined);
  const company = db.prepare('SELECT id FROM license_company').get();
  db.prepare("INSERT INTO license_module(company_id,module_key,enabled,valid_until) VALUES(?,'ifood',1,'2000-01-01T00:00:00Z')").run(company.id);
  assert.equal(resolveCompanyModules(db, company.id).modules.ifood, undefined);
});

test('company moving to another client is recorded', t => {
  const { db, signer, reg } = setup(t);
  buildEntitlements(db, signer, reg, undefined);
  const other = Number(db.prepare("INSERT INTO client(external_id,name) VALUES('c2','Outro')").run().lastInsertRowid);
  buildEntitlements(db, signer, { ...reg, client: { id: other, external_id: 'c2' } }, [{ document: '12345678000190' }]);
  const event = db.prepare("SELECT * FROM license_event WHERE action='client_changed'").get();
  assert.ok(event);
});

test('normalizes documents', () => {
  assert.equal(normalizeDocument('12.345.678/0001-90'), '12345678000190');
  assert.equal(normalizeDocument('123.456.789-01'), '12345678901');
  assert.equal(normalizeDocument('123'), null);
});

test('reuses the signing key file', t => {
  const { directory, signer } = setup(t);
  const again = loadSigningKey({ MODULES_SIGNING_KEY_PATH: path.join(directory, 'key.pem') });
  assert.equal(again.keyId, signer.keyId);
  assert.equal(Buffer.from(signer.publicKeyRaw, 'base64').length, 64);
});
