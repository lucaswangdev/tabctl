/**
 * tabctl API client
 * All communication with localhost:7420 goes through here
 */

import type {
  Pod, Namespace, Deployment, BrowserTab,
  PodsResponse, NamespacesResponse, DeploymentsResponse,
  BatchCreateResponse, ImportBookmarksResponse, HealthResponse,
} from "./types";

const BASE = "http://localhost:7420";

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ── Health ──────────────────────────────────────────────────────────────────────
export const checkHealth = () => req("GET", "/health") as Promise<HealthResponse>;

// ── Pods ──────────────────────────────────────────────────────────────────────
export const getPods = (namespace?: string, label?: string): Promise<PodsResponse> => {
  const params = new URLSearchParams();
  if (namespace && namespace !== "all") params.set("namespace", namespace);
  if (label) params.set("label", label);
  const qs = params.toString();
  return req("GET", `/api/pods${qs ? "?" + qs : ""}`) as Promise<PodsResponse>;
};

export const getPod = (id: string) =>
  req("GET", `/api/pods/${id}`) as Promise<Pod>;

export const createPod = (pod: { name: string; url: string; namespace: string; labels?: Record<string, string> }) =>
  req("POST", "/api/pods", pod) as Promise<Pod>;

export const updatePod = (id: string, patch: Partial<Pod>) =>
  req("PUT", `/api/pods/${id}`, patch) as Promise<Pod>;

export const deletePod = (id: string) =>
  req("DELETE", `/api/pods/${id}`) as Promise<{ deleted: boolean; pod: Pod }>;

export const batchCreatePods = (pods: Array<{ name: string; url: string; namespace?: string; labels?: Record<string, string> }>, namespace: string) =>
  req("POST", "/api/pods/batch", { pods, namespace }) as Promise<BatchCreateResponse>;

// ── Deployments ────────────────────────────────────────────────────────────────
export const getDeployments = (namespace?: string): Promise<DeploymentsResponse> => {
  const params = new URLSearchParams();
  if (namespace && namespace !== "all") params.set("namespace", namespace);
  const qs = params.toString();
  return req("GET", `/api/deployments${qs ? "?" + qs : ""}`) as Promise<DeploymentsResponse>;
};

export const createDeployment = (dep: { name: string; namespace: string; selector: Record<string, string> }) =>
  req("POST", "/api/deployments", dep) as Promise<Deployment>;

export const deleteDeployment = (id: string) =>
  req("DELETE", `/api/deployments/${id}`) as Promise<{ deleted: boolean; deployment: Deployment }>;

export const getDeploymentPods = (id: string) =>
  req("GET", `/api/deployments/${id}/pods`) as Promise<{ deployment: Deployment; pods: Pod[]; total: number }>;

// ── Namespaces ─────────────────────────────────────────────────────────────────
export const getNamespaces = () =>
  req("GET", "/api/namespaces") as Promise<NamespacesResponse>;

export const createNamespace = (name: string, color?: string) =>
  req("POST", "/api/namespaces", { name, color }) as Promise<Namespace>;

export const deleteNamespace = (id: string) =>
  req("DELETE", `/api/namespaces/${id}`) as Promise<{ deleted: boolean; id: string }>;

// ── Import / Export ────────────────────────────────────────────────────────────
export const exportData = async () => {
  const res = await fetch(`${BASE}/api/export`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tabctl-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

export const importData = (data: { pods: Pod[]; deployments?: Deployment[]; namespaces?: Namespace[] }, mode: "merge" | "replace" = "merge") =>
  req("POST", "/api/import", { data, mode }) as Promise<{ mode: string; created: number; skipped: number }>;

export const importBookmarks = (htmlContent: string, defaultNs: string) =>
  req("POST", "/api/import/bookmarks", { content: htmlContent, defaultNs }) as Promise<ImportBookmarksResponse>;
