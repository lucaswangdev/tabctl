/**
 * tabctl SQLite database layer
 * Replaces data.json with a proper SQLite database
 */

import Database, { Database as DatabaseType } from "better-sqlite3";
import path from "path";

const DB_FILE = process.env.TABCTL_DB
  ? path.resolve(process.env.TABCTL_DB)
  : path.join(__dirname, "tabctl.db");

let db: DatabaseType;

export interface Pod {
  id: string;
  name: string;
  url: string;
  namespace: string;
  labels: Record<string, string>;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Deployment {
  id: string;
  name: string;
  namespace: string;
  selector: Record<string, string>;
  created_at?: string;
}

export interface Namespace {
  id: string;
  label: string;
  color: string | null;
  created_at?: string;
}

export interface ListPodsOptions {
  namespace?: string;
  label?: string;
  selector?: Record<string, string>;
}

function getDb(): DatabaseType {
  if (!db) {
    db = new Database(DB_FILE);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS namespaces (
      id          TEXT PRIMARY KEY,
      label       TEXT NOT NULL,
      color       TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pods (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      url         TEXT NOT NULL,
      namespace   TEXT NOT NULL DEFAULT 'work',
      labels      TEXT DEFAULT '{}',
      status      TEXT DEFAULT 'Saved',
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT,
      FOREIGN KEY (namespace) REFERENCES namespaces(id)
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      namespace   TEXT NOT NULL,
      selector    TEXT DEFAULT '{}',
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (namespace) REFERENCES namespaces(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pods_namespace ON pods(namespace);
    CREATE INDEX IF NOT EXISTS idx_pods_url ON pods(url);
    CREATE INDEX IF NOT EXISTS idx_deployments_namespace ON deployments(namespace);
  `);
}

// ── Pods ───────────────────────────────────────────────────────────────────────
export function listPods(opts: ListPodsOptions = {}): Pod[] {
  const { namespace, label } = opts;
  const database = getDb();
  let sql = "SELECT * FROM pods WHERE 1=1";
  const params: Record<string, string> = {};

  if (namespace && namespace !== "all") {
    sql += " AND namespace = @namespace";
    params.namespace = namespace;
  }

  if (label) {
    const sel = parseSelector(label);
    for (const [k, v] of Object.entries(sel)) {
      sql += ` AND json_extract(labels, '$.${k}') = @label_${k}`;
      params[`label_${k}`] = v;
    }
  }

  sql += " ORDER BY created_at DESC";
  const rows = database.prepare(sql).all(params) as Array<Omit<Pod, "labels"> & { labels: string }>;
  return rows.map(r => ({ ...r, labels: JSON.parse(r.labels || "{}") }));
}

export function getPod(id: string): Pod | null {
  const row = getDb().prepare("SELECT * FROM pods WHERE id = ?").get(id) as Omit<Pod, "labels"> & { labels: string } | undefined;
  if (!row) return null;
  return { ...row, labels: JSON.parse(row.labels || "{}") };
}

export function createPod(pod: {
  id: string;
  name?: string;
  url?: string;
  namespace?: string;
  labels?: Record<string, string>;
  status?: string;
  createdAt?: string;
}): Pod {
  const database = getDb();
  database.prepare(`
    INSERT INTO pods (id, name, url, namespace, labels, status, created_at)
    VALUES (@id, @name, @url, @namespace, @labels, @status, @created_at)
  `).run({
    id: pod.id,
    name: pod.name,
    url: pod.url,
    namespace: pod.namespace,
    labels: JSON.stringify(pod.labels || {}),
    status: pod.status || "Saved",
    created_at: pod.createdAt || new Date().toISOString(),
  });
  return getPod(pod.id)!;
}

export function updatePod(id: string, patch: {
  name?: string;
  url?: string;
  namespace?: string;
  labels?: Record<string, string>;
  status?: string;
}): Pod | null {
  const database = getDb();
  const updates: string[] = [];
  const params: Record<string, string> = { id };

  if (patch.name !== undefined) { updates.push("name = @name"); params.name = patch.name; }
  if (patch.url !== undefined) { updates.push("url = @url"); params.url = patch.url; }
  if (patch.namespace !== undefined) { updates.push("namespace = @namespace"); params.namespace = patch.namespace; }
  if (patch.labels !== undefined) { updates.push("labels = @labels"); params.labels = JSON.stringify(patch.labels); }
  if (patch.status !== undefined) { updates.push("status = @status"); params.status = patch.status; }

  if (updates.length === 0) return getPod(id);
  updates.push("updated_at = datetime('now')");

  database.prepare(`UPDATE pods SET ${updates.join(", ")} WHERE id = @id`).run(params);
  return getPod(id);
}

export function deletePod(id: string): void {
  getDb().prepare("DELETE FROM pods WHERE id = ?").run(id);
}

export function upsertPod(pod: {
  id: string;
  name: string;
  url: string;
  namespace: string;
  labels?: Record<string, string>;
  status?: string;
  createdAt?: string;
}): { id: string; skipped: boolean } {
  const existing = getDb().prepare("SELECT id FROM pods WHERE url = ? AND namespace = ?").get(pod.url, pod.namespace) as { id: string } | undefined;
  if (existing) return { id: existing.id, skipped: true };
  createPod(pod);
  return { id: pod.id, skipped: false };
}

// ── Deployments ────────────────────────────────────────────────────────────────
export function listDeployments(opts: { namespace?: string } = {}): Deployment[] {
  const { namespace } = opts;
  const database = getDb();

  if (namespace && namespace !== "all") {
    return database.prepare("SELECT * FROM deployments WHERE namespace = ? ORDER BY created_at DESC").all(namespace) as Deployment[];
  }
  return database.prepare("SELECT * FROM deployments ORDER BY created_at DESC").all() as Deployment[];
}

export function createDeployment(dep: {
  id: string;
  name?: string;
  namespace?: string;
  selector?: Record<string, string>;
  createdAt?: string;
}): Deployment {
  const database = getDb();
  database.prepare(`
    INSERT INTO deployments (id, name, namespace, selector, created_at)
    VALUES (@id, @name, @namespace, @selector, @created_at)
  `).run({
    id: dep.id,
    name: dep.name,
    namespace: dep.namespace,
    selector: JSON.stringify(dep.selector || {}),
    created_at: dep.createdAt || new Date().toISOString(),
  });
  return database.prepare("SELECT * FROM deployments WHERE id = ?").get(dep.id) as Deployment;
}

export function deleteDeployment(id: string): void {
  getDb().prepare("DELETE FROM deployments WHERE id = ?").run(id);
}

export function getDeploymentPods(deploymentId: string): Pod[] {
  const database = getDb();
  const dep = database.prepare("SELECT * FROM deployments WHERE id = ?").get(deploymentId) as Omit<Deployment, "selector"> & { selector: string } | undefined;
  if (!dep) return [];
  const selector = JSON.parse(dep.selector || "{}");
  return listPods({ namespace: dep.namespace, selector });
}

// ── Namespaces ────────────────────────────────────────────────────────────────
export function listNamespaces(): Namespace[] {
  return getDb().prepare("SELECT * FROM namespaces ORDER BY created_at ASC").all() as Namespace[];
}

export function createNamespace(ns: { id: string; label: string; color?: string }): Namespace {
  const database = getDb();
  database.prepare("INSERT OR IGNORE INTO namespaces (id, label, color) VALUES (?, ?, ?)").run(ns.id, ns.label, ns.color || null);
  return database.prepare("SELECT * FROM namespaces WHERE id = ?").get(ns.id) as Namespace;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseSelector(str: string): Record<string, string> {
  const sel: Record<string, string> = {};
  str.split(/[\s,]+/).forEach(pair => {
    const [k, v] = pair.split("=");
    if (k && v) sel[k.trim()] = v.trim();
  });
  return sel;
}

export function getDbInstance(): DatabaseType {
  return getDb();
}

// ── Migration from data.json ───────────────────────────────────────────────────
import fs from "fs";

const DATA_FILE = process.env.TABCTL_DATA
  ? path.resolve(process.env.TABCTL_DATA)
  : path.join(__dirname, "data.json");

export function migrateFromJson(): void {
  if (!fs.existsSync(DATA_FILE)) return;

  const database = getDb();
  const count = database.prepare("SELECT COUNT(*) as c FROM namespaces").get() as { c: number };
  if (count.c > 0) {
    console.log("✅ SQLite already initialized, skipping migration");
    return;
  }

  const json = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  database.pragma("foreign_keys = OFF");

  try {
    const nsStmt = database.prepare("INSERT OR IGNORE INTO namespaces (id, label, color) VALUES (?, ?, ?)");
    for (const ns of json.namespaces || []) {
      nsStmt.run(ns.id, ns.label, ns.color || null);
    }

    const podStmt = database.prepare(`
      INSERT OR IGNORE INTO pods (id, name, url, namespace, labels, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const p of json.pods || []) {
      podStmt.run(p.id, p.name, p.url, p.namespace, JSON.stringify(p.labels || {}), p.status || "Saved", p.createdAt);
    }

    const depStmt = database.prepare(`
      INSERT OR IGNORE INTO deployments (id, name, namespace, selector, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const d of json.deployments || []) {
      depStmt.run(d.id, d.name, d.namespace, JSON.stringify(d.selector || {}), d.createdAt);
    }

    const backupFile = DATA_FILE + ".bak";
    fs.writeFileSync(backupFile, JSON.stringify(json, null, 2));
    console.log(`✅ Migrated data.json → SQLite (backup: ${backupFile})`);
  } finally {
    database.pragma("foreign_keys = ON");
  }
}
