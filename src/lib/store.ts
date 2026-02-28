/**
 * In-memory data store. Module-level singleton — persists for the lifetime
 * of the Node.js process (works on Railway / any persistent host).
 */
import type {
  NewsArticle,
  NewsCluster,
  Incident,
  Sitrep,
  PipelineStatus,
} from "@/types";

interface Store {
  articles: Map<string, NewsArticle>;
  clusters: Map<string, NewsCluster>;
  incidents: Map<string, Incident>;
  sitrep: Sitrep | null;
  pipeline: PipelineStatus;
  sseClients: Set<(msg: string) => void>;
}

// Global singleton (survives HMR in dev because of module caching)
const globalStore = global as typeof global & { __warStore?: Store };

function createStore(): Store {
  return {
    articles: new Map(),
    clusters: new Map(),
    incidents: new Map(),
    sitrep: null,
    pipeline: {
      running: false,
      lastRun: null,
      nextRun: null,
      error: null,
      articlesFetched: 0,
      incidentsExtracted: 0,
    },
    sseClients: new Set(),
  };
}

if (!globalStore.__warStore) {
  globalStore.__warStore = createStore();
}

export const store = globalStore.__warStore;

// ─── Convenience helpers ──────────────────────────────────────────────────────

export function getArticles(): NewsArticle[] {
  return Array.from(store.articles.values()).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
}

export function getClusters(): NewsCluster[] {
  return Array.from(store.clusters.values()).sort(
    (a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime()
  );
}

export function getIncidents(): Incident[] {
  return Array.from(store.incidents.values()).sort(
    (a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime()
  );
}

export function broadcast(type: string, data: unknown): void {
  const payload = JSON.stringify({
    type,
    data,
    timestamp: new Date().toISOString(),
  });
  const msg = `data: ${payload}\n\n`;
  for (const client of Array.from(store.sseClients)) {
    try {
      client(msg);
    } catch {
      store.sseClients.delete(client);
    }
  }
}
