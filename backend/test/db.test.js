import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db.js';

test('creates release artifact and event log columns', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'central-atualizacao-'));
  const db = openDatabase(path.join(directory, 'test.db'));
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const releaseColumns = db.prepare('PRAGMA table_info(release)').all().map(item => item.name);
  const eventColumns = db.prepare('PRAGMA table_info(terminal_event)').all().map(item => item.name);
  const errorColumns = db.prepare('PRAGMA table_info(application_error)').all().map(item => item.name);

  assert.ok(releaseColumns.includes('artifact_type'));
  assert.ok(releaseColumns.includes('original_name'));
  assert.ok(releaseColumns.includes('deadline_at'));
  assert.ok(eventColumns.includes('release_id'));
  assert.ok(releaseColumns.includes('blocked'));
  assert.ok(releaseColumns.includes('technical_notes'));
  assert.ok(releaseColumns.includes('show_notes_pdv'));
  assert.ok(releaseColumns.includes('published_by'));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_user'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_product'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_channel'").get());
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='application_error'").get());
  for (const table of ['portal_identity','certificate_identity','accounting_office','accounting_client_access','client_file','client_file_folder','portal_audit_event','portal_session']) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
  }
  const fileColumns = db.prepare('PRAGMA table_info(client_file)').all().map(item => item.name);
  for (const column of ['category','note_direction','document_type','document_model','environment','sequence_number','public_slug','visibility']) assert.ok(fileColumns.includes(column));
  for (const column of ['key_terminal_id','crypto_salt','crypto_iv','crypto_auth_tag','encrypted_payload']) assert.ok(errorColumns.includes(column));
  assert.deepEqual(db.prepare('SELECT store_screenshot FROM error_setting WHERE id=1').get(), { store_screenshot: 0 });
});
