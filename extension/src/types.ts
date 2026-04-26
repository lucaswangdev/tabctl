// ─── Domain types ────────────────────────────────────────────────────────────────

export interface Pod {
  id: string;
  name: string;
  url: string;
  namespace: string;
  labels: Record<string, string>;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Namespace {
  id: string;
  label: string;
  color: string;
}

export interface Deployment {
  id: string;
  name: string;
  namespace: string;
  selector: Record<string, string>;
  createdAt?: string;
  matchingPods?: number;
}

export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
  windowId?: number;
}

// ─── API response types ─────────────────────────────────────────────────────────

export interface PodsResponse {
  items: Pod[];
  total: number;
}

export interface NamespacesResponse {
  items: Namespace[];
}

export interface DeploymentsResponse {
  items: Deployment[];
  total: number;
}

export interface BatchCreateResponse {
  created: number;
  skipped: number;
  items?: Pod[];
}

export interface ImportBookmarksResponse {
  created: number;
  skipped: number;
  createdNamespaces?: Namespace[];
}

export interface HealthResponse {
  status: "ok";
  version: string;
  db: string;
}

// ─── UI types ──────────────────────────────────────────────────────────────────

export interface Toast {
  msg: string;
  type: "ok" | "error" | "warn";
}

export type ActiveTab = "current" | "favorites";
