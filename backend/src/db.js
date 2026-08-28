import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
export function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL'); db.pragma('busy_timeout = 5000'); db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS product(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS client(id INTEGER PRIMARY KEY AUTOINCREMENT,external_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,document TEXT,first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS terminal(id INTEGER PRIMARY KEY AUTOINCREMENT,external_id TEXT NOT NULL UNIQUE,client_id INTEGER NOT NULL,name TEXT NOT NULL,computer_name TEXT,product_code TEXT NOT NULL,channel TEXT NOT NULL DEFAULT 'production',current_version TEXT NOT NULL DEFAULT '0.0.0',os_version TEXT,first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(client_id) REFERENCES client(id));
    CREATE TABLE IF NOT EXISTS release(id INTEGER PRIMARY KEY AUTOINCREMENT,product_id INTEGER NOT NULL,version TEXT NOT NULL,channel TEXT NOT NULL CHECK(channel IN ('test','beta','production')),file_path TEXT NOT NULL,sha256 TEXT NOT NULL,size_bytes INTEGER NOT NULL,mandatory INTEGER NOT NULL DEFAULT 0,minimum_version TEXT,notes TEXT,active INTEGER NOT NULL DEFAULT 1,published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(product_id) REFERENCES product(id),UNIQUE(product_id,version,channel));
    CREATE TABLE IF NOT EXISTS ci_artifact(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,product_code TEXT NOT NULL,version TEXT NOT NULL,channel TEXT NOT NULL CHECK(channel IN ('test','beta','production')),file_path TEXT NOT NULL,original_name TEXT NOT NULL,sha256 TEXT NOT NULL,size_bytes INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,consumed_at TEXT,FOREIGN KEY(user_id) REFERENCES app_user(id));
    CREATE TABLE IF NOT EXISTS release_target(id INTEGER PRIMARY KEY AUTOINCREMENT,release_id INTEGER NOT NULL,target_type TEXT NOT NULL CHECK(target_type IN ('all','client')),client_id INTEGER,FOREIGN KEY(release_id) REFERENCES release(id) ON DELETE CASCADE,FOREIGN KEY(client_id) REFERENCES client(id),CHECK((target_type='all' AND client_id IS NULL) OR (target_type='client' AND client_id IS NOT NULL)),UNIQUE(release_id,client_id));
    CREATE TABLE IF NOT EXISTS terminal_event(id INTEGER PRIMARY KEY AUTOINCREMENT,terminal_id INTEGER,previous_version TEXT,target_version TEXT,status TEXT NOT NULL,message TEXT,ip TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(terminal_id) REFERENCES terminal(id));
    CREATE TABLE IF NOT EXISTS application_error(id INTEGER PRIMARY KEY AUTOINCREMENT,terminal_id INTEGER,product_code TEXT NOT NULL DEFAULT 'pdv',occurred_at TEXT NOT NULL,version TEXT,terminal_name TEXT,checkout_number TEXT,computer_name TEXT,mac_address TEXT,user_name TEXT,session_id TEXT,exception_class TEXT NOT NULL,message TEXT NOT NULL,stack_trace TEXT,screenshot_base64 TEXT,screenshot_mime TEXT,ip TEXT,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(terminal_id) REFERENCES terminal(id));
    CREATE TABLE IF NOT EXISTS error_setting(id INTEGER PRIMARY KEY CHECK(id=1),store_screenshot INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO error_setting(id,store_screenshot) VALUES(1,0);
    CREATE TABLE IF NOT EXISTS known_error_fix(id INTEGER PRIMARY KEY AUTOINCREMENT,signature TEXT NOT NULL,product_id INTEGER NOT NULL,channel TEXT NOT NULL CHECK(channel IN ('test','beta','production')),release_id INTEGER NOT NULL,note TEXT,created_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(product_id) REFERENCES product(id),FOREIGN KEY(release_id) REFERENCES release(id) ON DELETE CASCADE,FOREIGN KEY(created_by) REFERENCES app_user(id),UNIQUE(signature,product_id,channel));
    CREATE TABLE IF NOT EXISTS app_user(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('admin','operator')),active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS user_product(user_id INTEGER NOT NULL,product_id INTEGER NOT NULL,PRIMARY KEY(user_id,product_id),FOREIGN KEY(user_id) REFERENCES app_user(id) ON DELETE CASCADE,FOREIGN KEY(product_id) REFERENCES product(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS user_channel(user_id INTEGER NOT NULL,channel TEXT NOT NULL CHECK(channel IN ('test','beta','production')),PRIMARY KEY(user_id,channel),FOREIGN KEY(user_id) REFERENCES app_user(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS api_token_product(user_id INTEGER NOT NULL,product_id INTEGER NOT NULL,PRIMARY KEY(user_id,product_id),FOREIGN KEY(user_id) REFERENCES app_user(id) ON DELETE CASCADE,FOREIGN KEY(product_id) REFERENCES product(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS api_token_channel(user_id INTEGER NOT NULL,channel TEXT NOT NULL CHECK(channel IN ('test','beta','production')),PRIMARY KEY(user_id,channel),FOREIGN KEY(user_id) REFERENCES app_user(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS idx_release_lookup ON release(product_id,channel,active,published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_terminal_client ON terminal(client_id,last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_terminal ON terminal_event(terminal_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_application_error_received ON application_error(received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_application_error_terminal ON application_error(terminal_id,received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_known_error_fix_lookup ON known_error_fix(signature,product_id,channel);
    CREATE TABLE IF NOT EXISTS portal_identity(id INTEGER PRIMARY KEY AUTOINCREMENT,identity_type TEXT NOT NULL CHECK(identity_type IN ('cnpj','cpf')),document TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_login_at TEXT);
    CREATE TABLE IF NOT EXISTS certificate_identity(id INTEGER PRIMARY KEY AUTOINCREMENT,portal_identity_id INTEGER NOT NULL,serial_number TEXT,issuer TEXT,subject TEXT,fingerprint_sha256 TEXT NOT NULL UNIQUE,valid_from TEXT,valid_to TEXT,revoked_at TEXT,last_used_at TEXT,FOREIGN KEY(portal_identity_id) REFERENCES portal_identity(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS accounting_office(id INTEGER PRIMARY KEY AUTOINCREMENT,portal_identity_id INTEGER NOT NULL,cnpj TEXT NOT NULL UNIQUE,legal_name TEXT NOT NULL,trade_name TEXT,email TEXT,phone TEXT,responsible_name TEXT,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','blocked','correction_requested')),reviewed_by INTEGER,reviewed_at TEXT,review_notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(portal_identity_id) REFERENCES portal_identity(id),FOREIGN KEY(reviewed_by) REFERENCES app_user(id));
    CREATE TABLE IF NOT EXISTS accounting_client_access(accounting_office_id INTEGER NOT NULL,client_id INTEGER NOT NULL,can_view_invoices INTEGER NOT NULL DEFAULT 0,can_view_backups INTEGER NOT NULL DEFAULT 0,can_view_other INTEGER NOT NULL DEFAULT 0,can_upload_files INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,valid_from TEXT,valid_until TEXT,created_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,revoked_by INTEGER,revoked_at TEXT,PRIMARY KEY(accounting_office_id,client_id),FOREIGN KEY(accounting_office_id) REFERENCES accounting_office(id) ON DELETE CASCADE,FOREIGN KEY(client_id) REFERENCES client(id),FOREIGN KEY(created_by) REFERENCES app_user(id),FOREIGN KEY(revoked_by) REFERENCES app_user(id));
    CREATE TABLE IF NOT EXISTS client_file(id TEXT PRIMARY KEY,client_id INTEGER NOT NULL,terminal_id INTEGER,category TEXT NOT NULL CHECK(category IN ('incoming_invoice','outgoing_invoice','system_backup','other')),note_direction TEXT CHECK(note_direction IN ('entry','exit') OR note_direction IS NULL),document_type TEXT,document_model TEXT,environment TEXT,sequence_number INTEGER,original_name TEXT NOT NULL,storage_key TEXT NOT NULL UNIQUE,content_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,reference_date TEXT,uploaded_by_identity_id INTEGER,uploaded_by_user_id INTEGER,uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('uploading','available','quarantined','deleted')),expires_at TEXT,deleted_at TEXT,deleted_by INTEGER,delete_reason TEXT,visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),public_slug TEXT UNIQUE,public_enabled INTEGER NOT NULL DEFAULT 0,FOREIGN KEY(client_id) REFERENCES client(id),FOREIGN KEY(terminal_id) REFERENCES terminal(id),FOREIGN KEY(uploaded_by_identity_id) REFERENCES portal_identity(id),FOREIGN KEY(uploaded_by_user_id) REFERENCES app_user(id),FOREIGN KEY(deleted_by) REFERENCES app_user(id));
    CREATE TABLE IF NOT EXISTS client_file_folder(id INTEGER PRIMARY KEY AUTOINCREMENT,client_id INTEGER NOT NULL,parent_id INTEGER,name TEXT NOT NULL,created_by_identity_id INTEGER,created_by_user_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(client_id) REFERENCES client(id),FOREIGN KEY(parent_id) REFERENCES client_file_folder(id) ON DELETE CASCADE,UNIQUE(client_id,parent_id,name));
    CREATE TABLE IF NOT EXISTS client_file_folder_item(file_id TEXT PRIMARY KEY,folder_id INTEGER,FOREIGN KEY(file_id) REFERENCES client_file(id) ON DELETE CASCADE,FOREIGN KEY(folder_id) REFERENCES client_file_folder(id) ON DELETE SET NULL);
    CREATE TABLE IF NOT EXISTS portal_audit_event(id INTEGER PRIMARY KEY AUTOINCREMENT,identity_id INTEGER,session_id TEXT,accounting_office_id INTEGER,client_id INTEGER,file_id TEXT,action TEXT NOT NULL,result TEXT NOT NULL,ip TEXT,user_agent TEXT,details TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(identity_id) REFERENCES portal_identity(id),FOREIGN KEY(accounting_office_id) REFERENCES accounting_office(id),FOREIGN KEY(client_id) REFERENCES client(id),FOREIGN KEY(file_id) REFERENCES client_file(id));
    CREATE TABLE IF NOT EXISTS portal_auth_state(id TEXT PRIMARY KEY,state TEXT NOT NULL UNIQUE,document TEXT,identity_type TEXT,return_code TEXT UNIQUE,used_at TEXT,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS portal_session(id TEXT PRIMARY KEY,identity_id INTEGER NOT NULL,role TEXT NOT NULL CHECK(role IN ('client','accounting','unknown')),client_id INTEGER,accounting_office_id INTEGER,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,revoked_at TEXT,FOREIGN KEY(identity_id) REFERENCES portal_identity(id),FOREIGN KEY(client_id) REFERENCES client(id),FOREIGN KEY(accounting_office_id) REFERENCES accounting_office(id));
    CREATE INDEX IF NOT EXISTS idx_accounting_access_client ON accounting_client_access(client_id,active);
    CREATE INDEX IF NOT EXISTS idx_client_file_client ON client_file(client_id,category,status,uploaded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_client_file_duplicate ON client_file(client_id,category,sha256,reference_date);
    CREATE INDEX IF NOT EXISTS idx_portal_audit_created ON portal_audit_event(created_at DESC);
  `);

  ensureColumn(db, 'release', 'artifact_type', "TEXT NOT NULL DEFAULT 'package'");
  ensureColumn(db, 'release', 'original_name', 'TEXT');
  ensureColumn(db, 'release', 'deadline_at', 'TEXT');
  ensureColumn(db, 'terminal_event', 'release_id', 'INTEGER');
  ensureColumn(db, 'release', 'blocked', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'release', 'technical_notes', 'TEXT');
  ensureColumn(db, 'release', 'show_notes_pdv', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'release', 'published_by', 'INTEGER');
  ensureColumn(db, 'app_user', 'api_token_hash', 'TEXT');
  ensureColumn(db, 'app_user', 'api_token_created_at', 'TEXT');
  ensureColumn(db, 'ci_artifact', 'user_id', 'INTEGER');
  ensureColumn(db, 'application_error', 'key_terminal_id', 'TEXT');
  ensureColumn(db, 'application_error', 'crypto_salt', 'TEXT');
  ensureColumn(db, 'application_error', 'crypto_iv', 'TEXT');
  ensureColumn(db, 'application_error', 'crypto_auth_tag', 'TEXT');
  ensureColumn(db, 'application_error', 'encrypted_payload', 'TEXT');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_created_at ON terminal_event(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_event_release ON terminal_event(release_id,created_at DESC);
    UPDATE application_error SET received_at=replace(received_at,' ','T')||'Z' WHERE received_at NOT LIKE '%T%';
    CREATE TRIGGER IF NOT EXISTS trg_application_error_iso_time AFTER INSERT ON application_error
    BEGIN
      UPDATE application_error SET received_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
    END;
  `);
  db.pragma('optimize');
  return db;
}

function ensureColumn(db, table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all()
    .some(item => item.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
