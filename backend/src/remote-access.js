import crypto from 'node:crypto';

const cryptoInfo = Buffer.from('central-atualizacao:remote-password:v1');
const text = value => value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim();
const marks = items => items.map(() => '?').join(',') || 'NULL';
const hashToken = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const psQuote = value => `'${String(value ?? '').replace(/'/g, "''")}'`;

export function remoteAccessConfig(env = process.env) {
  const secret = text(env.REMOTE_ACCESS_SECRET);
  const idServer = text(env.RUSTDESK_ID_SERVER);
  return {
    secret,
    idServer,
    relayServer: text(env.RUSTDESK_RELAY_SERVER) || idServer,
    key: text(env.RUSTDESK_KEY),
    installerUrl: text(env.RUSTDESK_INSTALLER_URL),
    installerSha256: text(env.RUSTDESK_INSTALLER_SHA256)?.toUpperCase() || null,
    publicBaseUrl: text(env.PUBLIC_BASE_URL)?.replace(/\/$/, '') || null,
    linkDays: Math.min(Math.max(Number(env.REMOTE_ACCESS_LINK_DAYS) || 7, 1), 30),
    configured: Boolean(secret && secret.length >= 32 && idServer && env.RUSTDESK_KEY && env.RUSTDESK_INSTALLER_URL)
  };
}

export function normalizeRemoteId(value) {
  const id = String(value ?? '').replace(/\s/g, '');
  return /^[A-Za-z0-9_-]{6,32}$/.test(id) ? id : null;
}

export function normalizeRemotePassword(value) {
  const password = String(value ?? '');
  return password.length >= 6 && password.length <= 128 && !/[\u0000-\u001f\u007f]/.test(password) ? password : null;
}

function passwordKey(secret, salt) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), salt, cryptoInfo, 32));
}

export function passwordHmac(secret, password) {
  return crypto.createHmac('sha256', secret).update(`remote-password:${password}`).digest('hex');
}

export function encryptRemotePassword(secret, password) {
  const salt = crypto.randomBytes(32), iv = crypto.randomBytes(12), key = passwordKey(secret, salt);
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return { salt: salt.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  } finally { key.fill(0); }
}

export function decryptRemotePassword(secret, row) {
  if (!row?.password_ciphertext) return null;
  const key = passwordKey(secret, Buffer.from(row.password_salt, 'base64'));
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(row.password_iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.password_auth_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.password_ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new Error('remote_password_authentication_failed'); }
  finally { key.fill(0); }
}

// Um mesmo ID do RustDesk pertence a um único registro; o terminal informado no
// check passa a apontar só para ele e a senha é recifrada apenas quando muda.
export function upsertRemoteAccess(db, secret, { clientId, terminalId = null, linkId = null, remoteId, computerName = null, password = null, source, ip = null }) {
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM remote_access WHERE remote_id=?').get(remoteId);
    if (terminalId) db.prepare('UPDATE remote_access SET terminal_id=NULL WHERE terminal_id=? AND remote_id<>?').run(terminalId, remoteId);
    const hmac = password ? passwordHmac(secret, password) : null;
    const passwordChanged = Boolean(password && existing?.password_hmac !== hmac);
    const encrypted = passwordChanged ? encryptRemotePassword(secret, password) : null;
    let id = existing?.id;
    if (existing) {
      db.prepare(`UPDATE remote_access SET client_id=?,terminal_id=COALESCE(?,terminal_id),link_id=COALESCE(?,link_id),computer_name=COALESCE(?,computer_name),last_seen_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(clientId, terminalId, linkId, computerName, id);
    } else {
      id = Number(db.prepare('INSERT INTO remote_access(client_id,terminal_id,link_id,remote_id,computer_name,source) VALUES(?,?,?,?,?,?)')
        .run(clientId, terminalId, linkId, remoteId, computerName, source).lastInsertRowid);
      db.prepare('INSERT INTO remote_access_event(remote_access_id,link_id,action,ip) VALUES(?,?,?,?)').run(id, linkId, `registered_${source}`, ip);
    }
    if (encrypted) {
      db.prepare('UPDATE remote_access SET password_salt=?,password_iv=?,password_auth_tag=?,password_ciphertext=?,password_hmac=?,password_updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(encrypted.salt, encrypted.iv, encrypted.authTag, encrypted.ciphertext, hmac, id);
      if (existing) db.prepare('INSERT INTO remote_access_event(remote_access_id,action,ip) VALUES(?,?,?)').run(id, 'password_changed', ip);
    }
    return { id, created: !existing, passwordChanged };
  })();
}

// Chamado pelo /updates/check. Falha aqui nunca pode impedir a atualização.
export function recordRemoteAccessFromCheck(db, registration, payload, ip, env = process.env) {
  if (!payload) return null;
  const config = remoteAccessConfig(env);
  if (!config.secret || config.secret.length < 32) return { stored: false, error: 'remote_access_not_configured' };
  const remoteId = normalizeRemoteId(payload.id);
  if (!remoteId) return { stored: false, error: 'invalid_remote_id' };
  const password = payload.password === undefined || payload.password === null || payload.password === '' ? null : normalizeRemotePassword(payload.password);
  if (payload.password && !password) return { stored: false, error: 'invalid_remote_password' };
  try {
    const result = upsertRemoteAccess(db, config.secret, {
      clientId: registration.client.id, terminalId: registration.terminal.id, remoteId,
      computerName: registration.terminal.computer_name, password, source: 'check', ip
    });
    return { stored: true, passwordChanged: result.passwordChanged };
  } catch (error) {
    console.error('remote_access_check_failed', error);
    return { stored: false, error: 'remote_access_store_failed' };
  }
}

export function buildInstallerCmd({ scriptUrl }) {
  const command = `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; & ([scriptblock]::Create((Invoke-RestMethod -UseBasicParsing -Uri '${scriptUrl}')))`;
  return [
    '@echo off',
    'setlocal',
    'title Goopedir - Acesso remoto',
    'net session >nul 2>&1',
    'if %errorlevel% neq 0 (',
    '  powershell -NoProfile -Command "Start-Process -FilePath \'%~f0\' -Verb RunAs"',
    '  exit /b',
    ')',
    'set "PS=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"',
    'if exist "%SystemRoot%\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe" set "PS=%SystemRoot%\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe"',
    `"%PS%" -NoProfile -ExecutionPolicy Bypass -Command "${command}"`,
    'echo.',
    'pause',
    ''
  ].join('\r\n');
}

export function buildInstallerScript({ registerUrl, token, config }) {
  return `$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$RegisterUrl = ${psQuote(registerUrl)}
$Token = ${psQuote(token)}
$InstallerUrl = ${psQuote(config.installerUrl)}
$InstallerSha256 = ${psQuote(config.installerSha256 || '')}
$IdServer = ${psQuote(config.idServer)}
$RelayServer = ${psQuote(config.relayServer)}
$ServerKey = ${psQuote(config.key)}
$RegistryPath = 'HKLM:\\SOFTWARE\\Goopedir\\AcessoRemoto'
$Entropy = [Text.Encoding]::UTF8.GetBytes('Goopedir.AcessoRemoto.v1')
$Exe = Join-Path $env:ProgramFiles 'RustDesk\\rustdesk.exe'

function Invoke-RustDesk([string[]]$Arguments) {
  $process = Start-Process -FilePath $Exe -ArgumentList $Arguments -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { Write-Warning "RustDesk retornou $($process.ExitCode) em $($Arguments[0])" }
}

Write-Host 'Instalando acesso remoto Goopedir...'
if (-not (Test-Path $Exe)) {
  $Setup = Join-Path $env:TEMP ("rustdesk-" + [guid]::NewGuid().ToString('N') + '.exe')
  Invoke-WebRequest -UseBasicParsing -Uri $InstallerUrl -OutFile $Setup
  if ($InstallerSha256 -and (Get-FileHash -Algorithm SHA256 -Path $Setup).Hash -ne $InstallerSha256) { throw 'O hash do instalador do RustDesk nao confere.' }
  Start-Process -FilePath $Setup -ArgumentList '--silent-install' -Wait
  for ($i = 0; $i -lt 60 -and -not (Test-Path $Exe); $i++) { Start-Sleep -Seconds 1 }
  Remove-Item $Setup -Force -ErrorAction SilentlyContinue
  if (-not (Test-Path $Exe)) { throw 'O RustDesk nao foi instalado.' }
}

Invoke-RustDesk @('--option', 'custom-rendezvous-server', $IdServer)
Invoke-RustDesk @('--option', 'relay-server', $RelayServer)
Invoke-RustDesk @('--option', 'key', $ServerKey)

$Bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($Bytes)
$Password = ([Convert]::ToBase64String($Bytes) -replace '[^A-Za-z0-9]', '').Substring(0, 16)
Invoke-RustDesk @('--password', $Password)
Restart-Service -Name 'RustDesk' -ErrorAction SilentlyContinue

$RemoteId = $null
for ($i = 0; $i -lt 30 -and -not $RemoteId; $i++) {
  $RemoteId = ((& $Exe --get-id | Out-String).Trim() -replace '\\s', '')
  if (-not $RemoteId) { Start-Sleep -Seconds 1 }
}
if (-not $RemoteId) { throw 'Nao foi possivel obter o ID do RustDesk.' }

Add-Type -AssemblyName System.Security
$Protected = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($Password), $Entropy, [Security.Cryptography.DataProtectionScope]::LocalMachine)
New-Item -Path $RegistryPath -Force | Out-Null
Set-ItemProperty -Path $RegistryPath -Name 'RemoteId' -Value $RemoteId
Set-ItemProperty -Path $RegistryPath -Name 'Password' -Value ([Convert]::ToBase64String($Protected))
Set-ItemProperty -Path $RegistryPath -Name 'UpdatedAt' -Value ((Get-Date).ToUniversalTime().ToString('o'))

$Body = @{ token = $Token; remoteId = $RemoteId; password = $Password; computerName = $env:COMPUTERNAME } | ConvertTo-Json
Invoke-RestMethod -UseBasicParsing -Method Post -Uri $RegisterUrl -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($Body)) | Out-Null
Write-Host "Acesso remoto instalado. ID: $RemoteId"
`;
}

export function registerRemoteAccessRoutes(app, { db, adminAuth }) {
  const baseUrl = (req, config) => config.publicBaseUrl || `${req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`;
  const requireConfig = (_req, res, next) => {
    const config = remoteAccessConfig();
    if (!config.configured) return res.status(503).json({ error: 'remote_access_not_configured' });
    res.locals.remoteConfig = config;
    next();
  };
  const clientInScope = (req, clientId) => {
    if (req.scopes.all) return true;
    const { productIds, channels } = req.scopes;
    if (!productIds.length || !channels.length) return false;
    return Boolean(db.prepare(`SELECT 1 FROM terminal t JOIN product p ON p.code=t.product_code WHERE t.client_id=? AND p.id IN (${marks(productIds)}) AND t.channel IN (${marks(channels)}) LIMIT 1`)
      .get(clientId, ...productIds, ...channels));
  };
  const scopedClient = (req, res) => {
    const client = db.prepare('SELECT id,name FROM client WHERE id=?').get(req.params.id);
    if (!client) { res.status(404).json({ error: 'client_not_found' }); return null; }
    if (!clientInScope(req, client.id)) { res.status(403).json({ error: 'scope_denied' }); return null; }
    return client;
  };
  const activeLink = token => db.prepare(`SELECT * FROM remote_access_link WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?`)
    .get(hashToken(token), new Date().toISOString());

  app.get('/api/v1/admin/remote-access/config', adminAuth, (_req, res) => {
    const config = remoteAccessConfig();
    res.json({ configured: config.configured, idServer: config.idServer, relayServer: config.relayServer, hasKey: Boolean(config.key), linkDays: config.linkDays });
  });

  app.get('/api/v1/admin/clients/:id/remote-access', adminAuth, (req, res) => {
    const client = scopedClient(req, res);
    if (!client) return;
    res.json(db.prepare(`SELECT a.id,a.remote_id,a.computer_name,a.source,a.terminal_id,t.name terminal_name,t.computer_name terminal_computer_name,a.password_ciphertext IS NOT NULL has_password,a.password_updated_at,a.first_seen_at,a.last_seen_at FROM remote_access a LEFT JOIN terminal t ON t.id=a.terminal_id WHERE a.client_id=? ORDER BY a.last_seen_at DESC`)
      .all(client.id).map(item => ({ ...item, has_password: Boolean(item.has_password) })));
  });

  app.get('/api/v1/admin/clients/:id/remote-access/links', adminAuth, (req, res) => {
    const client = scopedClient(req, res);
    if (!client) return;
    const now = new Date().toISOString();
    res.json(db.prepare(`SELECT l.id,l.note,l.created_at,l.expires_at,l.used_at,l.revoked_at,u.name created_by_name FROM remote_access_link l LEFT JOIN app_user u ON u.id=l.created_by WHERE l.client_id=? ORDER BY l.created_at DESC LIMIT 50`)
      .all(client.id).map(item => ({ ...item, status: item.revoked_at ? 'revoked' : item.used_at ? 'used' : item.expires_at <= now ? 'expired' : 'active' })));
  });

  app.post('/api/v1/admin/clients/:id/remote-access/links', adminAuth, requireConfig, (req, res) => {
    const client = scopedClient(req, res);
    if (!client) return;
    const config = res.locals.remoteConfig, id = crypto.randomUUID(), token = crypto.randomBytes(32).toString('base64url');
    const days = Math.min(Math.max(Number(req.body?.days) || config.linkDays, 1), 30);
    const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    db.prepare('INSERT INTO remote_access_link(id,token_hash,client_id,note,created_by,expires_at) VALUES(?,?,?,?,?,?)')
      .run(id, hashToken(token), client.id, text(req.body?.note), req.user.id, expiresAt);
    db.prepare('INSERT INTO remote_access_event(link_id,user_id,action,ip) VALUES(?,?,?,?)').run(id, req.user.id, 'link_created', req.ip);
    res.status(201).json({ id, url: `${baseUrl(req, config)}/api/v1/remote-access/install/${token}`, expiresAt });
  });

  app.delete('/api/v1/admin/remote-access/links/:linkId', adminAuth, (req, res) => {
    const link = db.prepare('SELECT * FROM remote_access_link WHERE id=?').get(req.params.linkId);
    if (!link) return res.status(404).json({ error: 'link_not_found' });
    if (!clientInScope(req, link.client_id)) return res.status(403).json({ error: 'scope_denied' });
    db.prepare('UPDATE remote_access_link SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP) WHERE id=?').run(link.id);
    db.prepare('INSERT INTO remote_access_event(link_id,user_id,action,ip) VALUES(?,?,?,?)').run(link.id, req.user.id, 'link_revoked', req.ip);
    res.json({ revoked: true });
  });

  app.post('/api/v1/admin/remote-access/:id/password', adminAuth, (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin_required' });
    const config = remoteAccessConfig();
    if (!config.secret) return res.status(503).json({ error: 'remote_access_not_configured' });
    const access = db.prepare('SELECT * FROM remote_access WHERE id=?').get(req.params.id);
    if (!access) return res.status(404).json({ error: 'remote_access_not_found' });
    const password = decryptRemotePassword(config.secret, access);
    if (!password) return res.status(404).json({ error: 'remote_password_not_stored' });
    db.prepare('INSERT INTO remote_access_event(remote_access_id,user_id,action,ip) VALUES(?,?,?,?)').run(access.id, req.user.id, 'password_revealed', req.ip);
    res.set('Cache-Control', 'no-store, private').json({ remoteId: access.remote_id, password });
  });

  app.get('/api/v1/admin/remote-access/:id/events', adminAuth, (req, res) => {
    const access = db.prepare('SELECT id,client_id FROM remote_access WHERE id=?').get(req.params.id);
    if (!access) return res.status(404).json({ error: 'remote_access_not_found' });
    if (!clientInScope(req, access.client_id)) return res.status(403).json({ error: 'scope_denied' });
    res.json(db.prepare('SELECT e.id,e.action,e.ip,e.created_at,u.name user_name FROM remote_access_event e LEFT JOIN app_user u ON u.id=e.user_id WHERE e.remote_access_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 100').all(access.id));
  });

  app.get('/api/v1/remote-access/install/:token', requireConfig, (req, res) => {
    if (!activeLink(req.params.token)) return res.status(410).json({ error: 'link_invalid_or_expired' });
    const scriptUrl = `${baseUrl(req, res.locals.remoteConfig)}/api/v1/remote-access/install/${req.params.token}/script`;
    res.set('Cache-Control', 'no-store, private')
      .set('Content-Disposition', 'attachment; filename="instalar-acesso-remoto-goopedir.cmd"')
      .type('application/octet-stream')
      .send(buildInstallerCmd({ scriptUrl }));
  });

  app.get('/api/v1/remote-access/install/:token/script', requireConfig, (req, res) => {
    if (!activeLink(req.params.token)) return res.status(410).type('text/plain').send("throw 'Link de acesso remoto invalido ou expirado.'");
    const config = res.locals.remoteConfig;
    res.set('Cache-Control', 'no-store, private').type('text/plain; charset=utf-8')
      .send(buildInstallerScript({ registerUrl: `${baseUrl(req, config)}/api/v1/remote-access/register`, token: req.params.token, config }));
  });

  app.post('/api/v1/remote-access/register', requireConfig, (req, res) => {
    const link = activeLink(req.body?.token);
    if (!link) return res.status(410).json({ error: 'link_invalid_or_expired' });
    const remoteId = normalizeRemoteId(req.body?.remoteId), password = normalizeRemotePassword(req.body?.password);
    if (!remoteId) return res.status(400).json({ error: 'invalid_remote_id' });
    if (!password) return res.status(400).json({ error: 'invalid_remote_password' });
    const result = db.transaction(() => {
      const stored = upsertRemoteAccess(db, res.locals.remoteConfig.secret, {
        clientId: link.client_id, linkId: link.id, remoteId, computerName: text(req.body?.computerName)?.slice(0, 120) || null,
        password, source: 'installer', ip: req.ip
      });
      db.prepare('UPDATE remote_access_link SET used_at=CURRENT_TIMESTAMP WHERE id=?').run(link.id);
      return stored;
    })();
    res.status(201).json({ registered: true, id: result.id });
  });
}
