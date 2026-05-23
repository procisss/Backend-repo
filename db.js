// db.js — Turso (LibSQL) version
const { createClient } = require('@libsql/client');

const client = createClient({
  url:       process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});

let initialized = false;

async function getDb() {
  if (!initialized) {
    await initTables();
    initialized = true;
  }
  return client;
}

async function initTables() {
  const statements = [

    // ── Users ──
    `CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      business_name TEXT    NOT NULL,
      owner_name    TEXT,
      email         TEXT    NOT NULL UNIQUE,
      phone         TEXT,
      password_hash TEXT    NOT NULL,
      plan          TEXT    DEFAULT 'free',
      role          TEXT    DEFAULT 'user',
      status        TEXT    DEFAULT 'active',
      created_at    TEXT    DEFAULT (datetime('now'))
    )`,

    // ── Inventory ──
    `CREATE TABLE IF NOT EXISTS inventory (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      category    TEXT    NOT NULL,
      quantity    REAL    NOT NULL DEFAULT 0,
      unit        TEXT    NOT NULL DEFAULT 'pcs',
      stock_price REAL    NOT NULL DEFAULT 0,
      min_stock   REAL    NOT NULL DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now'))
    )`,

    // ── Recipes ──
    `CREATE TABLE IF NOT EXISTS recipes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      name          TEXT    NOT NULL,
      category      TEXT    NOT NULL,
      selling_price REAL    NOT NULL DEFAULT 0,
      selling_unit  TEXT    NOT NULL DEFAULT 'pcs',
      description   TEXT,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id    INTEGER NOT NULL,
      inventory_id INTEGER,
      name         TEXT    NOT NULL,
      quantity     REAL    NOT NULL DEFAULT 0,
      unit         TEXT    NOT NULL DEFAULT 'pcs'
    )`,

    // ── Orders (POS) ──
    `CREATE TABLE IF NOT EXISTS orders (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL,
      total          REAL    NOT NULL DEFAULT 0,
      payment_method TEXT    NOT NULL DEFAULT 'Cash',
      amount_paid    REAL    DEFAULT 0,
      change_given   REAL    DEFAULT 0,
      status         TEXT    DEFAULT 'completed',
      created_at     TEXT    DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS order_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   INTEGER NOT NULL,
      recipe_id  INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      quantity   INTEGER NOT NULL DEFAULT 1,
      unit_price REAL    NOT NULL DEFAULT 0,
      subtotal   REAL    NOT NULL DEFAULT 0
    )`,

    // ── Suppliers (kept for compatibility) ──
    `CREATE TABLE IF NOT EXISTS suppliers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      contact    TEXT,
      phone      TEXT,
      email      TEXT,
      address    TEXT,
      created_at TEXT    DEFAULT (datetime('now'))
    )`,

    // ── Old purchases (kept for compatibility) ──
    `CREATE TABLE IF NOT EXISTS purchases (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      supplier_name TEXT    NOT NULL,
      supplier_id   INTEGER,
      status        TEXT    DEFAULT 'pending',
      notes         TEXT,
      total         REAL    DEFAULT 0,
      created_at    TEXT    DEFAULT (datetime('now')),
      received_at   TEXT,
      stocked_at    TEXT
    )`,

    `CREATE TABLE IF NOT EXISTS purchase_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id  INTEGER NOT NULL,
      inventory_id INTEGER,
      name         TEXT    NOT NULL,
      quantity     REAL    NOT NULL DEFAULT 0,
      unit         TEXT    NOT NULL DEFAULT 'pcs',
      unit_price   REAL    NOT NULL DEFAULT 0,
      subtotal     REAL    NOT NULL DEFAULT 0
    )`,

    // ── Restock Purchases (new simplified system) ──
    `CREATE TABLE IF NOT EXISTS restock_purchases (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      notes      TEXT    DEFAULT '',
      total_cost REAL    NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS restock_items (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      restock_purchase_id INTEGER NOT NULL,
      inventory_id        INTEGER,
      name                TEXT    NOT NULL,
      quantity            REAL    NOT NULL DEFAULT 0,
      unit                TEXT    NOT NULL DEFAULT 'pcs',
      total_cost          REAL    NOT NULL DEFAULT 0,
      created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
    )`,

    // ── Subscriptions ──
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL UNIQUE,
      plan          TEXT    NOT NULL DEFAULT 'free',
      billing_cycle TEXT    DEFAULT 'monthly',
      started_at    TEXT,
      expires_at    TEXT,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    )`,

    // ── Upgrade Requests ──
    `CREATE TABLE IF NOT EXISTS upgrade_requests (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      billing_cycle TEXT    NOT NULL DEFAULT 'monthly',
      gcash_ref     TEXT,
      gcash_number  TEXT,
      gcash_name    TEXT,
      status        TEXT    NOT NULL DEFAULT 'pending',
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    )`,

    // ── Alerts ──
    `CREATE TABLE IF NOT EXISTS alerts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      type        TEXT    NOT NULL DEFAULT 'manual',
      title       TEXT    NOT NULL,
      message     TEXT,
      severity    TEXT    NOT NULL DEFAULT 'warning',
      status      TEXT    NOT NULL DEFAULT 'active',
      created_at  TEXT    DEFAULT (datetime('now')),
      resolved_at TEXT
    )`,
  ];

  for (const sql of statements) {
    await client.execute(sql);
  }

  console.log('✅  Turso database ready');
}

module.exports = getDb;