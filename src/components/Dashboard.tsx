"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type {
  NewsArticle,
  NewsCluster,
  Incident,
  Sitrep,
  PipelineStatus,
} from "@/types";
import { ACTOR_COLORS, ACTOR_LABELS, EVENT_TYPE_ICONS } from "@/types";
import WarMap from "./WarMap";
import NewsFeed from "./NewsFeed";
import SitrepPanel from "./SitrepPanel";
import StatusBar from "./StatusBar";
import TimeScrubber from "./TimeScrubber";
import IncidentModal from "./IncidentModal";

interface DashboardState {
  articles: NewsArticle[];
  clusters: NewsCluster[];
  incidents: Incident[];
  sitrep: Sitrep | null;
  pipeline: PipelineStatus | null;
  connected: boolean;
  lastUpdated: string | null;
  nextRefreshAt: string | null;
}

export default function Dashboard() {
  const [state, setState] = useState<DashboardState>({
    articles: [],
    clusters: [],
    incidents: [],
    sitrep: null,
    pipeline: null,
    connected: false,
    lastUpdated: null,
    nextRefreshAt: null,
  });

  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(
    null
  );
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 100]); // percentage 0-100
  const [activeTab, setActiveTab] = useState<"news" | "timeline">("news");

  const sseRef = useRef<EventSource | null>(null);

  // ─── Initial data fetch ────────────────────────────────────────────────────
  const fetchInitial = useCallback(async () => {
    try {
      const [newsRes, incidentsRes, sitrepRes] = await Promise.all([
        fetch("/api/news"),
        fetch("/api/incidents"),
        fetch("/api/sitrep"),
      ]);

      const news = await newsRes.json();
      const incidentsData = await incidentsRes.json();
      const sitrepData = await sitrepRes.json();

      setState((prev) => ({
        ...prev,
        articles: news.articles ?? [],
        clusters: news.clusters ?? [],
        incidents: incidentsData.incidents ?? [],
        sitrep: sitrepData,
        pipeline: news.pipeline ?? null,
        lastUpdated: news.lastUpdated,
        nextRefreshAt: news.nextRefreshAt,
      }));
    } catch (err) {
      console.error("[dashboard] Initial fetch failed:", err);
    }
  }, []);

  // ─── SSE connection ────────────────────────────────────────────────────────
  const connectSSE = useCallback(() => {
    if (sseRef.current) return;

    const es = new EventSource("/api/stream");
    sseRef.current = es;

    es.onopen = () => {
      setState((prev) => ({ ...prev, connected: true }));
    };

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string;
          data: unknown;
          timestamp: string;
        };

        switch (msg.type) {
          case "news_update": {
            const d = msg.data as {
              articles: NewsArticle[];
              clusters: NewsCluster[];
              lastUpdated: string;
              nextRefreshAt: string;
            };
            setState((prev) => ({
              ...prev,
              articles: mergeArticles(prev.articles, d.articles),
              clusters: d.clusters.length > 0 ? d.clusters : prev.clusters,
              lastUpdated: d.lastUpdated,
              nextRefreshAt: d.nextRefreshAt,
            }));
            break;
          }
          case "incidents_update": {
            const d = msg.data as { incidents: Incident[] };
            setState((prev) => ({
              ...prev,
              incidents: mergeIncidents(prev.incidents, d.incidents),
            }));
            break;
          }
          case "sitrep_update": {
            setState((prev) => ({ ...prev, sitrep: msg.data as Sitrep }));
            break;
          }
          case "pipeline_status": {
            setState((prev) => ({
              ...prev,
              pipeline: msg.data as PipelineStatus,
            }));
            break;
          }
        }
      } catch (err) {
        console.error("[sse] Parse error:", err);
      }
    };

    es.onerror = () => {
      setState((prev) => ({ ...prev, connected: false }));
      es.close();
      sseRef.current = null;
      // Reconnect after 5s
      setTimeout(connectSSE, 5000);
    };
  }, []);

  useEffect(() => {
    fetchInitial();
    connectSSE();
    return () => {
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [fetchInitial, connectSSE]);

  // ─── Filtered incidents by time scrubber ──────────────────────────────────
  const filteredIncidents = filterByTimeRange(state.incidents, timeRange);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-war-bg">
      {/* Scan line effect */}
      <div className="scan-line" />

      {/* Header */}
      <StatusBar
        connected={state.connected}
        lastUpdated={state.lastUpdated}
        nextRefreshAt={state.nextRefreshAt}
        pipeline={state.pipeline}
        incidentCount={state.incidents.length}
        articleCount={state.articles.length}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map — takes 60% width */}
        <div className="relative flex-1 min-w-0">
          <WarMap
            incidents={filteredIncidents}
            onIncidentClick={setSelectedIncident}
          />

          {/* Map legend overlay */}
          <MapLegend />
        </div>

        {/* Sidebar — 380px */}
        <aside className="w-[380px] flex-shrink-0 flex flex-col border-l border-war-border overflow-hidden bg-war-panel">
          {/* Sitrep panel */}
          <SitrepPanel sitrep={state.sitrep} pipeline={state.pipeline} />

          {/* Tab bar */}
          <div className="flex border-b border-war-border flex-shrink-0">
            <button
              onClick={() => setActiveTab("news")}
              className={`flex-1 py-2 text-xs tracking-widest uppercase transition-colors ${
                activeTab === "news"
                  ? "text-war-blue border-b-2 border-war-blue"
                  : "text-war-muted hover:text-war-text"
              }`}
            >
              Intel Feed
            </button>
            <button
              onClick={() => setActiveTab("timeline")}
              className={`flex-1 py-2 text-xs tracking-widest uppercase transition-colors ${
                activeTab === "timeline"
                  ? "text-war-blue border-b-2 border-war-blue"
                  : "text-war-muted hover:text-war-text"
              }`}
            >
              Timeline
            </button>
          </div>

          {/* Content panel */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "news" ? (
              <NewsFeed
                articles={state.articles}
                clusters={state.clusters}
              />
            ) : (
              <Timeline incidents={filteredIncidents} />
            )}
          </div>
        </aside>
      </div>

      {/* Time scrubber */}
      <TimeScrubber
        incidents={state.incidents}
        value={timeRange}
        onChange={setTimeRange}
      />

      {/* Incident modal */}
      {selectedIncident && (
        <IncidentModal
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
        />
      )}
    </div>
  );
}

// ─── Timeline (inline for now) ───────────────────────────────────────────────

function Timeline({ incidents }: { incidents: Incident[] }) {
  if (incidents.length === 0) {
    return (
      <div className="p-4 text-war-muted text-xs text-center mt-8">
        No incidents in selected time range
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {incidents.slice(0, 50).map((inc) => (
        <div
          key={inc.id}
          className="flex gap-2 border-l-2 pl-3 py-1"
          style={{
            borderLeftColor:
              ACTOR_COLORS[inc.actorClaimed] ?? "#6b7280",
          }}
        >
          <span className="text-base leading-none mt-0.5">
            {EVENT_TYPE_ICONS[inc.eventType] ?? "💥"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-war-text text-xs font-semibold truncate">
              {inc.locationName}
            </div>
            <div className="text-war-muted text-xs">
              {ACTOR_LABELS[inc.actorClaimed] ?? "Unknown"} •{" "}
              {new Date(inc.happenedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
            <div className="text-war-muted text-xs truncate">
              {inc.description}
            </div>
          </div>
          <VerifBadge status={inc.verificationStatus} />
        </div>
      ))}
    </div>
  );
}

function VerifBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    confirmed: "text-green-400 border-green-400",
    reported: "text-blue-400 border-blue-400",
    disputed: "text-orange-400 border-orange-400",
    unverified: "text-gray-500 border-gray-500",
  };
  return (
    <span
      className={`text-[9px] border px-1 py-0.5 uppercase tracking-wider h-fit mt-1 flex-shrink-0 ${
        colors[status] ?? colors.unverified
      }`}
    >
      {status.slice(0, 4)}
    </span>
  );
}

function MapLegend() {
  const actors = [
    { label: "Israel / IDF", color: "#3b82f6" },
    { label: "Iran / IRGC", color: "#ef4444" },
    { label: "Hezbollah", color: "#f97316" },
    { label: "Hamas", color: "#a855f7" },
    { label: "Houthis", color: "#eab308" },
    { label: "USA", color: "#22c55e" },
    { label: "Unknown", color: "#6b7280" },
  ];

  return (
    <div className="absolute bottom-8 left-3 z-[1000] bg-war-panel/90 border border-war-border p-2.5 backdrop-blur-sm">
      <div className="text-[9px] text-war-muted tracking-widest uppercase mb-1.5">
        Actor
      </div>
      {actors.map((a) => (
        <div key={a.label} className="flex items-center gap-1.5 mb-1">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: a.color, boxShadow: `0 0 4px ${a.color}` }}
          />
          <span className="text-[10px] text-war-text">{a.label}</span>
        </div>
      ))}
      <div className="border-t border-war-border mt-2 pt-1.5">
        <div className="text-[9px] text-war-muted">
          Circle size = confidence score
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mergeArticles(
  existing: NewsArticle[],
  incoming: NewsArticle[]
): NewsArticle[] {
  const seen = new Set(existing.map((a) => a.id));
  const merged = [...existing];
  for (const a of incoming) {
    if (!seen.has(a.id)) {
      merged.unshift(a);
    }
  }
  return merged.slice(0, 100);
}

function mergeIncidents(
  existing: Incident[],
  incoming: Incident[]
): Incident[] {
  const map = new Map(existing.map((i) => [i.id, i]));
  for (const inc of incoming) {
    map.set(inc.id, inc);
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime()
  );
}

function filterByTimeRange(
  incidents: Incident[],
  range: [number, number]
): Incident[] {
  if (range[0] === 0 && range[1] === 100) return incidents;
  if (incidents.length === 0) return incidents;

  const times = incidents.map((i) => new Date(i.happenedAt).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const span = maxTime - minTime;

  const fromTime = minTime + (span * range[0]) / 100;
  const toTime = minTime + (span * range[1]) / 100;

  return incidents.filter((i) => {
    const t = new Date(i.happenedAt).getTime();
    return t >= fromTime && t <= toTime;
  });
}
