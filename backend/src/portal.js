import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import jwt from 'jsonwebtoken';

const categories = {
  incoming_invoice: { label: 'Nota fiscal de entrada', extensions: ['.xml'], maxSize: 25 * 1024 * 1024 },
  outgoing_invoice: { label: 'Nota fiscal de saida', extensions: ['.xml'], maxSize: 25 * 1024 * 1024 },
  system_backup: { label: 'Backup do sistema', extensions: ['.zip'], maxSize: 4 * 1024 * 1024 * 1024 },
  other: { label: 'Documento', extensions: ['.pdf', '.xml', '.zip', '.csv', '.xlsx', '.txt'], maxSize: 250 * 1024 * 1024 }
};

const digits = value => String(value || '').replace(/\D/g, '');
const text = value => value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim();
const nowIso = () => new Date().toISOString();
const addDays = days => days ? new Date(Date.now() + Number(days) * 86400000).toISOString() : null;
const safeJson = value => JSON.stringify(value || {});

export function registerPortalRoutes(app, { db, adminAuth, installationAuth, storagePath }) {
  const tempPath = path.join(storagePath, 'temporary');
  fs.mkdirSync(tempPath, { recursive: true });
  fs.mkdirSync(path.join(storagePath, 'clients'), { recursive: true });
  const upload = multer({ dest: tempPath, limits: { fileSize: Number(process.env.CLIENT_FILE_MAX_SIZE || categories.system_backup.maxSize) } });

  const audit = (req, action, result, extra = {}) => db.prepare(`INSERT INTO portal_audit_event(identity_id,session_id,accounting_office_id,client_id,file_id,action,result,ip,user_agent,details) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(extra.identityId || req.portal?.identity?.id || null, req.portal?.session?.id || null, extra.accountingOfficeId || req.portal?.session?.accounting_office_id || null, extra.clientId || null, extra.fileId || null, action, result, req.ip, req.get('user-agent') || null, safeJson(extra.details));

  const portalAuth = (req, res, next) => {
    try {
      const token = (req.get('authorization') || '').replace(/^Bearer /, '') || req.cookies?.portal_token;
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const session = db.prepare(`SELECT * FROM portal_session WHERE id=? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP`).get(decoded.sid);
      if (!session) throw new Error('invalid_session');
      const identity = db.prepare('SELECT * FROM portal_identity WHERE id=? AND active=1').get(session.identity_id);
      if (!identity) throw new Error('identity_blocked');
      req.portal = { session, identity };
      next();
    } catch {
      res.status(401).json({ error: 'unauthorized' });
    }
  };

  app.post('/api/v1/portal/auth/start', (req, res) => {
    const id = crypto.randomUUID(), state = crypto.randomBytes(24).toString('base64url');
    db.prepare("INSERT INTO portal_auth_state(id,state,expires_at) VALUES(?,?,datetime('now','+10 minutes'))").run(id, state);
    res.json({ state, certificateUrl: `/api/v1/portal/auth/certificate?state=${state}` });
  });
  app.get('/api/v1/portal/auth/certificate', (req, res) => {
    const state = db.prepare("SELECT * FROM portal_auth_state WHERE state=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP").get(req.query.state);
    if (!state) return res.status(400).json({ error: 'invalid_state' });
    const verified = ['success', '1', 'true'].includes(String(req.get('x-client-cert-verify') || process.env.PORTAL_DEV_CERT_VERIFY || '').toLowerCase());
    const document = digits(req.get('x-client-cert-document') || req.query.document);
    if (!verified || ![11, 14].includes(document.length)) {
      audit(req, 'certificate_login_failed', 'denied', { details: { reason: 'invalid_certificate_headers' } });
      return res.status(401).json({ error: 'certificate_required' });
    }
    const type = document.length === 14 ? 'cnpj' : 'cpf', code = crypto.randomBytes(24).toString('base64url'), name = text(req.get('x-client-cert-subject')) || document;
    db.transaction(() => {
      db.prepare('UPDATE portal_auth_state SET document=?,identity_type=?,return_code=?,used_at=CURRENT_TIMESTAMP WHERE id=?').run(document, type, code, state.id);
      db.prepare('INSERT INTO portal_identity(identity_type,document,display_name,last_login_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(document) DO UPDATE SET last_login_at=CURRENT_TIMESTAMP,display_name=coalesce(excluded.display_name,portal_identity.display_name)').run(type, document, name);
      const identity = db.prepare('SELECT id FROM portal_identity WHERE document=?').get(document);
      if (req.get('x-client-cert-fingerprint')) db.prepare(`INSERT INTO certificate_identity(portal_identity_id,serial_number,issuer,subject,fingerprint_sha256,valid_from,valid_to,last_used_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(fingerprint_sha256) DO UPDATE SET last_used_at=CURRENT_TIMESTAMP`)
        .run(identity.id, text(req.get('x-client-cert-serial')), text(req.get('x-client-cert-issuer')), text(req.get('x-client-cert-subject')), req.get('x-client-cert-fingerprint'), text(req.get('x-client-cert-valid-from')), text(req.get('x-client-cert-valid-to')));
    })();
    audit(req, 'certificate_login_succeeded', 'allowed', { details: { documentType: type } });
    res.json({ code });
  });
  app.post('/api/v1/portal/auth/exchange', (req, res) => {
    const state = db.prepare('SELECT * FROM portal_auth_state WHERE return_code=? AND document IS NOT NULL').get(req.body?.code);
    if (!state) return res.status(400).json({ error: 'invalid_code' });
    const identity = db.prepare('SELECT * FROM portal_identity WHERE document=? AND active=1').get(state.document);
    if (!identity) return res.status(403).json({ error: 'identity_blocked' });
    const client = db.prepare('SELECT * FROM client WHERE replace(replace(replace(document,\'.\',\'\'),\'/\',\'\'),\'-\',\'\')=?').get(state.document);
    const office = db.prepare("SELECT * FROM accounting_office WHERE cnpj=? AND status='approved'").get(state.document);
    const role = client ? 'client' : office ? 'accounting' : 'unknown';
    const sid = crypto.randomUUID();
    db.prepare("INSERT INTO portal_session(id,identity_id,role,client_id,accounting_office_id,expires_at) VALUES(?,?,?,?,?,datetime('now','+8 hours'))").run(sid, identity.id, role, client?.id || null, office?.id || null);
    const token = jwt.sign({ sid }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, role, identity, client: client ? { id: client.id, name: client.name } : null, accountingOffice: office ? { id: office.id, name: office.trade_name || office.legal_name } : null });
  });
  app.post('/api/v1/portal/auth/logout', portalAuth, (req, res) => {
    db.prepare('UPDATE portal_session SET revoked_at=CURRENT_TIMESTAMP WHERE id=?').run(req.portal.session.id);
    res.json({ loggedOut: true });
  });

  app.post('/api/v1/portal/accounting-registration', portalAuth, (req, res) => {
    if (req.portal.identity.identity_type !== 'cnpj') return res.status(400).json({ error: 'cnpj_required' });
    const id = db.prepare(`INSERT INTO accounting_office(portal_identity_id,cnpj,legal_name,trade_name,email,phone,responsible_name,status) VALUES(?,?,?,?,?,?,?,'pending') ON CONFLICT(cnpj) DO UPDATE SET legal_name=excluded.legal_name,trade_name=excluded.trade_name,email=excluded.email,phone=excluded.phone,responsible_name=excluded.responsible_name,status='pending',updated_at=CURRENT_TIMESTAMP RETURNING id`)
      .get(req.portal.identity.id, req.portal.identity.document, req.body.legalName, text(req.body.tradeName), text(req.body.email), text(req.body.phone), text(req.body.responsibleName)).id;
    audit(req, 'accounting_registration_requested', 'allowed', { accountingOfficeId: id });
    res.status(201).json({ id, status: 'pending' });
  });
  app.get('/api/v1/portal/accounting-registration/status', portalAuth, (req, res) => {
    const office = db.prepare('SELECT id,status,review_notes FROM accounting_office WHERE cnpj=?').get(req.portal.identity.document);
    res.json(office || { status: 'not_requested' });
  });

  const canSee = (session, fileOrClientId, category = null) => {
    const clientId = typeof fileOrClientId === 'object' ? fileOrClientId.client_id : Number(fileOrClientId);
    const fileCategory = category || fileOrClientId.category;
    if (session.role === 'client') return session.client_id === clientId;
    if (session.role !== 'accounting') return false;
    const link = db.prepare(`SELECT * FROM accounting_client_access WHERE accounting_office_id=? AND client_id=? AND active=1 AND (valid_from IS NULL OR valid_from<=CURRENT_TIMESTAMP) AND (valid_until IS NULL OR valid_until>=CURRENT_TIMESTAMP)`).get(session.accounting_office_id, clientId);
    if (!link) return false;
    if (['incoming_invoice', 'outgoing_invoice'].includes(fileCategory)) return Boolean(link.can_view_invoices);
    if (fileCategory === 'system_backup') return Boolean(link.can_view_backups);
    return Boolean(link.can_view_other);
  };

  const canUploadAsPortal = (session, clientId) => {
    if (session.role === 'client') return session.client_id === Number(clientId);
    if (session.role !== 'accounting') return false;
    return Boolean(db.prepare('SELECT 1 FROM accounting_client_access WHERE accounting_office_id=? AND client_id=? AND active=1 AND can_upload_files=1').get(session.accounting_office_id, clientId));
  };

  const storeFile = async (req, res, actor) => {
    const file = req.file;
    let finalPath;
    try {
      if (!file) throw new Error('file_required');
      const category = categories[req.body.category] ? req.body.category : null;
      if (!category) throw new Error('invalid_category');
      const clientId = Number(req.body.clientId || actor.clientId);
      const client = db.prepare('SELECT * FROM client WHERE id=?').get(clientId);
      if (!client) throw new Error('client_not_found');
      if (!actor.canUpload(clientId)) return res.status(403).json({ error: 'access_denied' });
      const ext = path.extname(file.originalname).toLowerCase();
      if (!categories[category].extensions.includes(ext)) throw new Error('invalid_file_extension');
      if (file.size > categories[category].maxSize) throw new Error('file_too_large');
      const sha = await hashFile(file.path);
      const referenceDate = text(req.body.referenceDate) || nowIso().slice(0, 10);
      if (db.prepare("SELECT 1 FROM client_file WHERE client_id=? AND category=? AND sha256=? AND reference_date=? AND status<>'deleted' LIMIT 1").get(clientId, category, sha, referenceDate)) throw new Error('duplicate_file');
      const id = crypto.randomUUID();
      const date = new Date(referenceDate);
      const y = Number.isNaN(date.getTime()) ? nowIso().slice(0, 4) : String(date.getUTCFullYear());
      const m = Number.isNaN(date.getTime()) ? nowIso().slice(5, 7) : String(date.getUTCMonth() + 1).padStart(2, '0');
      const folder = path.join(storagePath, 'clients', String(clientId), category, y, m);
      fs.mkdirSync(folder, { recursive: true });
      finalPath = path.join(folder, `${id}${ext || '.bin'}`);
      fs.renameSync(file.path, finalPath);
      const storageKey = path.relative(storagePath, finalPath).replace(/\\/g, '/');
      const publicEnabled = req.body.visibility === 'public';
      const publicSlug = publicEnabled ? crypto.randomBytes(9).toString('base64url') : null;
      db.transaction(() => {
        db.prepare(`INSERT INTO client_file(id,client_id,terminal_id,category,note_direction,document_type,document_model,environment,sequence_number,original_name,storage_key,content_type,size_bytes,sha256,reference_date,uploaded_by_identity_id,uploaded_by_user_id,expires_at,visibility,public_slug,public_enabled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, clientId, actor.terminalId || null, category, req.body.noteDirection || null, text(req.body.documentType), text(req.body.documentModel), text(req.body.environment), req.body.sequenceNumber ? Number(req.body.sequenceNumber) : null, path.basename(file.originalname), storageKey, file.mimetype || 'application/octet-stream', file.size, sha, referenceDate, actor.identityId || null, actor.userId || null, addDays(req.body.retentionDays), publicEnabled ? 'public' : 'private', publicSlug, publicEnabled ? 1 : 0);
        if (req.body.folderId) db.prepare('INSERT INTO client_file_folder_item(file_id,folder_id) VALUES(?,?)').run(id, Number(req.body.folderId));
      })();
      audit(req, 'client_file_uploaded', 'allowed', { clientId, fileId: id, identityId: actor.identityId, details: { category, originalName: file.originalname } });
      res.status(201).json({ id, sha256: sha, sizeBytes: file.size, publicUrl: publicSlug ? `/api/v1/public/files/${publicSlug}` : null });
    } catch (e) {
      if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      if (finalPath && fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
      res.status(400).json({ error: e.message });
    }
  };

  app.get('/api/v1/admin/client-files/categories', adminAuth, (_req, res) => res.json(categories));
  app.get('/api/v1/admin/client-files', adminAuth, (req, res) => {
    const where = [], args = [];
    if (req.query.clientId) { where.push('f.client_id=?'); args.push(req.query.clientId); }
    if (req.query.category) { where.push('f.category=?'); args.push(req.query.category); }
    if (req.query.status) { where.push('f.status=?'); args.push(req.query.status); } else where.push("f.status<>'deleted'");
    res.json(db.prepare(`SELECT f.*,c.name client_name,fo.name folder_name FROM client_file f JOIN client c ON c.id=f.client_id LEFT JOIN client_file_folder_item fi ON fi.file_id=f.id LEFT JOIN client_file_folder fo ON fo.id=fi.folder_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY f.uploaded_at DESC LIMIT 500`).all(...args));
  });
  app.post('/api/v1/admin/client-files', adminAuth, upload.single('file'), (req, res) => storeFile(req, res, { userId: req.user.id, clientId: req.body.clientId, canUpload: () => true }));
  app.get('/api/v1/admin/client-files/:id/download', adminAuth, (req, res) => sendFile(req, res, db, storagePath, true, audit));
  app.delete('/api/v1/admin/client-files/:id', adminAuth, (req, res) => {
    const file = db.prepare("SELECT * FROM client_file WHERE id=? AND status<>'deleted'").get(req.params.id);
    if (!file) return res.status(404).json({ error: 'file_not_found' });
    db.prepare("UPDATE client_file SET status='deleted',deleted_at=CURRENT_TIMESTAMP,deleted_by=?,delete_reason=? WHERE id=?").run(req.user.id, text(req.body?.reason) || 'Removido pelo administrador', file.id);
    audit(req, 'client_file_deleted', 'allowed', { clientId: file.client_id, fileId: file.id });
    res.json({ deleted: true });
  });

  app.get('/api/v1/admin/accounting-offices', adminAuth, (_req, res) => res.json(db.prepare('SELECT * FROM accounting_office ORDER BY status,created_at DESC').all()));
  app.post('/api/v1/admin/accounting-offices', adminAuth, (req, res) => {
    const cnpj = digits(req.body.cnpj);
    if (cnpj.length !== 14) return res.status(400).json({ error: 'invalid_cnpj' });
    const id = db.transaction(() => {
      db.prepare("INSERT INTO portal_identity(identity_type,document,display_name) VALUES('cnpj',?,?) ON CONFLICT(document) DO UPDATE SET display_name=excluded.display_name").run(cnpj, req.body.tradeName || req.body.legalName || cnpj);
      const identity = db.prepare('SELECT id FROM portal_identity WHERE document=?').get(cnpj);
      return db.prepare(`INSERT INTO accounting_office(portal_identity_id,cnpj,legal_name,trade_name,email,phone,responsible_name,status) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(cnpj) DO UPDATE SET legal_name=excluded.legal_name,trade_name=excluded.trade_name,email=excluded.email,phone=excluded.phone,responsible_name=excluded.responsible_name,updated_at=CURRENT_TIMESTAMP RETURNING id`)
        .get(identity.id, cnpj, req.body.legalName, text(req.body.tradeName), text(req.body.email), text(req.body.phone), text(req.body.responsibleName), req.body.status || 'pending').id;
    })();
    res.status(201).json({ id });
  });
  app.patch('/api/v1/admin/accounting-offices/:id/status', adminAuth, (req, res) => {
    if (!['pending', 'approved', 'rejected', 'blocked', 'correction_requested'].includes(req.body.status)) return res.status(400).json({ error: 'invalid_status' });
    db.prepare('UPDATE accounting_office SET status=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP,review_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(req.body.status, req.user.id, text(req.body.notes), req.params.id);
    audit(req, `accounting_registration_${req.body.status}`, 'allowed', { accountingOfficeId: Number(req.params.id) });
    res.json({ updated: true });
  });
  app.get('/api/v1/admin/accounting-offices/:id/clients', adminAuth, (req, res) => res.json(db.prepare('SELECT a.*,c.name client_name,c.document FROM accounting_client_access a JOIN client c ON c.id=a.client_id WHERE a.accounting_office_id=? ORDER BY c.name').all(req.params.id)));
  app.post('/api/v1/admin/accounting-offices/:id/clients', adminAuth, (req, res) => {
    db.prepare(`INSERT INTO accounting_client_access(accounting_office_id,client_id,can_view_invoices,can_view_backups,can_view_other,can_upload_files,active,valid_from,valid_until,created_by) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(accounting_office_id,client_id) DO UPDATE SET can_view_invoices=excluded.can_view_invoices,can_view_backups=excluded.can_view_backups,can_view_other=excluded.can_view_other,can_upload_files=excluded.can_upload_files,active=excluded.active,valid_from=excluded.valid_from,valid_until=excluded.valid_until,revoked_at=NULL,revoked_by=NULL`)
      .run(req.params.id, req.body.clientId, req.body.canViewInvoices ? 1 : 0, req.body.canViewBackups ? 1 : 0, req.body.canViewOther ? 1 : 0, req.body.canUploadFiles ? 1 : 0, req.body.active === false ? 0 : 1, text(req.body.validFrom), text(req.body.validUntil), req.user.id);
    audit(req, 'accounting_client_link_created', 'allowed', { accountingOfficeId: Number(req.params.id), clientId: Number(req.body.clientId) });
    res.status(201).json({ linked: true });
  });
  app.delete('/api/v1/admin/accounting-offices/:id/clients/:clientId', adminAuth, (req, res) => {
    db.prepare('UPDATE accounting_client_access SET active=0,revoked_by=?,revoked_at=CURRENT_TIMESTAMP WHERE accounting_office_id=? AND client_id=?').run(req.user.id, req.params.id, req.params.clientId);
    audit(req, 'accounting_client_link_revoked', 'allowed', { accountingOfficeId: Number(req.params.id), clientId: Number(req.params.clientId) });
    res.json({ revoked: true });
  });
  app.get('/api/v1/admin/portal-audit', adminAuth, (_req, res) => res.json(db.prepare(`SELECT a.*,i.display_name identity_name,c.name client_name,f.original_name file_name,o.trade_name accounting_name FROM portal_audit_event a LEFT JOIN portal_identity i ON i.id=a.identity_id LEFT JOIN client c ON c.id=a.client_id LEFT JOIN client_file f ON f.id=a.file_id LEFT JOIN accounting_office o ON o.id=a.accounting_office_id ORDER BY a.created_at DESC LIMIT 500`).all()));

  app.post('/api/v1/client-files/uploads', installationAuth, upload.single('file'), (req, res) => {
    const terminal = db.prepare('SELECT t.*,c.id client_id FROM terminal t JOIN client c ON c.id=t.client_id WHERE lower(trim(t.external_id))=?').get(String(req.body.terminalId || '').trim().toLowerCase());
    if (!terminal) return res.status(404).json({ error: 'terminal_not_found' });
    storeFile(req, res, { terminalId: terminal.id, clientId: terminal.client_id, canUpload: clientId => Number(clientId) === terminal.client_id });
  });

  app.get('/api/v1/portal/me', portalAuth, (req, res) => res.json({ identity: req.portal.identity, session: req.portal.session }));
  app.get('/api/v1/portal/clients', portalAuth, (req, res) => {
    if (req.portal.session.role === 'client') return res.json(db.prepare('SELECT id,name,document FROM client WHERE id=?').all(req.portal.session.client_id));
    res.json(db.prepare(`SELECT c.id,c.name,c.document,a.can_view_invoices,a.can_view_backups,a.can_view_other,a.can_upload_files FROM accounting_client_access a JOIN client c ON c.id=a.client_id WHERE a.accounting_office_id=? AND a.active=1 ORDER BY c.name`).all(req.portal.session.accounting_office_id));
  });
  app.get('/api/v1/portal/clients/:clientId/files', portalAuth, (req, res) => {
    const rows = db.prepare("SELECT id,client_id,category,original_name,content_type,size_bytes,reference_date,uploaded_at,expires_at,visibility,public_slug FROM client_file WHERE client_id=? AND status='available' ORDER BY uploaded_at DESC").all(req.params.clientId).filter(row => canSee(req.portal.session, row));
    audit(req, 'client_file_listed', 'allowed', { clientId: Number(req.params.clientId) });
    res.json(rows);
  });
  app.post('/api/v1/portal/clients/:clientId/files', portalAuth, upload.single('file'), (req, res) => storeFile(req, res, { identityId: req.portal.identity.id, clientId: req.params.clientId, canUpload: clientId => canUploadAsPortal(req.portal.session, clientId) }));
  app.get('/api/v1/portal/files/:id/download', portalAuth, (req, res) => {
    const file = db.prepare("SELECT * FROM client_file WHERE id=? AND status='available'").get(req.params.id);
    if (!file || !canSee(req.portal.session, file)) {
      audit(req, 'client_file_download_denied', 'denied', { fileId: req.params.id, clientId: file?.client_id || null });
      return res.status(404).json({ error: 'file_not_found' });
    }
    sendFile(req, res, db, storagePath, false, audit);
  });
  app.get('/api/v1/public/files/:slug', (req, res) => {
    const file = db.prepare("SELECT * FROM client_file WHERE public_slug=? AND public_enabled=1 AND visibility='public' AND status='available'").get(req.params.slug);
    if (!file) return res.status(404).json({ error: 'file_not_found' });
    serveStoredFile(res, storagePath, file);
  });
}

async function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

function sendFile(req, res, db, storagePath, admin, audit) {
  const file = db.prepare("SELECT * FROM client_file WHERE id=? AND status='available'").get(req.params.id);
  if (!file) return res.status(404).json({ error: 'file_not_found' });
  audit(req, 'client_file_downloaded', admin ? 'admin_allowed' : 'allowed', { clientId: file.client_id, fileId: file.id });
  serveStoredFile(res, storagePath, file);
}

function serveStoredFile(res, storagePath, file) {
  const full = path.resolve(storagePath, file.storage_key);
  if (!full.startsWith(path.resolve(storagePath) + path.sep) || !fs.existsSync(full)) return res.status(404).json({ error: 'file_missing' });
  res.set('Content-Type', file.content_type || 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"`);
  res.sendFile(full);
}
