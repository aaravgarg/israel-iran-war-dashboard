// ─── News ─────────────────────────────────────────────────────────────────────

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  imageUrl: string | null;
  source: string;
  publishedAt: string; // ISO 8601
  regionTags: string[];
  clusterId?: string;
}

export interface NewsCluster {
  id: string;
  title: string;
  summary: string;
  articleCount: number;
  lastUpdatedAt: string;
  articles: NewsArticle[];
  severityScore: number; // 0-100
  primaryRegion: string;
}

export interface NewsResponse {
  articles: NewsArticle[];
  clusters: NewsCluster[];
  lastUpdated: string;
  nextRefreshAt: string;
}

// ─── Incidents ────────────────────────────────────────────────────────────────

export type Actor =
  | "israel"
  | "iran"
  | "hezbollah"
  | "hamas"
  | "usa"
  | "houthis"
  | "unknown";

export type EventType =
  | "airstrike"
  | "missile"
  | "drone"
  | "cyber"
  | "ground"
  | "naval"
  | "unknown";

export type VerificationStatus =
  | "reported"
  | "confirmed"
  | "disputed"
  | "unverified";

export interface ChangeLogEntry {
  at: string; // ISO 8601
  change: string;
}

export interface Incident {
  id: string;
  happenedAt: string; // ISO 8601
  lat: number;
  lon: number;
  locationName: string;
  eventType: EventType;
  actorClaimed: Actor;
  actorAssessed: Actor;
  verificationStatus: VerificationStatus;
  confidence: number; // 0-100
  casualtyMin?: number;
  casualtyMax?: number;
  description: string;
  sourceUrls: string[];
  reasoning: string; // why this confidence score
  changeLog: ChangeLogEntry[];
}

export interface IncidentsResponse {
  incidents: Incident[];
  lastUpdated: string;
  nextRefreshAt: string;
}

// ─── AI Sitrep ─────────────────────────────────────────────────────────────────

export type ThreatLevel = "low" | "medium" | "high" | "critical";

export interface Sitrep {
  summary: string;
  keyDevelopments: string[];
  threatLevel: ThreatLevel;
  generatedAt: string;
  basedOnArticles: number;
  disclaimer: string;
}

// ─── SSE ──────────────────────────────────────────────────────────────────────

export type SSEEventType =
  | "news_update"
  | "incidents_update"
  | "sitrep_update"
  | "heartbeat"
  | "pipeline_status";

export interface SSEMessage {
  type: SSEEventType;
  data: unknown;
  timestamp: string;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export interface PipelineStatus {
  running: boolean;
  lastRun: string | null;
  nextRun: string | null;
  error: string | null;
  articlesFetched: number;
  incidentsExtracted: number;
}

// ─── Actor config ─────────────────────────────────────────────────────────────

export const ACTOR_COLORS: Record<Actor, string> = {
  israel: "#3b82f6",
  iran: "#ef4444",
  hezbollah: "#f97316",
  hamas: "#a855f7",
  usa: "#22c55e",
  houthis: "#eab308",
  unknown: "#6b7280",
};

export const ACTOR_LABELS: Record<Actor, string> = {
  israel: "Israel / IDF",
  iran: "Iran / IRGC",
  hezbollah: "Hezbollah",
  hamas: "Hamas",
  usa: "United States",
  houthis: "Houthis",
  unknown: "Unknown",
};

export const EVENT_TYPE_ICONS: Record<EventType, string> = {
  airstrike: "✈",
  missile: "🚀",
  drone: "🛸",
  cyber: "💻",
  ground: "🪖",
  naval: "⚓",
  unknown: "💥",
};
