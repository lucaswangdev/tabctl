import { useState, useEffect, useRef, useMemo } from "react";
import * as api from "./api";
import type {
  Pod, Namespace, BrowserTab,
  ActiveTab, Toast,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────
const BUILT_IN_NAMESPACES: Namespace[] = [
  { id: "work",     label: "work",     color: "#3b82f6" },
  { id: "research", label: "research", color: "#8b5cf6" },
  { id: "personal", label: "personal", color: "#10b981" },
  { id: "ops",      label: "ops",      color: "#f59e0b" },
];

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace("www.", ""); }
  catch { return url; }
}

function sendToBg(msg: { type: string; [key: string]: unknown }) {
  return new Promise<unknown>(resolve => {
    if (typeof chrome !== "undefined" && chrome.runtime) {
      chrome.runtime.sendMessage(msg, resolve as chrome.runtime.MessageSender);
    } else resolve(null);
  });
}

function closeCurrentWindowTabs() {
  return new Promise<{ closed: number }>(resolve => {
    if (typeof chrome !== "undefined" && chrome.runtime) {
      chrome.runtime.sendMessage({ type: "CLOSE_CURRENT_WINDOW_TABS" }, resolve as chrome.runtime.MessageSender);
    } else resolve({ closed: 0 });
  });
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("current");
  const [currentTabs, setCurrentTabs] = useState<BrowserTab[]>([]);
  const [pods, setPods] = useState<Pod[]>([]);
  const [customNamespaces, setCustomNamespaces] = useState<Namespace[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(BUILT_IN_NAMESPACES.map(n => n.id))
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);

  const NAMESPACES = useMemo(() => [...BUILT_IN_NAMESPACES, ...customNamespaces], [customNamespaces]);

  // Keep expandedGroups in sync with customNamespaces
  useEffect(() => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      customNamespaces.forEach(n => next.add(n.id));
      return next;
    });
  }, [customNamespaces]);

  // modals
  const [addToGroupOpen, setAddToGroupOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [addToGroupUrl, setAddToGroupUrl] = useState("");
  const [addToGroupName, setAddToGroupName] = useState("");
  const [addToGroupNs, setAddToGroupNs] = useState("work");
  const [newGroupName, setNewGroupName] = useState("");
  const [importBookmarksOpen, setImportBookmarksOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importNs, setImportNs] = useState("work");

  // search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BrowserTab[]>([]);
  const [searchQueryFav, setSearchQueryFav] = useState("");
  const [searchResultsFav, setSearchResultsFav] = useState<Pod[]>([]);

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadPodsRef = useRef<(() => Promise<void>) | null>(null);
  const loadTabsRef = useRef<(() => Promise<void>) | null>(null);

  const loadPods = async () => {
    try {
      const [nsResult, podsResult] = await Promise.all([
        api.getNamespaces(),
        api.getPods(),
      ]);
      setPods(podsResult.items || []);
      setCustomNamespaces(nsResult.items || []);
    } catch (e) {
      showToast("Server error: " + (e as Error).message, "error");
    }
  };

  const loadTabs = async () => {
    const tabs = await sendToBg({ type: "GET_CURRENT_TABS" }) as BrowserTab[];
    setCurrentTabs(tabs || []);
  };

  useEffect(() => {
    loadPodsRef.current = loadPods;
    loadTabsRef.current = loadTabs;
  });

  useEffect(() => {
    api.checkHealth()
      .then(() => {
        setServerOk(true);
        loadPodsRef.current?.();
      })
      .catch(() => setServerOk(false));
  }, []);

  useEffect(() => {
    if (serverOk !== true) return;
    if (activeTab === "current") loadTabsRef.current?.();
    if (activeTab === "favorites") loadPodsRef.current?.();
  }, [activeTab, serverOk]);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const showToast = (msg: string, type: Toast["type"] = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Tab1 ────────────────────────────────────────────────────────────────────
  const openTab = (url: string) => {
    sendToBg({ type: "OPEN_URLS", urls: [url] });
  };

  const openAllCurrentTabs = () => {
    if (currentTabs.length === 0) { showToast("No tabs to open", "warn"); return; }
    sendToBg({ type: "OPEN_URLS", urls: currentTabs.map(t => t.url) });
    showToast(`▶ Opened ${currentTabs.length} tabs`);
  };

  const closeAllCurrentTabs = async () => {
    const res = await closeCurrentWindowTabs();
    showToast(`✕ Closed ${res.closed} tabs`);
    loadTabsRef.current?.();
  };

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    const lower = q.toLowerCase();
    setSearchResults(
      currentTabs.filter(t =>
        (t.title || "").toLowerCase().includes(lower) ||
        (t.url || "").toLowerCase().includes(lower)
      ).slice(0, 8)
    );
  };

  // ── Tab2 ────────────────────────────────────────────────────────────────────
  const podsByNs = (nsId: string) => pods.filter(p => p.namespace === nsId);

  const toggleGroup = (nsId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(nsId) ? next.delete(nsId) : next.add(nsId);
      return next;
    });
  };

  const openGroup = async (nsId: string) => {
    const groupPods = podsByNs(nsId);
    if (groupPods.length === 0) { showToast(`No links in ${nsId}`, "warn"); return; }
    sendToBg({ type: "OPEN_URLS", urls: groupPods.map(p => p.url) });
    showToast(`▶ Opened ${groupPods.length} tabs in ${nsId}`);
  };

  const closeAllGroupTabs = async () => {
    const res = await closeCurrentWindowTabs();
    showToast(`✕ Closed ${res.closed} tabs`);
    loadTabsRef.current?.();
  };

  const expandAllGroups = () => {
    const allExpanded = expandedGroups.size === NAMESPACES.length;
    if (allExpanded) {
      setExpandedGroups(new Set());
    } else {
      setExpandedGroups(new Set(NAMESPACES.map(n => n.id)));
    }
  };

  const handleDeletePod = async (pod: Pod) => {
    try {
      await api.deletePod(pod.id);
      await loadPods();
      showToast(`Deleted ${pod.name}`);
    } catch (e) { showToast((e as Error).message, "error"); }
  };

  const handleDeleteGroup = async (nsId: string) => {
    try {
      await Promise.all(podsByNs(nsId).map(p => api.deletePod(p.id)));
      await api.deleteNamespace(nsId);
      await loadPods();
      showToast(`Deleted group ${nsId}`);
    } catch (e) { showToast((e as Error).message, "error"); }
  };

  const handleAddToGroup = async () => {
    if (!addToGroupUrl || !addToGroupName) return;
    try {
      await api.createPod({ name: addToGroupName, url: addToGroupUrl, namespace: addToGroupNs, labels: {} });
      setAddToGroupOpen(false);
      setAddToGroupUrl("");
      setAddToGroupName("");
      await loadPods();
      showToast(`Added to ${addToGroupNs}`);
    } catch (e) { showToast((e as Error).message, "error"); }
  };

  const handleNewGroup = async () => {
    if (!newGroupName) return;
    try {
      const ns = await api.createNamespace(newGroupName);
      setNewGroupOpen(false);
      setNewGroupName("");
      setCustomNamespaces(prev => [...prev, ns]);
      setExpandedGroups(prev => new Set([...prev, ns.id]));
      showToast(`Created group: ${newGroupName}`);
    } catch (e) { showToast((e as Error).message, "error"); }
  };

  const handleImportBookmarks = async () => {
    if (!importFile) return;
    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(importFile);
      });
      const res = await api.importBookmarks(content, importNs);
      setImportBookmarksOpen(false);
      setImportFile(null);
      await loadPods();
      let msg = `Imported ${res.created} bookmarks (${res.skipped} skipped)`;
      if (res.createdNamespaces?.length) {
        msg += `, created ${res.createdNamespaces.length} groups`;
      }
      showToast(msg);
    } catch (e) { showToast("Import failed: " + (e as Error).message, "error"); }
  };

  const handleSearchFav = (q: string) => {
    setSearchQueryFav(q);
    if (!q.trim()) { setSearchResultsFav([]); return; }
    const lower = q.toLowerCase();
    setSearchResultsFav(
      pods.filter(p =>
        (p.name || "").toLowerCase().includes(lower) ||
        (p.url || "").toLowerCase().includes(lower)
      ).slice(0, 8)
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (serverOk === false) {
    return (
      <div style={{ fontFamily: "JetBrains Mono, monospace", background: "#080c12", color: "#a8c0d6", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 32 }}>
        <div style={{ fontSize: 32 }}>⎈</div>
        <div style={{ color: "#ef4444", fontWeight: 700 }}>tabctl-server not reachable</div>
        <div style={{ fontSize: 12, color: "#475569", textAlign: "center" }}>
          cd tabctl/server && npm run dev
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'JetBrains Mono', monospace", background: "#080c12", color: "#a8c0d6", height: "560px", display: "flex", flexDirection: "column", fontSize: 12, overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #1e3a5f55; border-radius: 99px; }
        input, button, select { font-family: inherit; font-size: inherit; outline: none; }
        .row { transition: background 0.1s; cursor: pointer; }
        .row:hover { background: #0d1623 !important; }
        .btn { transition: all 0.12s; border: none; cursor: pointer; font-size: unset; }
        .btn:hover { opacity: 0.8; }
        .chevron { transition: transform 0.15s; display: inline-block; }
      `}</style>

      {/* ── Tab bar ── */}
      <div style={{ background: "#050810", borderBottom: "1px solid #0e1f35", padding: "0 16px", display: "flex", alignItems: "center", gap: 0, height: 40, flexShrink: 0 }}>
        <div onClick={() => setActiveTab("current")} style={{
          padding: "0 14px", height: 40, display: "flex", alignItems: "center", gap: 6,
          borderBottom: activeTab === "current" ? "2px solid #3b82f6" : "2px solid transparent",
          color: activeTab === "current" ? "#60a5fa" : "#4b6880", cursor: "pointer", fontSize: 11,
          fontWeight: activeTab === "current" ? 600 : 400,
        }}>
          窗口 tabs ({currentTabs.length})
        </div>
        <div onClick={() => setActiveTab("favorites")} style={{
          padding: "0 14px", height: 40, display: "flex", alignItems: "center", gap: 6,
          borderBottom: activeTab === "favorites" ? "2px solid #8b5cf6" : "2px solid transparent",
          color: activeTab === "favorites" ? "#a78bfa" : "#4b6880", cursor: "pointer", fontSize: 11,
          fontWeight: activeTab === "favorites" ? 600 : 400,
        }}>
          收藏夹 ({pods.length})
        </div>
        <div style={{ flex: 1 }} />

        {/* Tab1 actions */}
        {activeTab === "current" && (
          <>
            <input
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              onBlur={() => setTimeout(() => setSearchResults([]), 150)}
              placeholder="search..."
              style={{ padding: "3px 8px", background: "#0a1018", border: "1px solid #0e1f35", borderRadius: 4, color: "#60a5fa", fontSize: 11, width: 120 }}
            />
            {currentTabs.length > 0 && (
              <button className="btn" onClick={openAllCurrentTabs} style={{ padding: "4px 10px", background: "#0e2a4a", border: "1px solid #1e4a7a", borderRadius: 4, color: "#60a5fa", fontSize: 11, fontWeight: 600 }}>
                ▶ open all
              </button>
            )}
            {currentTabs.length > 0 && (
              <button className="btn" onClick={closeAllCurrentTabs} style={{ padding: "4px 10px", background: "#1a0808", border: "1px solid #3a0e0e", borderRadius: 4, color: "#ef4444", fontSize: 11 }}>
                ✕ close all
              </button>
            )}
          </>
        )}

        {/* Tab2 actions */}
        {activeTab === "favorites" && (
          <>
            <input
              value={searchQueryFav}
              onChange={e => handleSearchFav(e.target.value)}
              onBlur={() => setTimeout(() => setSearchResultsFav([]), 150)}
              placeholder="search..."
              style={{ padding: "3px 8px", background: "#0a1018", border: "1px solid #0e1f35", borderRadius: 4, color: "#a78bfa", fontSize: 11, width: 120 }}
            />
            <button className="btn" onClick={expandAllGroups} style={{ padding: "4px 10px", background: "#0e1f35", border: "1px solid #1e3a5f", borderRadius: 4, color: "#a78bfa", fontSize: 11 }}>
              {expandedGroups.size === NAMESPACES.length ? "⊟ collapse all" : "⊞ expand all"}
            </button>
            <button className="btn" onClick={() => setImportBookmarksOpen(true)} style={{ padding: "4px 10px", background: "#0e1f35", border: "1px solid #1e3a5f", borderRadius: 4, color: "#a8c0d6", fontSize: 11 }}>
              + import chrome bookmarks
            </button>
            <button className="btn" onClick={() => setNewGroupOpen(true)} style={{ padding: "4px 10px", background: "#0e1f35", border: "1px solid #1e3a5f", borderRadius: 4, color: "#a8c0d6", fontSize: 11 }}>
              + new group
            </button>
          </>
        )}
      </div>

      {/* ── Tab1: Current window ── */}
      {activeTab === "current" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {currentTabs.length === 0 && (
            <div style={{ padding: 24, color: "#1e3a5f", textAlign: "center" }}>No tabs in current window</div>
          )}
          {(searchQuery ? searchResults : currentTabs).map(tab => (
            <div key={tab.id} className="row"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", borderBottom: "1px solid #080c12" }}>
              {tab.favIconUrl && <img src={tab.favIconUrl} width={14} height={14} style={{ borderRadius: 3, flexShrink: 0 }} onError={e => (e.target as HTMLImageElement).style.display = "none"} />}
              <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => openTab(tab.url)}>
                <div style={{ color: "#e2e8f0", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tab.title || getDomain(tab.url)}</div>
                <div style={{ color: "#1e4a7a", fontSize: 10 }}>{getDomain(tab.url)}</div>
              </div>
              <button className="btn" onClick={e => { e.stopPropagation(); openTab(tab.url); }} style={{ background: "transparent", color: "#1e4a7a", padding: "3px 6px", border: "none", fontSize: 20, flexShrink: 0 }} title="Open">↗</button>
              <button className="btn" onClick={e => { e.stopPropagation(); setAddToGroupUrl(tab.url); setAddToGroupName(tab.title || getDomain(tab.url)); setAddToGroupOpen(true); }} style={{ background: "transparent", color: "#1e4a7a", padding: "3px 6px", border: "none", fontSize: 20, flexShrink: 0 }} title="Add to favorites">☆</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Tab2: Favorites ── */}
      {activeTab === "favorites" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {/* Search results */}
          {searchQueryFav && (
            <div>
              <div style={{ padding: "6px 16px", color: "#1e4a7a", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em" }}>
                RESULTS ({searchResultsFav.length})
              </div>
              {searchResultsFav.length === 0 && (
                <div style={{ padding: 16, color: "#1e3a5f", textAlign: "center" }}>No matching favorites</div>
              )}
              {searchResultsFav.map(pod => (
                <div key={pod.id} className="row" onClick={() => openTab(pod.url)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px", borderBottom: "1px solid #080c12" }}>
                  <span style={{ color: "#8b5cf6", fontSize: 9, fontWeight: 600 }}>{pod.namespace}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: "#a8c0d6", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pod.name}</div>
                    <div style={{ color: "#1e4a7a", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{getDomain(pod.url)}</div>
                    <div style={{ color: "#334155", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <a href={pod.url} target="_blank" rel="noopener noreferrer" style={{ color: "#334155", textDecoration: "none" }} onClick={e => e.stopPropagation()}>{pod.url}</a>
                    </div>
                  </div>
                  <button className="btn" onClick={e => { e.stopPropagation(); openTab(pod.url); }} style={{ background: "transparent", color: "#1e4a7a", padding: "3px 6px", border: "none", fontSize: 20 }} title="Open">↗</button>
                  <button className="btn" onClick={e => { e.stopPropagation(); handleDeletePod(pod); }} style={{ background: "transparent", color: "#1e4a7a", padding: "3px 6px", border: "none", fontSize: 20 }} title="Delete">✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Grouped list */}
          {!searchQueryFav && NAMESPACES.map(ns => {
            const groupPods = podsByNs(ns.id);
            if (groupPods.length === 0) return null;
            const isExpanded = expandedGroups.has(ns.id);
            return (
              <div key={ns.id}>
                <div className="row" onClick={() => toggleGroup(ns.id)} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "7px 16px",
                  borderBottom: "1px solid #080c12", cursor: "pointer",
                }}>
                  <span className="chevron" style={{ color: "#1e4a7a", fontSize: 20, transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                  <span style={{ color: ns.color, fontWeight: 600, fontSize: 11 }}>{ns.label}</span>
                  <span style={{ background: ns.color + "22", color: ns.color, padding: "0 5px", borderRadius: 3, fontSize: 10 }}>{groupPods.length}</span>
                  <div style={{ flex: 1 }} />
                  <button className="btn" onClick={e => { e.stopPropagation(); openGroup(ns.id); }} style={{ background: "#0e2a4a", border: "1px solid #1e4a7a", borderRadius: 4, color: "#60a5fa", fontSize: 20, fontWeight: 600, padding: "3px 10px" }}>▶</button>
                  <button className="btn" onClick={e => { e.stopPropagation(); closeAllGroupTabs(); }} style={{ background: "#1a0808", border: "1px solid #3a0e0e", borderRadius: 4, color: "#ef4444", fontSize: 20, padding: "3px 10px" }}>✕</button>
                  <button className="btn" onClick={e => { e.stopPropagation(); handleDeleteGroup(ns.id); }} style={{ background: "transparent", border: "1px solid #3a0e0e", borderRadius: 4, color: "#ef4444", fontSize: 20, padding: "3px 8px" }} title={`Delete ${ns.label} group`}>🗑</button>
                </div>
                {isExpanded && groupPods.map(pod => (
                  <div key={pod.id} className="row" onClick={() => openTab(pod.url)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 16px 6px 32px", borderBottom: "1px solid #080c12" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "#a8c0d6", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pod.name}</div>
                      <div style={{ color: "#1e4a7a", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{getDomain(pod.url)}</div>
                      <div style={{ color: "#334155", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        <a href={pod.url} target="_blank" rel="noopener noreferrer" style={{ color: "#334155", textDecoration: "none" }} onClick={e => e.stopPropagation()}>{pod.url}</a>
                      </div>
                    </div>
                    <button className="btn" onClick={e => { e.stopPropagation(); openTab(pod.url); }} style={{ background: "transparent", color: "#1e4a7a", padding: "3px 6px", border: "none", fontSize: 20 }} title="Open">↗</button>
                    <button className="btn" onClick={e => { e.stopPropagation(); handleDeletePod(pod); }} style={{ background: "transparent", color: "#1e4a7a", padding: "3px 6px", border: "none", fontSize: 20 }} title="Delete">✕</button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modals ── */}

      {/* Add to group modal */}
      {addToGroupOpen && (
        <div style={{ position: "fixed", inset: 0, background: "#00000099", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setAddToGroupOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: 420, background: "#080c12", border: "1px solid #1e3a5f", borderRadius: 8, padding: 20, boxShadow: "0 20px 60px #000a" }}>
            <div style={{ color: "#60a5fa", fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", marginBottom: 16 }}>⎈ ADD TO FAVORITES</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "#1e4a7a", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>URL</div>
              <input value={addToGroupUrl} onChange={e => setAddToGroupUrl(e.target.value)} placeholder="https://..."
                style={{ width: "100%", padding: "7px 10px", background: "#0a1018", border: "1px solid #0e1f35", borderRadius: 4, color: "#60a5fa", fontSize: 12 }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "#1e4a7a", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>NAME</div>
              <input value={addToGroupName} onChange={e => setAddToGroupName(e.target.value)} placeholder="github-prs"
                style={{ width: "100%", padding: "7px 10px", background: "#0a1018", border: "1px solid #0e1f35", borderRadius: 4, color: "#60a5fa", fontSize: 12 }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#1e4a7a", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>GROUP</div>
              <select value={addToGroupNs} onChange={e => setAddToGroupNs(e.target.value)} style={{ width: "100%", padding: "7px 10px", background: "#0a1018", border: "1px solid #0e1f35", borderRadius: 4, color: "#60a5fa", fontSize: 12, fontFamily: "inherit" }}>
                {NAMESPACES.map(n => (
                  <option key={n.id} value={n.id}>{n.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleAddToGroup} style={{ flex: 1, padding: "8px", background: "#0e2a4a", border: "1px solid #1e4a7a", borderRadius: 4, color: "#60a5fa", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Save</button>
              <button onClick={() => setAddToGroupOpen(false)} style={{ padding: "8px 14px", background: "#0a1018", border: "1px solid #0e1f35", borderRadius: 4, color: "#4b6880", fontSize: 12, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* New group modal */}
      {newGroupOpen && (
        <div style={{ position: "fixed", inset: 0, background: "#00000099", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setNewGroupOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: 420, background: "#080c12", border: "1px solid #1e3a5f", borderRadius: 8, padding: 20, boxShadow: "0 20px 60px #000a" }}>
            <div style={{ color: "#60a5fa", fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", marginBottom: 16 }}>⎈ NEW GROUP</div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#1e4a7a", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>GROUP NAME</div>
              <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="e.g. shopping"
                style={{ width: "100%", padding: "7px 10px", background: "#0a1018", border: "1px solid #0e1f35", borderRadius: 4, color: "#60a5fa", fontSize: 12 }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleNewGroup} style={{ flex: 1, padding: "8px", background: "#0e2a4a", border: "1px solid #1e4a7a", borderRadius: 4, color: "#60a5fa", fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Create</button>
              <button onClick={() => setNewGroupOpen(false)} style={{ padding: "8px 14px", background: "#0a1018", border: "1px solid #0e1f35", borderRadius: 4, color: "#4b6880", fontSize: 12, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Chrome bookmarks modal */}
      {importBookmarksOpen && (
        <div style={{ position: "fixed", inset: 0, background: "#00000099", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setImportBookmarksOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: 460, background: "#080c12", border: "1px solid #1e3a5f", borderRadius: 8, padding: 20, boxShadow: "0 20px 60px #000a" }}>
            <div style={{ color: "#60a5fa", fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", marginBottom: 16 }}>⎈ IMPORT CHROME BOOKMARKS</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: "#1e4a7a", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>SELECT BOOKMARKS HTML FILE</div>
              <label style={{ display: "block", padding: "8px 12px", background: "#0a1018", border: "1px solid #0e1f35", borderRadius: 4, color: importFile ? "#60a5fa" : "#4b6880", fontSize: 12, cursor: "pointer" }}>
                {importFile ? importFile.name : "Click to select a .html file"}
                <input type="file" accept=".html,text/html" onChange={e => setImportFile(e.target.files?.[0] || null)} style={{ display: "none" }} />
              </label>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: "#1e4a7a", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>DEFAULT GROUP (for root bookmarks)</div>
              <select value={importNs} onChange={e => setImportNs(e.target.value)} style={{ width: "100%", padding: "7px 10px", background: "#0a1018", border: "1px solid #0e1f35", borderRadius: 4, color: "#60a5fa", fontSize: 12, fontFamily: "inherit" }}>
                {NAMESPACES.map(n => (
                  <option key={n.id} value={n.id}>{n.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleImportBookmarks} disabled={!importFile} style={{ flex: 1, padding: "8px", background: importFile ? "#0e2a4a" : "#0a1018", border: `1px solid ${importFile ? "#1e4a7a" : "#0e1f35"}`, borderRadius: 4, color: importFile ? "#60a5fa" : "#334155", fontWeight: 600, fontSize: 12, cursor: importFile ? "pointer" : "default" }}>Import</button>
              <button onClick={() => setImportBookmarksOpen(false)} style={{ padding: "8px 14px", background: "#0a1018", border: "1px solid #0e1f35", borderRadius: 4, color: "#4b6880", fontSize: 12, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 16, right: 16, padding: "8px 14px", background: "#080c12", border: "1px solid #0e1f35", borderLeft: `3px solid ${toast.type === "error" ? "#ef4444" : toast.type === "warn" ? "#f59e0b" : "#10b981"}`, borderRadius: 5, fontSize: 11, color: "#a8c0d6", boxShadow: "0 4px 20px #0006", zIndex: 100 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
