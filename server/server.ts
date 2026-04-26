/**
 * tabctl-server
 * Local REST API server — uses SQLite database
 * All tab CRUD goes through here.
 */

import express, { Request, Response } from "express";
import cors from "cors";

import {
  listPods, getPod, createPod, updatePod, deletePod, upsertPod,
  listDeployments, createDeployment, deleteDeployment, getDeploymentPods,
  listNamespaces, createNamespace,
  migrateFromJson,
  getDbInstance,
} from "./db";

const app = express();
const PORT = 7420;

// ─── Built-in namespaces (not stored in DB) ────────────────────────────────────
const BUILT_IN_NS = [
  { id: "work",     label: "work" },
  { id: "research", label: "research" },
  { id: "personal", label: "personal" },
  { id: "ops",      label: "ops" },
];

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid(): string {
  return "pod-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalizeUrl(url: string): string {
  if (!url) return url;
  return url.startsWith("http") ? url : "https://" + url;
}

function urlToName(url: string): string {
  try {
    return new URL(normalizeUrl(url)).hostname.replace("www.", "").split(".")[0];
  } catch {
    return url;
  }
}

function autoColor(index: number): string {
  const colors = ["#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#06b6d4","#ec4899","#84cc16"];
  return colors[index % colors.length];
}

interface PodLabels {
  labels?: Record<string, string>;
}

function matchesSelector(pod: PodLabels, selector: Record<string, string>): boolean {
  return Object.entries(selector).every(([k, v]) => pod.labels?.[k] === v);
}

function parseSelector(str: string): Record<string, string> {
  const sel: Record<string, string> = {};
  str.split(/[\s,]+/).forEach((pair) => {
    const [k, v] = pair.split("=");
    if (k && v) sel[k.trim()] = v.trim();
  });
  return sel;
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", version: "1.0.0", db: "SQLite" });
});

// ─── PODS ──────────────────────────────────────────────────────────────────────

// GET /api/pods
app.get("/api/pods", (req: Request, res: Response) => {
  const namespace = req.query.namespace as string | undefined;
  const label = req.query.label as string | undefined;
  const pods = listPods({ namespace, label });
  res.json({ items: pods, total: pods.length });
});

// GET /api/pods/:id
app.get("/api/pods/:id", (req: Request, res: Response) => {
  const pod = getPod((req.params.id as string));
  if (!pod) return res.status(404).json({ error: `Pod "${(req.params.id as string)}" not found` });
  res.json(pod);
});

// POST /api/pods
app.post("/api/pods", (req: Request, res: Response) => {
  const { name, url, namespace, labels } = req.body;
  if (!name || !url || !namespace) {
    return res.status(400).json({ error: "name, url, namespace are required" });
  }

  const existing = listPods({ namespace }).find(p => p.name === name);
  if (existing) {
    return res.status(409).json({ error: `Pod "${name}" already exists in namespace "${namespace}"` });
  }

  const pod = createPod({
    id: uid(),
    name,
    url: normalizeUrl(url),
    namespace,
    labels: labels || {},
    createdAt: new Date().toISOString(),
    status: "Saved",
  });

  console.log(`✅ Created pod: ${pod.name} [${pod.namespace}]`);
  res.status(201).json(pod);
});

// PUT /api/pods/:id
app.put("/api/pods/:id", (req: Request, res: Response) => {
  const existing = getPod((req.params.id as string));
  if (!existing) return res.status(404).json({ error: `Pod "${(req.params.id as string)}" not found` });

  const patch: {
    name?: string;
    url?: string;
    namespace?: string;
    labels?: Record<string, string>;
    status?: string;
  } = {};
  const { name, url, namespace, labels, status } = req.body;
  if (name !== undefined) patch.name = name;
  if (url !== undefined) patch.url = normalizeUrl(url);
  if (namespace !== undefined) patch.namespace = namespace;
  if (labels !== undefined) patch.labels = { ...existing.labels, ...labels };
  if (status !== undefined) patch.status = status;

  const pod = updatePod((req.params.id as string), patch);
  console.log(`✏️  Updated pod: ${pod?.name}`);
  res.json(pod);
});

// DELETE /api/pods/:id
app.delete("/api/pods/:id", (req: Request, res: Response) => {
  const pod = getPod((req.params.id as string));
  if (!pod) return res.status(404).json({ error: `Pod "${(req.params.id as string)}" not found` });
  deletePod((req.params.id as string));
  console.log(`🗑️  Deleted pod: ${pod.name}`);
  res.json({ deleted: true, pod });
});

// POST /api/pods/batch
app.post("/api/pods/batch", (req: Request, res: Response) => {
  const { pods: incoming, namespace = "work" } = req.body as {
    pods?: Array<{ name?: string; url: string; namespace?: string; labels?: Record<string, string> }>;
    namespace?: string;
  };
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: "pods must be an array" });
  }

  const created: ReturnType<typeof createPod>[] = [];
  const skipped: string[] = [];

  for (const item of incoming) {
    const pod = {
      id: uid(),
      name: item.name || urlToName(item.url),
      url: normalizeUrl(item.url),
      namespace: item.namespace || namespace,
      labels: item.labels || {},
      createdAt: new Date().toISOString(),
      status: "Saved" as const,
    };
    upsertPod(pod);
    created.push(createPod(pod));
  }

  console.log(`📦 Batch: created ${created.length}, skipped ${skipped.length}`);
  res.status(201).json({ created: created.length, skipped: skipped.length, items: created });
});

// ─── DEPLOYMENTS ────────────────────────────────────────────────────────────────

// GET /api/deployments
app.get("/api/deployments", (req: Request, res: Response) => {
  const { namespace } = req.query;
  const deployments = listDeployments({ namespace: namespace as string | undefined });

  const annotated = deployments.map(d => ({
    ...d,
    selector: typeof d.selector === "string" ? JSON.parse(d.selector) : d.selector,
    matchingPods: listPods({ namespace: d.namespace }).filter(
      p => matchesSelector(p, d.selector)
    ).length,
  }));

  res.json({ items: annotated, total: annotated.length });
});

// POST /api/deployments
app.post("/api/deployments", (req: Request, res: Response) => {
  const { name, namespace, selector } = req.body;
  if (!name || !namespace || !selector) {
    return res.status(400).json({ error: "name, namespace, selector are required" });
  }

  const dep = createDeployment({
    id: "dep-" + Date.now().toString(36),
    name,
    namespace,
    selector,
    createdAt: new Date().toISOString(),
  });

  console.log(`🚀 Created deployment: ${dep.name}`);
  res.status(201).json({ ...dep, selector });
});

// DELETE /api/deployments/:id
app.delete("/api/deployments/:id", (req: Request, res: Response) => {
  const deps = listDeployments();
  const dep = deps.find(d => d.id === (req.params.id as string));
  if (!dep) return res.status(404).json({ error: "Deployment not found" });
  deleteDeployment((req.params.id as string));
  console.log(`🗑️  Deleted deployment: ${dep.name}`);
  res.json({ deleted: true, deployment: dep });
});

// GET /api/deployments/:id/pods
app.get("/api/deployments/:id/pods", (req: Request, res: Response) => {
  const deps = listDeployments();
  const dep = deps.find(d => d.id === (req.params.id as string));
  if (!dep) return res.status(404).json({ error: "Deployment not found" });
  const pods = getDeploymentPods((req.params.id as string));
  res.json({ deployment: dep, pods, total: pods.length });
});

// ─── NAMESPACES ────────────────────────────────────────────────────────────────

// GET /api/namespaces — custom namespaces from DB (built-ins are hardcoded client-side)
app.get("/api/namespaces", (_req: Request, res: Response) => {
  res.json({ items: listNamespaces() });
});

// POST /api/namespaces — create a new namespace
app.post("/api/namespaces", (req: Request, res: Response) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });

  const id = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
  if (BUILT_IN_NS.find(n => n.id === id)) {
    return res.status(409).json({ error: `"${name}" is a reserved name` });
  }

  const ns = createNamespace({ id, label: name, color: color || autoColor(listNamespaces().length) });
  console.log(`📁 Created namespace: ${ns.label}`);
  res.status(201).json(ns);
});

// ─── IMPORT / EXPORT ───────────────────────────────────────────────────────────

// GET /api/export — export full data as JSON
app.get("/api/export", (_req: Request, res: Response) => {
  const data = {
    apiVersion: "tabctl/v1",
    updatedAt: new Date().toISOString(),
    pods: listPods(),
    deployments: listDeployments(),
    namespaces: listNamespaces(),
  };
  res.setHeader("Content-Disposition", `attachment; filename="tabctl-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.setHeader("Content-Type", "application/json");
  res.json(data);
});

// POST /api/import/bookmarks — import Chrome bookmarks HTML
app.post("/api/import/bookmarks", (req: Request, res: Response) => {
  const { content, defaultNs = "work" } = req.body as { content?: string; defaultNs?: string };
  if (!content) return res.status(400).json({ error: "content is required" });

  const entries = parseChromeBookmarks(content);
  if (entries.length === 0) {
    return res.json({ created: 0, skipped: 0, createdNamespaces: [], message: "No bookmarks found" });
  }

  const created: ReturnType<typeof createPod>[] = [];
  const skipped: string[] = [];
  const createdNamespaces: Array<{ id: string; label: string }> = [];

  const folderNames = [...new Set(entries.map(e => e.folder).filter(Boolean))];
  const existingNs = listNamespaces();
  const allNsLabels = [...BUILT_IN_NS, ...existingNs].map(n => n.label);

  for (const folder of folderNames) {
    const nsId = folder.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
    if (!existingNs.find(n => n.id === nsId) && !BUILT_IN_NS.find(n => n.id === nsId)) {
      const ns = createNamespace({ id: nsId, label: folder, color: autoColor(existingNs.length + createdNamespaces.length) });
      createdNamespaces.push({ id: nsId, label: folder });
    }
  }

  const updatedNs = listNamespaces();
  const allNsMap = [...BUILT_IN_NS, ...updatedNs];

  const nsMap: Record<string, typeof entries> = {};
  for (const e of entries) {
    const matched = allNsMap.find(n => n.label === e.folder || n.id === e.folder)?.id || defaultNs;
    if (!nsMap[matched]) nsMap[matched] = [];
    nsMap[matched].push(e);
  }

  for (const [ns, items] of Object.entries(nsMap)) {
    for (const item of items) {
      const result = upsertPod({
        id: uid(),
        name: item.name,
        url: normalizeUrl(item.url),
        namespace: ns,
        labels: {},
        createdAt: new Date().toISOString(),
        status: "Saved",
      });
      if (result && result.id) {
        created.push(createPod({ ...result, name: item.name, url: normalizeUrl(item.url), namespace: ns, labels: {}, status: "Saved", createdAt: new Date().toISOString() }));
      } else {
        skipped.push(item.url);
      }
    }
  }

  console.log(`📥 Bookmarks: created ${created.length}, skipped ${skipped.length}, namespaces ${createdNamespaces.length}`);
  res.json({ created: created.length, skipped: skipped.length, createdNamespaces });
});

// POST /api/import — import tabctl JSON
app.post("/api/import", (req: Request, res: Response) => {
  const { data: incoming, mode = "merge" } = req.body as {
    data?: {
      pods?: Array<{ id?: string; name?: string; url?: string; namespace?: string; labels?: Record<string, string>; createdAt?: string; status?: string }>;
      deployments?: Array<{ id?: string; name?: string; namespace?: string; selector?: Record<string, string>; createdAt?: string }>;
      namespaces?: Array<{ id: string; label: string; color?: string }>;
    };
    mode?: string;
  };
  if (!incoming || !Array.isArray(incoming.pods)) {
    return res.status(400).json({ error: "Invalid tabctl JSON format" });
  }

  let created = 0, skipped = 0;

  if (mode === "replace") {
    const db = getDbInstance();
    db.exec("DELETE FROM pods; DELETE FROM deployments; DELETE FROM namespaces;");
    for (const pod of incoming.pods || []) {
      createPod({ ...pod, id: pod.id || uid(), createdAt: pod.createdAt || new Date().toISOString() });
      created++;
    }
    for (const dep of incoming.deployments || []) {
      createDeployment({ ...dep, id: dep.id || "dep-" + Date.now().toString(36), createdAt: dep.createdAt || new Date().toISOString() });
    }
    for (const ns of incoming.namespaces || []) {
      createNamespace(ns);
    }
    return res.json({ mode: "replace", pods: created, deployments: (incoming.deployments || []).length });
  }

  // merge mode
  for (const pod of incoming.pods || []) {
    const existing = listPods().find(p => p.url === pod.url && p.namespace === pod.namespace);
    if (existing) { skipped++; continue; }
    createPod({ ...pod, id: pod.id || uid(), createdAt: pod.createdAt || new Date().toISOString() });
    created++;
  }
  for (const dep of incoming.deployments || []) {
    const existing = listDeployments().find(d => d.name === dep.name && d.namespace === dep.namespace);
    if (!existing) createDeployment({ ...dep, id: dep.id || "dep-" + Date.now().toString(36), createdAt: dep.createdAt || new Date().toISOString() });
  }

  console.log(`📥 Import (merge): created ${created}, skipped ${skipped}`);
  res.json({ mode: "merge", created, skipped });
});

// ─── Bookmark parsing helpers ──────────────────────────────────────────────────
interface BookmarkEntry {
  url: string;
  name: string;
  folder: string;
}

function parseChromeBookmarks(html: string): BookmarkEntry[] {
  const folderPositions: Array<{ name: string; pos: number }> = [];
  const folderRegex = /<H3[^>]*>([^<]+)<\/H3>/gi;
  let m: RegExpExecArray | null;

  while ((m = folderRegex.exec(html)) !== null) {
    folderPositions.push({ name: m[1].trim(), pos: m.index });
  }

  const entries: BookmarkEntry[] = [];
  const linkRegex = /<A HREF="([^"]+)"[^>]*>([^<]+)<\/A>/gi;

  while ((m = linkRegex.exec(html)) !== null) {
    const url = m[1];
    const name = decodeHtmlEntities(m[2].trim());
    if (!url || !name || !url.startsWith("http")) continue;

    let folder = "";
    for (let i = folderPositions.length - 1; i >= 0; i--) {
      if (folderPositions[i].pos < m.index) {
        folder = folderPositions[i].name;
        break;
      }
    }
    entries.push({ url, name, folder });
  }
  return entries;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  migrateFromJson();

  console.log(`
  ⎈  tabctl-server running
  ─────────────────────────────
  URL  : http://localhost:${PORT}
  DB   : SQLite (tabctl.db)
  ─────────────────────────────
  GET  /health
  GET  /api/pods
  POST /api/pods
  PUT  /api/pods/:id
  DEL  /api/pods/:id
  POST /api/pods/batch
  GET  /api/deployments
  POST /api/deployments
  DEL  /api/deployments/:id
  GET  /api/namespaces
  POST /api/namespaces
  GET  /api/export
  POST /api/import
  POST /api/import/bookmarks
  `);
});
