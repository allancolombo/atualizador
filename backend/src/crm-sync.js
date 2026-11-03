import crypto from 'node:crypto';
import { loadCatalog, normalizeDocument } from './modules.js';

const text = value => value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim();
const parseJson = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };

// Grupos do Perfex (tblcustomers_groups) criados em 03/11/2026 e o que cada um libera.
// O grupo é reconhecido pelo nome, porque o id muda se ele for recriado.
// Só é aplicado quando o grupo aparece pela primeira vez; depois vale o que estiver no painel.
// unlimited: o grupo tira o limite de aparelhos que veio do plano.
export const DEFAULT_CRM_GROUPS = [
  { name: 'Goo Site', kind: 'plan', plan: 'goo_site', priority: 1 },
  { name: 'Goo Delivery', kind: 'plan', plan: 'goo_delivery', priority: 2 },
  { name: 'Goo Salão', kind: 'plan', plan: 'goo_salao', priority: 3 },
  { name: 'Goo Max', kind: 'plan', plan: 'goo_max', priority: 4 },
  { name: 'Adicional Relatórios', kind: 'module', modules: ['relatorios'] },
  { name: 'Adicional Fiscal: emissão', kind: 'module', modules: ['fiscal', 'fiscal.nfce', 'fiscal.contabilidade', 'fiado.nfce'] },
  { name: 'Adicional Fiscal: entrada automática', kind: 'module', modules: ['fiscal.dfe', 'fiscal.entrada'] },
  { name: 'Adicional Ficha técnica', kind: 'module', modules: ['custo.insumos', 'custo.ficha', 'custo.cmv', 'custo.projecao', 'custo.historico', 'custo.producao', 'estoque.insumos'] },
  { name: 'Adicional Estoque', kind: 'module', modules: ['estoque', 'estoque.insumos'] },
  { name: 'Adicional Balança', kind: 'module', modules: ['balanca.peso', 'balanca.comanda'] },
  { name: 'Adicional Garçom (por aparelho)', kind: 'module', modules: ['mesas.garcom'] },
  { name: 'Adicional Garçom ilimitado', kind: 'module', modules: ['mesas.garcom'], unlimited: ['mesas.garcom'] },
  { name: 'Adicional Tablet na mesa (por tablet)', kind: 'module', modules: ['tablet'] },
  { name: 'Adicional Tablet na mesa ilimitado', kind: 'module', modules: ['tablet'], unlimited: ['tablet'] },
  { name: 'Adicional App do motoboy', kind: 'module', modules: ['motoboy.app'] },
  { name: 'Adicional Localização do motoboy', kind: 'module', modules: ['motoboy.localizacao'] },
  { name: 'Adicional Disparos de marketing', kind: 'module', modules: ['marketing'] },
  { name: 'Adicional Filial', kind: 'module', modules: ['filial'] }
];
const normalizeName = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function defaultForGroup(name) {
  const wanted = normalizeName(name);
  return DEFAULT_CRM_GROUPS.find(item => normalizeName(item.name) === wanted) || null;
}

function applyDefaultMapping(db, catalog, group) {
  const preset = defaultForGroup(group.name);
  if (preset?.kind === 'plan') {
    const plan = db.prepare('SELECT id FROM plan WHERE code=?').get(preset.plan);
    if (plan) db.prepare("UPDATE crm_group SET kind='plan',plan_id=?,priority=? WHERE id=?").run(plan.id, preset.priority, group.id);
  } else if (preset?.kind === 'module') {
    const keys = preset.modules.filter(key => catalog.has(key));
    db.prepare("UPDATE crm_group SET kind='module',module_keys=?,unlimited_keys=? WHERE id=?").run(JSON.stringify(keys), JSON.stringify(preset.unlimited || []), group.id);
  }
}

function normalizeLimits(value) {
  const result = {};
  for (const [key, limits] of Object.entries(value && typeof value === 'object' ? value : {})) {
    if (!limits || typeof limits !== 'object') continue;
    const clean = {};
    for (const [name, number] of Object.entries(limits)) {
      const parsed = Number(number);
      if (Number.isFinite(parsed) && parsed >= 0) clean[name] = Math.floor(parsed);
    }
    if (Object.keys(clean).length) result[key] = clean;
  }
  return Object.keys(result).length ? result : null;
}

function logEvent(db, companyId, action, details) {
  db.prepare('INSERT INTO license_event(company_id,user_id,action,details) VALUES(?,NULL,?,?)').run(companyId, action, details ? JSON.stringify(details) : null);
}

// Recebe a lista completa do Perfex. Cria o pré-cadastro por CNPJ, espelha os grupos
// e tira o vínculo com o CRM de quem saiu da lista.
export function syncCrm(db, body, ip = null) {
  const groups = Array.isArray(body?.groups) ? body.groups : [];
  const customers = Array.isArray(body?.customers) ? body.customers : [];
  if (!customers.length) throw new Error('customers_required');
  const catalog = new Map(loadCatalog(db).map(item => [item.key, item]));
  const result = { customers: customers.length, created: 0, changed: 0, removed: 0, skipped: [] };
  db.transaction(() => {
    for (const item of groups) {
      const id = Number(item?.id), name = text(item?.name);
      if (!Number.isInteger(id) || id <= 0 || !name) continue;
      const exists = db.prepare('SELECT 1 FROM crm_group WHERE id=?').get(id);
      db.prepare('INSERT INTO crm_group(id,name,priority) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,present=1,last_seen_at=CURRENT_TIMESTAMP').run(id, name);
      if (!exists) applyDefaultMapping(db, catalog, { id, name });
    }
    if (groups.length) {
      const ids = groups.map(item => Number(item?.id)).filter(Number.isInteger);
      db.prepare(`UPDATE crm_group SET present=0 WHERE id NOT IN (${ids.map(() => '?').join(',') || 'NULL'})`).run(...ids);
    }
    const known = new Set(db.prepare('SELECT id FROM crm_group').all().map(row => row.id));
    const seenDocuments = new Set(), seenCustomers = [];
    for (const item of customers) {
      const customerId = Number(item?.id), name = text(item?.name), document = normalizeDocument(item?.document);
      if (!Number.isInteger(customerId)) { result.skipped.push({ id: item?.id ?? null, name, reason: 'id_invalido' }); continue; }
      if (!document) { result.skipped.push({ id: customerId, name, reason: 'sem_cnpj' }); continue; }
      if (seenDocuments.has(document)) { result.skipped.push({ id: customerId, name, reason: 'cnpj_repetido', document }); continue; }
      seenDocuments.add(document); seenCustomers.push(customerId);
      const groupIds = [...new Set((Array.isArray(item.groups) ? item.groups : []).map(Number).filter(id => known.has(id)))].sort((a, b) => a - b);
      const data = {
        userCode: text(item.userCode), phone: text(item.phone), email: text(item.email), address: text(item.address),
        number: text(item.number), district: text(item.district), city: text(item.city), state: text(item.state), zip: text(item.zip)
      };
      const limits = normalizeLimits(item.limits);
      const active = item.active === undefined ? 1 : (item.active ? 1 : 0);
      const current = db.prepare('SELECT * FROM license_company WHERE document=?').get(document);
      if (!current) {
        const id = db.prepare(`INSERT INTO license_company(document,name,crm_customer_id,crm_user_code,crm_active,crm_groups,crm_limits,crm_data,crm_synced_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
          .run(document, name, customerId, data.userCode, active, JSON.stringify(groupIds), limits ? JSON.stringify(limits) : null, JSON.stringify(data)).lastInsertRowid;
        logEvent(db, id, 'crm_created', { customerId, groups: groupIds });
        result.created++;
        continue;
      }
      const previousGroups = parseJson(current.crm_groups, []);
      const groupsChanged = JSON.stringify(previousGroups) !== JSON.stringify(groupIds);
      const limitsChanged = (current.crm_limits || null) !== (limits ? JSON.stringify(limits) : null);
      const activeChanged = current.crm_active !== null && current.crm_active !== active;
      db.prepare(`UPDATE license_company SET name=coalesce(?,name),crm_customer_id=?,crm_user_code=?,crm_active=?,crm_groups=?,crm_limits=?,crm_data=?,crm_synced_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(name, customerId, data.userCode, active, JSON.stringify(groupIds), limits ? JSON.stringify(limits) : null, JSON.stringify(data), current.id);
      if (groupsChanged || limitsChanged || activeChanged || current.crm_customer_id !== customerId) {
        logEvent(db, current.id, 'crm_changed', { customerId, from: previousGroups, to: groupIds, limits, active: Boolean(active) });
        result.changed++;
      }
    }
    const marks = seenCustomers.map(() => '?').join(',') || 'NULL';
    for (const company of db.prepare(`SELECT id,crm_customer_id,crm_groups FROM license_company WHERE crm_customer_id IS NOT NULL AND crm_customer_id NOT IN (${marks})`).all(...seenCustomers)) {
      db.prepare("UPDATE license_company SET crm_customer_id=NULL,crm_groups='[]',crm_limits=NULL,crm_active=NULL WHERE id=?").run(company.id);
      logEvent(db, company.id, 'crm_removed', { customerId: company.crm_customer_id, from: parseJson(company.crm_groups, []) });
      result.removed++;
    }
    db.prepare('INSERT INTO crm_sync_run(ip,customers,created,changed,removed,skipped) VALUES(?,?,?,?,?,?)').run(ip, result.customers, result.created, result.changed, result.removed, JSON.stringify(result.skipped));
  })();
  return result;
}

function crmGroupView(db, row) {
  return {
    id: row.id, name: row.name, kind: row.kind, planId: row.plan_id, planName: row.plan_name, modules: parseJson(row.module_keys, []), unlimited: parseJson(row.unlimited_keys, []),
    priority: row.priority, present: Boolean(row.present), companyCount: row.company_count, lastSeenAt: row.last_seen_at, updatedAt: row.updated_at, updatedBy: row.updated_by_name
  };
}

export function registerCrmRoutes(app, { db, adminAuth, env = process.env }) {
  const adminOnly = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'admin_required' });
  const crmAuth = (req, res, next) => {
    const expected = text(env.CRM_SYNC_TOKEN);
    if (!expected || expected.length < 24) return res.status(503).json({ error: 'crm_sync_disabled' });
    const received = Buffer.from((req.get('authorization') || '').replace(/^Bearer /, '')), wanted = Buffer.from(expected);
    if (received.length !== wanted.length || !crypto.timingSafeEqual(received, wanted)) return res.status(401).json({ error: 'invalid_crm_token' });
    next();
  };

  app.post('/api/v1/integrations/crm/sync', crmAuth, (req, res) => {
    try { res.json(syncCrm(db, req.body, req.ip)); } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/v1/admin/modules/crm', adminAuth, (_req, res) => {
    const groups = db.prepare(`SELECT g.*,p.name plan_name,u.name updated_by_name,(SELECT count(*) FROM license_company c, json_each(c.crm_groups) j WHERE j.value=g.id) company_count FROM crm_group g LEFT JOIN plan p ON p.id=g.plan_id LEFT JOIN app_user u ON u.id=g.updated_by ORDER BY g.id`).all();
    const lastRun = db.prepare('SELECT * FROM crm_sync_run ORDER BY id DESC LIMIT 1').get();
    res.json({ configured: Boolean(text(env.CRM_SYNC_TOKEN)), groups: groups.map(row => crmGroupView(db, row)), lastRun: lastRun ? { ...lastRun, skipped: parseJson(lastRun.skipped, []) } : null });
  });

  app.put('/api/v1/admin/modules/crm/groups/:id', adminAuth, adminOnly, (req, res) => {
    const group = db.prepare('SELECT * FROM crm_group WHERE id=?').get(req.params.id);
    if (!group) return res.status(404).json({ error: 'crm_group_not_found' });
    const kind = ['plan', 'module', 'ignore'].includes(req.body.kind) ? req.body.kind : null;
    if (!kind) return res.status(400).json({ error: 'invalid_kind' });
    const catalog = new Map(loadCatalog(db).map(item => [item.key, item]));
    let planId = null, modules = [], unlimited = [];
    if (kind === 'plan') {
      planId = Number(req.body.planId);
      if (!db.prepare('SELECT 1 FROM plan WHERE id=?').get(planId)) return res.status(400).json({ error: 'plan_not_found' });
    }
    if (kind === 'module') {
      modules = [...new Set(Array.isArray(req.body.modules) ? req.body.modules : [])];
      const unknown = modules.find(key => !catalog.has(key) || catalog.get(key).status === 'reservado');
      if (unknown) return res.status(400).json({ error: `invalid_module_${unknown}` });
      if (!modules.length) return res.status(400).json({ error: 'modules_required' });
      unlimited = [...new Set(Array.isArray(req.body.unlimited) ? req.body.unlimited : [])].filter(key => modules.includes(key) && catalog.get(key).limitKeys.length);
    }
    const priority = Number.isInteger(Number(req.body.priority)) ? Number(req.body.priority) : group.priority;
    db.transaction(() => {
      db.prepare('UPDATE crm_group SET kind=?,plan_id=?,module_keys=?,unlimited_keys=?,priority=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(kind, planId, JSON.stringify(modules), JSON.stringify(unlimited), priority, req.user.id, group.id);
      for (const company of db.prepare('SELECT c.id FROM license_company c, json_each(c.crm_groups) j WHERE j.value=?').all(group.id)) {
        db.prepare('INSERT INTO license_event(company_id,user_id,action,details) VALUES(?,?,?,?)').run(company.id, req.user.id, 'crm_group_mapped', JSON.stringify({ groupId: group.id, name: group.name, kind, planId, modules }));
      }
    })();
    const row = db.prepare('SELECT g.*,p.name plan_name,u.name updated_by_name,(SELECT count(*) FROM license_company c, json_each(c.crm_groups) j WHERE j.value=g.id) company_count FROM crm_group g LEFT JOIN plan p ON p.id=g.plan_id LEFT JOIN app_user u ON u.id=g.updated_by WHERE g.id=?').get(group.id);
    res.json(crmGroupView(db, row));
  });
}
