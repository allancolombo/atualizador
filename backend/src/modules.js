import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Catálogo de módulos do GooPedir (docs/modulos-desenho.md no goopedir-local).
// O núcleo (pedidos, cardápio, clientes, impressão...) não entra aqui: está sempre ligado.
// legacy = chave antiga que o front e o servidor ainda leem em /v2/status.modulos.
export const MODULE_CATALOG = [
  { key: 'venda_balcao', name: 'Venda balcão e novo pedido', group: 'Operação', legacy: 'pdv' },
  { key: 'caixa', name: 'Caixa', group: 'Operação', legacy: 'caixa' },
  { key: 'mesas', name: 'Mesas e comandas', group: 'Operação', legacy: 'mesas' },
  { key: 'mesas.garcom', name: 'App do garçom', group: 'Operação', depends: ['mesas'], limits: ['aparelhos'] },
  { key: 'tablet', name: 'Tablet de mesa', group: 'Operação', depends: ['mesas'], limits: ['aparelhos'] },
  { key: 'totem', name: 'Totem de autoatendimento', group: 'Operação' },
  { key: 'painel_tv', name: 'Painel de TV', group: 'Operação' },
  { key: 'pdv_maquininha', name: 'PDV maquininha', group: 'Operação' },
  { key: 'chat_pedido', name: 'Chat do pedido', group: 'Operação' },
  { key: 'balanca.peso', name: 'Balança por peso', group: 'Balança' },
  { key: 'balanca.comanda', name: 'Comanda de balança', group: 'Balança', depends: ['balanca.peso'] },
  { key: 'motoboy', name: 'Motoboys', group: 'Entrega', legacy: 'motoboy' },
  { key: 'motoboy.app', name: 'App do motoboy', group: 'Entrega', depends: ['motoboy'] },
  { key: 'motoboy.localizacao', name: 'Localização e rotas do motoboy', group: 'Entrega', depends: ['motoboy.app'], legacy: 'rotas' },
  { key: 'relatorios', name: 'Relatórios', group: 'Gestão' },
  { key: 'custo.insumos', name: 'Insumos', group: 'Custo de produção' },
  { key: 'custo.ficha', name: 'Ficha técnica', group: 'Custo de produção', depends: ['custo.insumos'], legacy: 'ficha' },
  { key: 'custo.cmv', name: 'CMV', group: 'Custo de produção', depends: ['custo.ficha'] },
  { key: 'custo.historico', name: 'Histórico de custos', group: 'Custo de produção', depends: ['custo.insumos'] },
  { key: 'custo.producao', name: 'Produção', group: 'Custo de produção', depends: ['custo.ficha'] },
  { key: 'custo.projecao', name: 'Projeção de preço', group: 'Custo de produção' },
  { key: 'estoque', name: 'Estoque', group: 'Estoque', legacy: 'estoque' },
  { key: 'estoque.insumos', name: 'Baixa de insumos pela venda', group: 'Estoque', depends: ['estoque', 'custo.ficha'] },
  { key: 'fiscal', name: 'Fiscal', group: 'Fiscal', legacy: 'fiscal' },
  { key: 'fiscal.nfce', name: 'NFC-e', group: 'Fiscal', depends: ['fiscal'] },
  { key: 'fiscal.nfe', name: 'NF-e', group: 'Fiscal', depends: ['fiscal'], status: 'reservado' },
  { key: 'fiscal.dfe', name: 'DF-e (notas recebidas)', group: 'Fiscal', depends: ['fiscal'] },
  { key: 'fiscal.entrada', name: 'Nota de entrada e fornecedores', group: 'Fiscal', depends: ['fiscal'] },
  { key: 'fiscal.contabilidade', name: 'Envio para contabilidade', group: 'Fiscal', depends: ['fiscal.nfce'] },
  { key: 'despesa', name: 'Despesas', group: 'Financeiro' },
  { key: 'fiado', name: 'Fiado', group: 'Financeiro' },
  { key: 'fiado.nfce', name: 'NFC-e do fiado', group: 'Financeiro', depends: ['fiado', 'fiscal.nfce'] },
  { key: 'financeiro', name: 'Financeiro (bancos e cartões)', group: 'Financeiro' },
  { key: 'pagamento_online.pix', name: 'Pix online', group: 'Vendas online', legacy: 'pix' },
  { key: 'pagamento_online.stripe', name: 'Cartão online (Stripe)', group: 'Vendas online' },
  { key: 'fidelidade', name: 'Fidelidade', group: 'Vendas online', legacy: 'fidelidade' },
  { key: 'cupom', name: 'Cupom de desconto', group: 'Vendas online', legacy: 'desconto' },
  { key: 'roleta', name: 'Roleta', group: 'Vendas online', depends: ['cupom'] },
  { key: 'recuperacao', name: 'Recuperação de vendas', group: 'Vendas online', depends: ['cupom'] },
  { key: 'whatsapp', name: 'WhatsApp', group: 'Vendas online', legacy: 'whatsapp' },
  { key: 'marketing', name: 'Marketing', group: 'Vendas online', depends: ['whatsapp'], status: 'beta', legacy: 'campanha', limits: ['mensagens'] },
  { key: 'ifood', name: 'iFood', group: 'Vendas online', legacy: 'ifood' },
  { key: 'dominio_proprio', name: 'Domínio próprio', group: 'Vendas online' },
  { key: 'ia', name: 'Inteligência artificial', group: 'Vendas online' },
  { key: 'filial', name: 'Filial', group: 'Vendas online' }
];

// Planos por estágio da operação. "included" vem no preço; "available" é adicional que o plano permite contratar.
// Cada plano soma o anterior. Item com limite: { key, limits }.
const SITE_INCLUDED = ['whatsapp', 'chat_pedido', 'pagamento_online.pix'];
const DELIVERY_INCLUDED = [...SITE_INCLUDED, 'venda_balcao', 'caixa', 'motoboy', 'cupom', 'despesa', 'fiado', 'ifood', 'relatorios', 'pdv_maquininha'];
const SALAO_INCLUDED = [...DELIVERY_INCLUDED, 'mesas', { key: 'mesas.garcom', limits: { aparelhos: 2 } }, 'totem'];
const MAX_INCLUDED = [...SALAO_INCLUDED.filter(item => item.key !== 'mesas.garcom'), 'mesas.garcom', 'painel_tv', 'financeiro', 'fidelidade', 'roleta', { key: 'marketing', limits: { mensagens: 500 } }, 'ia'];
const ADDONS_FROM_SITE = ['relatorios', 'fiscal', 'fiscal.nfce', 'fiscal.contabilidade', 'fiscal.dfe', 'fiscal.entrada', 'balanca.peso', 'balanca.comanda', 'filial', 'pagamento_online.stripe', 'dominio_proprio'];
const ADDONS_FROM_DELIVERY = [...ADDONS_FROM_SITE, 'custo.insumos', 'custo.ficha', 'custo.cmv', 'custo.projecao', 'custo.historico', 'custo.producao', 'estoque', 'estoque.insumos', 'motoboy.app', 'motoboy.localizacao', 'fiado.nfce', 'recuperacao'];
const ADDONS_FROM_SALAO = [...ADDONS_FROM_DELIVERY, 'mesas.garcom', 'tablet'];
export const PLAN_SEED = [
  { code: 'goo_site', name: 'Goo Site', included: SITE_INCLUDED, available: ADDONS_FROM_SITE },
  { code: 'goo_delivery', name: 'Goo Delivery', included: DELIVERY_INCLUDED, available: ADDONS_FROM_DELIVERY },
  { code: 'goo_salao', name: 'Goo Salão', included: SALAO_INCLUDED, available: ADDONS_FROM_SALAO },
  { code: 'goo_max', name: 'Goo Max', included: MAX_INCLUDED, available: ADDONS_FROM_SALAO }
];

export const MODULE_STATUS = ['ativo', 'beta', 'reservado'];
const ENTITLEMENT_DAYS = 30;
const MAX_COMPANIES = 50;

const text = value => value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim();
const parseJson = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };

export function normalizeDocument(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 11 || digits.length === 14 ? digits : null;
}

export function ensureModuleSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS module(key TEXT PRIMARY KEY,name TEXT NOT NULL,group_name TEXT NOT NULL,depends_on TEXT NOT NULL DEFAULT '[]',status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','beta','reservado')),limit_keys TEXT NOT NULL DEFAULT '[]',legacy_key TEXT,sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS plan(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS plan_module(plan_id INTEGER NOT NULL,module_key TEXT NOT NULL,limits TEXT,PRIMARY KEY(plan_id,module_key),FOREIGN KEY(plan_id) REFERENCES plan(id) ON DELETE CASCADE,FOREIGN KEY(module_key) REFERENCES module(key));
    CREATE TABLE IF NOT EXISTS license_company(id INTEGER PRIMARY KEY AUTOINCREMENT,document TEXT NOT NULL UNIQUE,name TEXT,plan_id INTEGER,enforce INTEGER NOT NULL DEFAULT 0,notes TEXT,last_client_id INTEGER,last_terminal_id INTEGER,first_seen_at TEXT,last_seen_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(plan_id) REFERENCES plan(id),FOREIGN KEY(last_client_id) REFERENCES client(id),FOREIGN KEY(last_terminal_id) REFERENCES terminal(id));
    CREATE TABLE IF NOT EXISTS license_module(company_id INTEGER NOT NULL,module_key TEXT NOT NULL,enabled INTEGER NOT NULL,limits TEXT,valid_until TEXT,updated_by INTEGER,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(company_id,module_key),FOREIGN KEY(company_id) REFERENCES license_company(id) ON DELETE CASCADE,FOREIGN KEY(module_key) REFERENCES module(key),FOREIGN KEY(updated_by) REFERENCES app_user(id));
    CREATE TABLE IF NOT EXISTS license_event(id INTEGER PRIMARY KEY AUTOINCREMENT,company_id INTEGER NOT NULL,user_id INTEGER,action TEXT NOT NULL,details TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(company_id) REFERENCES license_company(id) ON DELETE CASCADE,FOREIGN KEY(user_id) REFERENCES app_user(id));
    CREATE INDEX IF NOT EXISTS idx_license_event_company ON license_event(company_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_license_company_client ON license_company(last_client_id);
    CREATE TABLE IF NOT EXISTS crm_group(id INTEGER PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'ignore' CHECK(kind IN ('plan','module','ignore')),plan_id INTEGER,module_keys TEXT NOT NULL DEFAULT '[]',priority INTEGER NOT NULL DEFAULT 0,present INTEGER NOT NULL DEFAULT 1,first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_by INTEGER,updated_at TEXT,FOREIGN KEY(plan_id) REFERENCES plan(id),FOREIGN KEY(updated_by) REFERENCES app_user(id));
    CREATE TABLE IF NOT EXISTS crm_sync_run(id INTEGER PRIMARY KEY AUTOINCREMENT,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,ip TEXT,customers INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL DEFAULT 0,changed INTEGER NOT NULL DEFAULT 0,removed INTEGER NOT NULL DEFAULT 0,skipped TEXT);
  `);
  for (const [column, definition] of [['crm_customer_id', 'INTEGER'], ['crm_user_code', 'TEXT'], ['crm_active', 'INTEGER'], ['crm_groups', "TEXT NOT NULL DEFAULT '[]'"], ['crm_limits', 'TEXT'], ['crm_data', 'TEXT'], ['crm_synced_at', 'TEXT']]) {
    if (!db.prepare('PRAGMA table_info(license_company)').all().some(item => item.name === column)) db.exec(`ALTER TABLE license_company ADD COLUMN ${column} ${definition}`);
  }
  const upsert = db.prepare(`INSERT INTO module(key,name,group_name,depends_on,status,limit_keys,legacy_key,sort_order) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET name=excluded.name,group_name=excluded.group_name,depends_on=excluded.depends_on,status=excluded.status,limit_keys=excluded.limit_keys,legacy_key=excluded.legacy_key,sort_order=excluded.sort_order`);
  if (!db.prepare('PRAGMA table_info(plan_module)').all().some(item => item.name === 'mode')) db.exec("ALTER TABLE plan_module ADD COLUMN mode TEXT NOT NULL DEFAULT 'included'");
  if (!db.prepare('PRAGMA table_info(crm_group)').all().some(item => item.name === 'unlimited_keys')) db.exec("ALTER TABLE crm_group ADD COLUMN unlimited_keys TEXT NOT NULL DEFAULT '[]'");
  db.transaction(() => {
    const existentes = new Set(db.prepare('SELECT key FROM module').all().map(item => item.key));
    MODULE_CATALOG.forEach((item, index) => upsert.run(item.key, item.name, item.group, JSON.stringify(item.depends || []), item.status || 'ativo', JSON.stringify(item.limits || []), item.legacy || null, index));
    // motoboy.rotas virou motoboy.localizacao.
    for (const table of ['plan_module', 'license_module']) db.prepare(`UPDATE OR IGNORE ${table} SET module_key='motoboy.localizacao' WHERE module_key='motoboy.rotas'`).run();
    const keys = MODULE_CATALOG.map(item => item.key), marks = keys.map(() => '?').join(',');
    for (const table of ['plan_module', 'license_module']) db.prepare(`DELETE FROM ${table} WHERE module_key NOT IN (${marks})`).run(...keys);
    db.prepare(`DELETE FROM module WHERE key NOT IN (${marks})`).run(...keys);
    if (!db.prepare('SELECT 1 FROM plan LIMIT 1').get()) seedPlans(db);
    else if (existentes.size) addNewModulesToPlans(db, existentes);
  })();
}

function seedPlans(db) {
  const insertPlan = db.prepare('INSERT INTO plan(code,name) VALUES(?,?)');
  const insertModule = db.prepare('INSERT OR REPLACE INTO plan_module(plan_id,module_key,limits,mode) VALUES(?,?,?,?)');
  for (const plan of PLAN_SEED) {
    const id = insertPlan.run(plan.code, plan.name).lastInsertRowid;
    const included = new Set();
    for (const item of plan.included) {
      const key = typeof item === 'string' ? item : item.key;
      included.add(key);
      insertModule.run(id, key, item.limits ? JSON.stringify(item.limits) : null, 'included');
    }
    for (const key of plan.available) if (!included.has(key)) insertModule.run(id, key, null, 'available');
  }
}

// Módulo novo no catálogo entra nos planos que já existem como no PLAN_SEED, só na primeira vez:
// depois disso o que vale é o que foi ajustado no painel.
function addNewModulesToPlans(db, existentes) {
  const novos = new Set(MODULE_CATALOG.map(item => item.key).filter(key => !existentes.has(key)));
  if (!novos.size) return;
  const plano = db.prepare('SELECT id FROM plan WHERE code=?');
  const inserir = db.prepare('INSERT OR IGNORE INTO plan_module(plan_id,module_key,limits,mode) VALUES(?,?,?,?)');
  for (const plan of PLAN_SEED) {
    const id = plano.get(plan.code)?.id;
    if (!id) continue;
    const included = new Set();
    for (const item of plan.included) {
      const key = typeof item === 'string' ? item : item.key;
      included.add(key);
      if (novos.has(key)) inserir.run(id, key, item.limits ? JSON.stringify(item.limits) : null, 'included');
    }
    for (const key of plan.available) if (novos.has(key) && !included.has(key)) inserir.run(id, key, null, 'available');
  }
}

export function loadCatalog(db) {
  return db.prepare('SELECT * FROM module ORDER BY sort_order').all().map(row => ({
    key: row.key, name: row.name, group: row.group_name, depends: parseJson(row.depends_on, []),
    status: row.status, limitKeys: parseJson(row.limit_keys, []), legacy: row.legacy_key
  }));
}

function catalogMap(db) { return new Map(loadCatalog(db).map(item => [item.key, item])); }

// Todos os módulos de que `key` depende, direta ou indiretamente.
export function dependencyClosure(catalog, key) {
  const result = new Set(), pending = [...(catalog.get(key)?.depends || [])];
  while (pending.length) {
    const current = pending.pop();
    if (result.has(current)) continue;
    result.add(current);
    pending.push(...(catalog.get(current)?.depends || []));
  }
  return result;
}

// Todos os módulos que dependem de `key`, direta ou indiretamente.
export function dependentClosure(catalog, key) {
  const result = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of catalog.values()) {
      if (result.has(item.key)) continue;
      if (item.depends.some(dep => dep === key || result.has(dep))) { result.add(item.key); changed = true; }
    }
  }
  return result;
}

function cleanLimits(module, limits) {
  if (!limits || typeof limits !== 'object') return null;
  const result = {};
  for (const key of module?.limitKeys || []) {
    if (limits[key] === undefined || limits[key] === null || limits[key] === '') continue;
    const value = Number(limits[key]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`invalid_limit_${key}`);
    result[key] = Math.floor(value);
  }
  return Object.keys(result).length ? result : null;
}

function overrideIsValid(row, now) {
  return !row.valid_until || new Date(row.valid_until).getTime() > now.getTime();
}

// Resolve plano + exceções + dependências. Módulo reservado nunca sai ligado.
export function resolveCompanyModules(db, companyId, now = new Date()) {
  const catalog = catalogMap(db);
  const company = db.prepare('SELECT * FROM license_company WHERE id=?').get(companyId);
  if (!company) return null;
  // Plano escolhido no painel vale mais que o do CRM. Sem ele, vale o grupo de plano de maior prioridade.
  const crmGroups = db.prepare(`SELECT g.* FROM crm_group g WHERE g.id IN (SELECT value FROM json_each(?)) AND g.kind<>'ignore' ORDER BY g.priority DESC,g.id DESC`).all(company.crm_groups || '[]');
  const crmPlanId = crmGroups.find(g => g.kind === 'plan' && g.plan_id)?.plan_id || null;
  const planId = company.plan_id || crmPlanId;
  const plan = planId ? db.prepare('SELECT * FROM plan WHERE id=? AND active=1').get(planId) : null;
  const enabled = new Map(), origin = new Map();
  if (plan) {
    for (const row of db.prepare("SELECT module_key,limits FROM plan_module WHERE plan_id=? AND mode='included'").all(plan.id)) {
      enabled.set(row.module_key, parseJson(row.limits, null));
      origin.set(row.module_key, company.plan_id ? 'plan' : 'crm_plan');
    }
  }
  for (const group of crmGroups.filter(g => g.kind === 'module')) {
    for (const key of parseJson(group.module_keys, [])) {
      if (!enabled.has(key)) { enabled.set(key, null); origin.set(key, 'crm'); }
    }
  }
  // Limite que vem do CRM (ex.: mensagens do marketing) só vale para módulo ligado.
  for (const [key, limits] of Object.entries(parseJson(company.crm_limits, {}))) {
    if (enabled.has(key) && limits && typeof limits === 'object') enabled.set(key, { ...(enabled.get(key) || {}), ...limits });
  }
  // Grupo "ilimitado" (ex.: garçom ilimitado) tira o limite que veio do plano ou do CRM.
  for (const group of crmGroups.filter(g => g.kind === 'module')) {
    for (const key of parseJson(group.unlimited_keys, [])) if (enabled.has(key)) enabled.set(key, null);
  }
  // Adicional ligado fora do que o plano permite: não bloqueia, só avisa no painel.
  const allowed = plan ? new Set(db.prepare('SELECT module_key FROM plan_module WHERE plan_id=?').all(plan.id).map(row => row.module_key)) : new Set();
  for (const row of db.prepare('SELECT * FROM license_module WHERE company_id=?').all(companyId)) {
    if (!overrideIsValid(row, now)) continue;
    if (row.enabled) {
      enabled.set(row.module_key, { ...(enabled.get(row.module_key) || {}), ...parseJson(row.limits, {}) });
      origin.set(row.module_key, 'override');
    } else {
      enabled.delete(row.module_key);
      origin.set(row.module_key, 'override_off');
    }
  }
  for (const key of [...enabled.keys()]) if (!catalog.has(key) || catalog.get(key).status === 'reservado') enabled.delete(key);
  const blocked = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...enabled.keys()]) {
      if (catalog.get(key).depends.every(dep => enabled.has(dep))) continue;
      enabled.delete(key); blocked.add(key); changed = true;
    }
  }
  const modules = {};
  for (const key of [...catalog.keys()].filter(key => enabled.has(key))) {
    const limits = enabled.get(key);
    modules[key] = limits && Object.keys(limits).length ? { limits } : true;
  }
  return { company, plan: plan?.code || null, planSource: plan ? (company.plan_id ? 'manual' : 'crm') : null, modules, origin, blocked, outsidePlan: Object.keys(modules).filter(key => !allowed.has(key)) };
}

export function loadSigningKey(env = process.env, databasePath = env.DATABASE_PATH || './data/updater.db') {
  let pem = text(env.MODULES_SIGNING_KEY)?.replace(/\\n/g, '\n');
  if (!pem) {
    const file = path.resolve(text(env.MODULES_SIGNING_KEY_PATH) || path.join(path.dirname(path.resolve(databasePath)), 'modules-signing-key.pem'));
    if (!fs.existsSync(file)) {
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      console.log(`Chave de assinatura dos módulos criada em ${file}. Guarde uma cópia: trocar a chave invalida as licenças já emitidas.`);
    }
    pem = fs.readFileSync(file, 'utf8');
  }
  const privateKey = crypto.createPrivateKey(pem);
  if (privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('modules_signing_key_must_be_p256');
  const publicKey = crypto.createPublicKey(privateKey);
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    privateKey,
    keyId: crypto.createHash('sha256').update(der).digest('hex').slice(0, 16),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    // X||Y em base64, 64 bytes: é o que vai no BCRYPT_ECCPUBLIC_BLOB do lado Delphi.
    publicKeyRaw: Buffer.concat([Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64')
  };
}

// O payload vai em base64 e a assinatura cobre exatamente esses bytes:
// quem valida não precisa reserializar o JSON.
export function signEntitlements(signer, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const signature = crypto.sign('sha256', payload, { key: signer.privateKey, dsaEncoding: 'ieee-p1363' });
  return { alg: 'ES256', keyId: signer.keyId, payload: payload.toString('base64'), signature: signature.toString('base64') };
}

export function verifyEntitlements(publicKeyPem, token) {
  const payload = Buffer.from(token.payload, 'base64');
  const valid = crypto.verify('sha256', payload, { key: publicKeyPem, dsaEncoding: 'ieee-p1363' }, Buffer.from(token.signature, 'base64'));
  if (!valid) throw new Error('invalid_entitlements_signature');
  return JSON.parse(payload.toString('utf8'));
}

function logEvent(db, companyId, userId, action, details) {
  db.prepare('INSERT INTO license_event(company_id,user_id,action,details) VALUES(?,?,?,?)').run(companyId, userId || null, action, details ? JSON.stringify(details) : null);
}

// Registra as empresas que o servidor informou e devolve a licença assinada.
// CNPJ novo nasce sem plano: só ganha módulos depois de liberado no painel.
export function buildEntitlements(db, signer, registration, companiesInput, now = new Date()) {
  const fallback = db.prepare('SELECT external_id,document,name FROM client WHERE id=?').get(registration.client.id);
  const list = Array.isArray(companiesInput) && companiesInput.length ? companiesInput : [fallback];
  const companies = new Map();
  for (const item of list.slice(0, MAX_COMPANIES)) {
    const document = normalizeDocument(item?.document ?? item?.cnpj);
    if (document && !companies.has(document)) companies.set(document, text(item?.name));
  }
  const result = {};
  db.transaction(() => {
    for (const [document, name] of companies) {
      let company = db.prepare('SELECT * FROM license_company WHERE document=?').get(document);
      if (!company) {
        const id = db.prepare('INSERT INTO license_company(document,name,last_client_id,last_terminal_id,first_seen_at,last_seen_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').run(document, name, registration.client.id, registration.terminal.id).lastInsertRowid;
        logEvent(db, id, null, 'company_seen', { clientId: registration.client.id, terminalId: registration.terminal.id });
        company = db.prepare('SELECT * FROM license_company WHERE id=?').get(id);
      } else {
        if (company.last_client_id && company.last_client_id !== registration.client.id) {
          logEvent(db, company.id, null, 'client_changed', { from: company.last_client_id, to: registration.client.id, terminalId: registration.terminal.id });
        }
        db.prepare('UPDATE license_company SET name=coalesce(?,name),last_client_id=?,last_terminal_id=?,first_seen_at=coalesce(first_seen_at,CURRENT_TIMESTAMP),last_seen_at=CURRENT_TIMESTAMP WHERE id=?').run(name, registration.client.id, registration.terminal.id, company.id);
      }
      const resolved = resolveCompanyModules(db, company.id, now);
      result[document] = { plan: resolved.plan, enforce: Boolean(resolved.company.enforce), modules: resolved.modules };
    }
  })();
  const expiresAt = new Date(now.getTime() + ENTITLEMENT_DAYS * 86400000);
  return signEntitlements(signer, {
    schema: 1,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    client: fallback?.external_id ?? null,
    terminal: registration.terminal.external_id,
    companies: result
  });
}

function companyView(db, companyId) {
  const resolved = resolveCompanyModules(db, companyId);
  if (!resolved) return null;
  const overrides = db.prepare('SELECT m.*,u.name updated_by_name FROM license_module m LEFT JOIN app_user u ON u.id=m.updated_by WHERE m.company_id=?').all(companyId)
    .map(row => ({ key: row.module_key, enabled: Boolean(row.enabled), limits: parseJson(row.limits, null), validUntil: row.valid_until, expired: !overrideIsValid(row, new Date()), updatedBy: row.updated_by_name, updatedAt: row.updated_at }));
  const events = db.prepare('SELECT e.*,u.name user_name FROM license_event e LEFT JOIN app_user u ON u.id=e.user_id WHERE e.company_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 100').all(companyId)
    .map(row => ({ id: row.id, action: row.action, details: parseJson(row.details, null), userName: row.user_name, createdAt: row.created_at }));
  const company = db.prepare('SELECT c.*,p.name plan_name,cl.name client_name,t.name terminal_name FROM license_company c LEFT JOIN plan p ON p.id=c.plan_id LEFT JOIN client cl ON cl.id=c.last_client_id LEFT JOIN terminal t ON t.id=c.last_terminal_id WHERE c.id=?').get(companyId);
  const crmGroups = db.prepare('SELECT g.id,g.name,g.kind,p.name plan_name,g.module_keys FROM crm_group g LEFT JOIN plan p ON p.id=g.plan_id WHERE g.id IN (SELECT value FROM json_each(?)) ORDER BY g.id').all(company.crm_groups || '[]')
    .map(row => ({ id: row.id, name: row.name, kind: row.kind, planName: row.plan_name, modules: parseJson(row.module_keys, []) }));
  return {
    company: { ...company, crm_data: parseJson(company.crm_data, null), crm_limits: parseJson(company.crm_limits, null) },
    crmGroups, plan: resolved.plan, planSource: resolved.planSource,
    overrides, events,
    resolved: resolved.modules,
    blocked: [...resolved.blocked],
    outsidePlan: resolved.outsidePlan,
    origin: Object.fromEntries(resolved.origin)
  };
}

function planView(db, plan) {
  return { ...plan, active: Boolean(plan.active), modules: db.prepare('SELECT module_key,limits,mode FROM plan_module WHERE plan_id=?').all(plan.id).map(row => ({ key: row.module_key, limits: parseJson(row.limits, null), mode: row.mode })) };
}

// Normaliza os módulos de um plano (mode: included ou available) e completa as dependências.
// Dependência de incluído entra como incluída; de adicional, entra ao menos como adicional.
export function normalizePlanModules(catalog, input) {
  const modules = new Map(), added = [];
  for (const item of Array.isArray(input) ? input : []) {
    const key = typeof item === 'string' ? item : item?.key, module = catalog.get(key);
    if (!module) throw new Error(`unknown_module_${key}`);
    if (module.status === 'reservado') throw new Error(`reserved_module_${key}`);
    const mode = item?.mode === 'available' ? 'available' : 'included';
    modules.set(key, { limits: mode === 'included' ? cleanLimits(module, item?.limits) : null, mode });
  }
  for (const [key, value] of [...modules]) {
    for (const dep of dependencyClosure(catalog, key)) {
      const current = modules.get(dep);
      if (!current) { modules.set(dep, { limits: null, mode: value.mode }); added.push(dep); }
      else if (value.mode === 'included' && current.mode === 'available') { current.mode = 'included'; added.push(dep); }
    }
  }
  return { modules, added };
}

export function registerModuleRoutes(app, { db, adminAuth, signer }) {
  const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'admin_required' });

  app.get('/api/v1/modules/public-key', (_req, res) => res.json({ alg: 'ES256', curve: 'P-256', keyId: signer.keyId, publicKeyPem: signer.publicKeyPem, publicKeyRaw: signer.publicKeyRaw }));

  app.get('/api/v1/admin/modules/catalog', adminAuth, (_req, res) => res.json(loadCatalog(db)));

  app.get('/api/v1/admin/modules/plans', adminAuth, (_req, res) => {
    res.json(db.prepare('SELECT p.*,(SELECT count(*) FROM license_company c WHERE c.plan_id=p.id) company_count FROM plan p ORDER BY p.name').all().map(plan => planView(db, plan)));
  });

  const savePlan = (req, res, planId) => {
    const catalog = catalogMap(db), name = text(req.body.name);
    if (!name) return res.status(400).json({ error: 'name_required' });
    const { modules, added } = normalizePlanModules(catalog, req.body.modules);
    const id = db.transaction(() => {
      let id = planId;
      if (id) db.prepare('UPDATE plan SET name=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, req.body.active === false ? 0 : 1, id);
      else {
        const code = text(req.body.code)?.toLowerCase();
        if (!code || !/^[a-z0-9_-]{2,40}$/.test(code)) throw new Error('invalid_plan_code');
        id = db.prepare('INSERT INTO plan(code,name) VALUES(?,?)').run(code, name).lastInsertRowid;
      }
      db.prepare('DELETE FROM plan_module WHERE plan_id=?').run(id);
      const insert = db.prepare('INSERT INTO plan_module(plan_id,module_key,limits,mode) VALUES(?,?,?,?)');
      for (const [key, value] of modules) insert.run(id, key, value.limits ? JSON.stringify(value.limits) : null, value.mode);
      for (const company of db.prepare('SELECT id FROM license_company WHERE plan_id=?').all(id)) logEvent(db, company.id, req.user.id, 'plan_changed', { planId: id, modules: [...modules.keys()] });
      return id;
    })();
    res.status(planId ? 200 : 201).json({ ...planView(db, db.prepare('SELECT * FROM plan WHERE id=?').get(id)), addedDependencies: added });
  };

  app.post('/api/v1/admin/modules/plans', adminAuth, adminOnly, (req, res, next) => { try { savePlan(req, res, null); } catch (e) { next(e); } });
  app.put('/api/v1/admin/modules/plans/:id', adminAuth, adminOnly, (req, res, next) => {
    try {
      if (!db.prepare('SELECT 1 FROM plan WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'plan_not_found' });
      savePlan(req, res, Number(req.params.id));
    } catch (e) { next(e); }
  });

  app.get('/api/v1/admin/modules/companies', adminAuth, (req, res) => {
    const search = text(req.query.search), digits = search?.replace(/\D/g, '');
    const where = search ? 'WHERE c.name LIKE ? OR cl.name LIKE ?' + (digits ? ' OR c.document LIKE ?' : '') : '';
    const args = search ? [`%${search}%`, `%${search}%`, ...(digits ? [`%${digits}%`] : [])] : [];
    res.json(db.prepare(`SELECT c.*,p.name plan_name,(SELECT p2.name FROM crm_group g JOIN plan p2 ON p2.id=g.plan_id WHERE g.kind='plan' AND g.id IN (SELECT value FROM json_each(c.crm_groups)) ORDER BY g.priority DESC,g.id DESC LIMIT 1) crm_plan_name,cl.name client_name,(SELECT count(*) FROM license_module m WHERE m.company_id=c.id) override_count FROM license_company c LEFT JOIN plan p ON p.id=c.plan_id LEFT JOIN client cl ON cl.id=c.last_client_id ${where} ORDER BY c.last_seen_at IS NULL,c.last_seen_at DESC,c.id DESC LIMIT 500`).all(...args));
  });

  app.post('/api/v1/admin/modules/companies', adminAuth, adminOnly, (req, res) => {
    const document = normalizeDocument(req.body.document);
    if (!document) return res.status(400).json({ error: 'invalid_document' });
    if (db.prepare('SELECT 1 FROM license_company WHERE document=?').get(document)) return res.status(409).json({ error: 'company_already_exists' });
    const planId = req.body.planId ? Number(req.body.planId) : null;
    if (planId && !db.prepare('SELECT 1 FROM plan WHERE id=?').get(planId)) return res.status(400).json({ error: 'plan_not_found' });
    const id = db.transaction(() => {
      const id = db.prepare('INSERT INTO license_company(document,name,plan_id) VALUES(?,?,?)').run(document, text(req.body.name), planId).lastInsertRowid;
      logEvent(db, id, req.user.id, 'company_created', { planId });
      return id;
    })();
    res.status(201).json(companyView(db, id));
  });

  app.get('/api/v1/admin/modules/companies/:id', adminAuth, (req, res) => {
    const view = companyView(db, req.params.id);
    if (!view) return res.status(404).json({ error: 'company_not_found' });
    res.json(view);
  });

  app.patch('/api/v1/admin/modules/companies/:id', adminAuth, adminOnly, (req, res) => {
    const company = db.prepare('SELECT * FROM license_company WHERE id=?').get(req.params.id);
    if (!company) return res.status(404).json({ error: 'company_not_found' });
    const planId = req.body.planId === undefined ? company.plan_id : (req.body.planId ? Number(req.body.planId) : null);
    if (planId && !db.prepare('SELECT 1 FROM plan WHERE id=?').get(planId)) return res.status(400).json({ error: 'plan_not_found' });
    const enforce = req.body.enforce === undefined ? company.enforce : (req.body.enforce ? 1 : 0);
    const name = req.body.name === undefined ? company.name : text(req.body.name);
    const notes = req.body.notes === undefined ? company.notes : text(req.body.notes);
    db.transaction(() => {
      db.prepare('UPDATE license_company SET plan_id=?,enforce=?,name=?,notes=? WHERE id=?').run(planId, enforce, name, notes, company.id);
      if (planId !== company.plan_id) logEvent(db, company.id, req.user.id, 'plan_assigned', { from: company.plan_id, to: planId });
      if (enforce !== company.enforce) logEvent(db, company.id, req.user.id, enforce ? 'enforce_on' : 'enforce_off', null);
    })();
    res.json(companyView(db, company.id));
  });

  // enabled: true liga, false desliga, null volta a seguir o plano.
  // Ligar um módulo liga o que ele precisa; desligar desliga o que depende dele.
  app.put('/api/v1/admin/modules/companies/:id/modules/:key', adminAuth, adminOnly, (req, res, next) => {
    try {
      const company = db.prepare('SELECT * FROM license_company WHERE id=?').get(req.params.id);
      if (!company) return res.status(404).json({ error: 'company_not_found' });
      const catalog = catalogMap(db), key = req.params.key, module = catalog.get(key);
      if (!module) return res.status(404).json({ error: 'module_not_found' });
      const enabled = req.body.enabled === null || req.body.enabled === undefined ? null : Boolean(req.body.enabled);
      if (enabled && module.status === 'reservado') return res.status(400).json({ error: 'reserved_module' });
      const limits = enabled ? cleanLimits(module, req.body.limits) : null;
      const validUntil = enabled === null ? null : text(req.body.validUntil);
      if (validUntil && Number.isNaN(new Date(validUntil).getTime())) return res.status(400).json({ error: 'invalid_valid_until' });
      const upsert = db.prepare(`INSERT INTO license_module(company_id,module_key,enabled,limits,valid_until,updated_by,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(company_id,module_key) DO UPDATE SET enabled=excluded.enabled,limits=excluded.limits,valid_until=excluded.valid_until,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`);
      const autoEnabled = [], autoDisabled = [];
      db.transaction(() => {
        const before = resolveCompanyModules(db, company.id).modules;
        if (enabled === null) db.prepare('DELETE FROM license_module WHERE company_id=? AND module_key=?').run(company.id, key);
        else upsert.run(company.id, key, enabled ? 1 : 0, limits ? JSON.stringify(limits) : null, validUntil, req.user.id);
        if (enabled) {
          const current = resolveCompanyModules(db, company.id).modules;
          for (const dep of dependencyClosure(catalog, key)) if (!current[dep]) { upsert.run(company.id, dep, 1, null, null, req.user.id); autoEnabled.push(dep); }
        } else if (enabled === false) {
          // Os que vêm do plano ficam bloqueados pela dependência e voltam sozinhos quando o pai religar.
          // Os que foram ligados à mão são desligados, para não reaparecerem sem ninguém pedir.
          const turnOff = db.prepare('UPDATE license_module SET enabled=0,limits=NULL,valid_until=NULL,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND module_key=? AND enabled=1');
          for (const child of dependentClosure(catalog, key)) {
            turnOff.run(req.user.id, company.id, child);
            if (before[child]) autoDisabled.push(child);
          }
        }
        logEvent(db, company.id, req.user.id, 'module_changed', { key, enabled, limits, validUntil, autoEnabled, autoDisabled });
      })();
      res.json({ ...companyView(db, company.id), autoEnabled, autoDisabled });
    } catch (e) { next(e); }
  });
}
