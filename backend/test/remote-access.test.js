import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db.js';
import {
  buildInstallerCmd, buildInstallerScript, decryptRemotePassword, encryptRemotePassword, normalizeRemoteId,
  normalizeRemotePassword, recordRemoteAccessFromCheck, remoteAccessConfig, upsertRemoteAccess
} from '../src/remote-access.js';

const secret = 'segredo-de-teste-com-mais-de-32-caracteres';

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'central-remoto-'));
  const db = openDatabase(path.join(directory, 'test.db'));
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const clientId = Number(db.prepare("INSERT INTO client(external_id,name) VALUES('c1','Cliente')").run().lastInsertRowid);
  const terminal = id => Number(db.prepare("INSERT INTO terminal(external_id,client_id,name,computer_name,product_code) VALUES(?,?,?,?,'pdv')").run(id, clientId, id, `PC-${id}`).lastInsertRowid);
  return { db, clientId, terminal };
}

test('encrypts and decrypts the remote password', () => {
  const encrypted = encryptRemotePassword(secret, 'Senha123');
  const row = { password_salt: encrypted.salt, password_iv: encrypted.iv, password_auth_tag: encrypted.authTag, password_ciphertext: encrypted.ciphertext };
  assert.equal(decryptRemotePassword(secret, row), 'Senha123');
  assert.throws(() => decryptRemotePassword(`${secret}-outro`, row), /remote_password_authentication_failed/);
});

test('validates remote id and password', () => {
  assert.equal(normalizeRemoteId(' 123 456 789 '), '123456789');
  assert.equal(normalizeRemoteId('12345'), null);
  assert.equal(normalizeRemoteId('abc;drop'), null);
  assert.equal(normalizeRemotePassword('12345'), null);
  assert.equal(normalizeRemotePassword('senha\nquebrada'), null);
  assert.equal(normalizeRemotePassword('Senha123'), 'Senha123');
});

test('requires all settings to be configured', () => {
  assert.equal(remoteAccessConfig({}).configured, false);
  const config = remoteAccessConfig({ REMOTE_ACCESS_SECRET: secret, RUSTDESK_ID_SERVER: 'remoto.exemplo.com', RUSTDESK_KEY: 'chave', RUSTDESK_INSTALLER_URL: 'https://exemplo.com/rd.exe' });
  assert.equal(config.configured, true);
  assert.equal(config.relayServer, 'remoto.exemplo.com');
  assert.equal(config.linkDays, 7);
});

test('re-encrypts the password only when it changes and moves the terminal', t => {
  const { db, clientId, terminal } = setup(t);
  const terminalId = terminal('t1');
  const first = upsertRemoteAccess(db, secret, { clientId, terminalId, remoteId: '111111111', password: 'Senha123', source: 'check' });
  assert.deepEqual([first.created, first.passwordChanged], [true, true]);
  const same = upsertRemoteAccess(db, secret, { clientId, terminalId, remoteId: '111111111', password: 'Senha123', source: 'check' });
  assert.deepEqual([same.created, same.passwordChanged], [false, false]);
  const changed = upsertRemoteAccess(db, secret, { clientId, terminalId, remoteId: '111111111', password: 'Outra456', source: 'check' });
  assert.equal(changed.passwordChanged, true);
  assert.equal(decryptRemotePassword(secret, db.prepare('SELECT * FROM remote_access WHERE id=?').get(first.id)), 'Outra456');

  upsertRemoteAccess(db, secret, { clientId, terminalId, remoteId: '222222222', password: 'Senha123', source: 'check' });
  assert.equal(db.prepare("SELECT terminal_id FROM remote_access WHERE remote_id='111111111'").get().terminal_id, null);
  assert.equal(db.prepare("SELECT terminal_id FROM remote_access WHERE remote_id='222222222'").get().terminal_id, terminalId);
  assert.deepEqual(db.prepare('SELECT action FROM remote_access_event WHERE remote_access_id=? ORDER BY id').all(first.id).map(item => item.action), ['registered_check', 'password_changed']);
});

test('links the installer record to the terminal on the next check', t => {
  const { db, clientId, terminal } = setup(t);
  const installed = upsertRemoteAccess(db, secret, { clientId, remoteId: '333333333', password: 'Senha123', source: 'installer', computerName: 'PC-NOVO' });
  const terminalId = terminal('t2');
  const result = recordRemoteAccessFromCheck(db, { client: { id: clientId }, terminal: { id: terminalId, computer_name: 'PC-t2' } }, { id: '333333333', password: 'Senha123' }, '127.0.0.1', { REMOTE_ACCESS_SECRET: secret });
  assert.deepEqual(result, { stored: true, passwordChanged: false });
  const row = db.prepare('SELECT * FROM remote_access WHERE id=?').get(installed.id);
  assert.equal(row.terminal_id, terminalId);
  assert.equal(row.source, 'installer');
});

test('never fails the check when remote access is invalid or not configured', t => {
  const { db, clientId, terminal } = setup(t);
  const registration = { client: { id: clientId }, terminal: { id: terminal('t3') } };
  assert.equal(recordRemoteAccessFromCheck(db, registration, undefined, null, {}), null);
  assert.equal(recordRemoteAccessFromCheck(db, registration, { id: '444444444' }, null, {}).error, 'remote_access_not_configured');
  assert.equal(recordRemoteAccessFromCheck(db, registration, { id: 'x' }, null, { REMOTE_ACCESS_SECRET: secret }).error, 'invalid_remote_id');
  assert.equal(recordRemoteAccessFromCheck(db, registration, { id: '444444444', password: '1' }, null, { REMOTE_ACCESS_SECRET: secret }).error, 'invalid_remote_password');
});

test('escapes values embedded in the installer script', () => {
  const script = buildInstallerScript({
    registerUrl: 'https://central/api/v1/remote-access/register', token: "tok'en",
    config: { installerUrl: 'https://central/rd.exe', installerSha256: null, idServer: 'remoto', relayServer: 'remoto', key: "ab'c" }
  });
  assert.match(script, /\$Token = 'tok''en'/);
  assert.match(script, /\$ServerKey = 'ab''c'/);
  assert.match(script, /HKLM:\\SOFTWARE\\Goopedir\\AcessoRemoto/);
  const cmd = buildInstallerCmd({ scriptUrl: 'https://central/api/v1/remote-access/install/abc/script' });
  assert.match(cmd, /\r\n/);
  assert.match(cmd, /install\/abc\/script/);
});
