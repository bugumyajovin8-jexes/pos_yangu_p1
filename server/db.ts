import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Using a new database file to cleanly apply the new Email/Password schema
const dbPath = path.join(dbDir, 'backend_v2.db');
export const db = new Database(dbPath);

// Initialize Backend Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS shops (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('superadmin', 'admin', 'manager', 'employee')),
    is_active INTEGER DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    name TEXT NOT NULL,
    buy_price REAL NOT NULL,
    sell_price REAL NOT NULL,
    stock INTEGER NOT NULL,
    low_stock_threshold INTEGER NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    date INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    total_profit REAL NOT NULL,
    is_credit INTEGER DEFAULT 0,
    customer_name TEXT,
    customer_phone TEXT,
    due_date INTEGER,
    is_paid INTEGER DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (shop_id) REFERENCES shops(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    buy_price REAL NOT NULL,
    sell_price REAL NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id)
  );

  CREATE TABLE IF NOT EXISTS features (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    feature_key TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS licenses (
    shop_id TEXT PRIMARY KEY,
    start_date INTEGER NOT NULL,
    expiry_date INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );
`);

// Seed initial superadmin user
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
if (userCount.count === 0) {
  const shopId = 'SYSTEM';
  const adminId = uuidv4();
  const now = Date.now();
  
  db.prepare('INSERT INTO shops (id, name, updated_at) VALUES (?, ?, ?)').run(shopId, 'System Administration', now);
  
  const passHash = bcrypt.hashSync('123456', 10);
  db.prepare('INSERT INTO users (id, shop_id, email, password_hash, role, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    adminId, shopId, 'superadmin@pos.com', passHash, 'superadmin', 1, now
  );
  
  console.log('Seeded initial superadmin: email: superadmin@pos.com, password: 123456');
}
