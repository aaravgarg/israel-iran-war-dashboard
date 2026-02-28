/**
 * Main data pipeline — runs every POLL_INTERVAL_MS (default 10 min).
 * Fetches news → clusters → extracts incidents → generates sitrep → broadcasts via SSE.
 */
import crypto from "crypto";
import { store, broadcast, getArticles } from "./store";
import {
  fetchGdeltNews,
  fetchBingNews,
  fetchGdeltGeoEvents,
  type GdeltGeoFeature,
} from "./newsClient";
import {
  summarizeCluster,
  extractIncidents,
  generateSitrep,
  clusterArticlesByTitle,
  makeClusterId,
} from "./openaiService";
import type { NewsCluster, Incident, Actor, EventType } from "@/types";

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? "600000");
let _pollTimer: ReturnType<typeof setInterval> | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function startPipeline(): void {
  if (_pollTimer) return; // already running

  console.log(
    `[pipeline] Starting — poll interval: ${POLL_INTERVAL_MS / 1000}s`
  );

  // Run immediately, then on interval
  void runPipeline();
  _pollTimer = setInterval(() => void runPipeline(), POLL_INTERVAL_MS);
}

export function stopPipeline(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

// ─── Pipeline execution ────────────────────────────────────────────────────────

export async function runPipeline(): Promise<void> {
  if (store.pipeline.running) {
    console.log("[pipeline] Already running, skipping tick");
    return;
  }

  store.pipeline.running = true;
  store.pipeline.error = null;

  broadcast("pipeline_status", { ...store.pipeline, running: true });

  try {
    // 1. Fetch articles
    console.log("[pipeline] Fetching articles...");
    const [gdeltArticles, bingArticles] = await Promise.all([
      fetchGdeltNews(),
      fetchBingNews(),
    ]);

    const allArticles = dedupeArticles([...gdeltArticles, ...bingArticles]);

    // Store new articles
    let newCount = 0;
    for (const article of allArticles) {
      if (!store.articles.has(article.id)) {
        store.articles.set(article.id, article);
        newCount++;
      }
    }
    console.log(
      `[pipeline] Articles: ${allArticles.length} fetched, ${newCount} new`
    );

    // 2. Cluster articles
    const articleMap = clusterArticlesByTitle(allArticles);
    const newClusters: NewsCluster[] = [];

    for (const [key, clusterArticles] of Array.from(articleMap)) {
      const clusterId = makeClusterId(key);
      const existing = store.clusters.get(clusterId);

      // Skip if cluster hasn't changed
      if (
        existing &&
        existing.articleCount === clusterArticles.length &&
        Date.now() - new Date(existing.lastUpdatedAt).getTime() < POLL_INTERVAL_MS
      ) {
        continue;
      }

      // Generate summary for new/updated clusters
      const summary = await summarizeCluster(clusterArticles);

      const cluster: NewsCluster = {
        id: clusterId,
        title: clusterArticles[0].title,
        summary,
        articleCount: clusterArticles.length,
        lastUpdatedAt: new Date().toISOString(),
        articles: clusterArticles,
        severityScore: Math.min(clusterArticles.length * 15, 100),
        primaryRegion: clusterArticles[0].regionTags[0] ?? "Middle East",
      };

      store.clusters.set(clusterId, cluster);
      newClusters.push(cluster);

      // Tag articles with cluster ID
      for (const article of clusterArticles) {
        const stored = store.articles.get(article.id);
        if (stored) {
          stored.clusterId = clusterId;
        }
      }
    }

    store.pipeline.articlesFetched = store.articles.size;

    // 3. Broadcast news update
    broadcast("news_update", {
      articles: allArticles.slice(0, 30),
      clusters: newClusters,
      lastUpdated: new Date().toISOString(),
      nextRefreshAt: new Date(Date.now() + POLL_INTERVAL_MS).toISOString(),
    });

    // 4. Extract incidents from new articles (use top conflict articles)
    const conflictArticles = allArticles
      .filter((a) =>
        /(strike|attack|airstrike|missile|bombing|drone|killed|dead)/i.test(
          a.title
        )
      )
      .slice(0, 20);

    if (conflictArticles.length > 0) {
      console.log(
        `[pipeline] Extracting incidents from ${conflictArticles.length} articles...`
      );
      const extracted = await extractIncidents(conflictArticles);

      let incidentCount = 0;
      for (const inc of extracted) {
        const id = crypto
          .createHash("md5")
          .update(`${inc.lat},${inc.lon},${inc.happenedAt}`)
          .digest("hex");

        if (!store.incidents.has(id)) {
          store.incidents.set(id, {
            ...inc,
            id,
            changeLog: [
              {
                at: new Date().toISOString(),
                change: "Incident extracted from news reporting",
              },
            ],
          });
          incidentCount++;
        }
      }

      // 5. Also add GDELT geo events (they have real coordinates)
      const geoFeatures = await fetchGdeltGeoEvents();
      for (const feature of geoFeatures.slice(0, 50)) {
        addGdeltIncident(feature);
      }

      console.log(
        `[pipeline] Incidents: ${incidentCount} new AI-extracted, ${geoFeatures.length} from GDELT geo`
      );
      store.pipeline.incidentsExtracted = store.incidents.size;

      broadcast("incidents_update", {
        incidents: Array.from(store.incidents.values()).slice(0, 200),
        lastUpdated: new Date().toISOString(),
        nextRefreshAt: new Date(Date.now() + POLL_INTERVAL_MS).toISOString(),
      });
    }

    // 6. Generate sitrep (cached for 30 min)
    const sitrepAge = store.sitrep
      ? Date.now() - new Date(store.sitrep.generatedAt).getTime()
      : Infinity;

    const SITREP_TTL = parseInt(process.env.SUMMARY_CACHE_TTL_MS ?? "1800000");

    if (sitrepAge > SITREP_TTL) {
      console.log("[pipeline] Generating sitrep...");
      const articles = getArticles().slice(0, 15);
      store.sitrep = await generateSitrep(articles);
      broadcast("sitrep_update", store.sitrep);
    }

    store.pipeline.lastRun = new Date().toISOString();
    store.pipeline.nextRun = new Date(Date.now() + POLL_INTERVAL_MS).toISOString();
    store.pipeline.running = false;

    broadcast("pipeline_status", store.pipeline);
    console.log("[pipeline] Tick complete");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pipeline] Error:", msg);
    store.pipeline.error = msg;
    store.pipeline.running = false;
    broadcast("pipeline_status", store.pipeline);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dedupeArticles(
  articles: import("@/types").NewsArticle[]
): import("@/types").NewsArticle[] {
  const seen = new Set<string>();
  return articles.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
}

function inferActorFromText(text: string): Actor {
  const t = text.toLowerCase();
  if (/(idf|israel(i)?|mossad|netanyahu)/.test(t)) return "israel";
  if (/(irgc|iran(ian)?|khamenei|tehran|revolutionary guard)/.test(t))
    return "iran";
  if (/(hezbollah|nasrallah|lebanese|south lebanon)/.test(t))
    return "hezbollah";
  if (/(hamas|al-qassam|sinwar|ismail haniyeh|gaza)/.test(t)) return "hamas";
  if (/(houthi|ansar allah|yemen)/.test(t)) return "houthis";
  if (/(pentagon|centcom|us air force|united states military)/.test(t))
    return "usa";
  return "unknown";
}

function inferEventTypeFromText(text: string): EventType {
  const t = text.toLowerCase();
  if (/(airstrike|air strike|f-35|f-16|bomber|warplane)/.test(t))
    return "airstrike";
  if (/(missile|rocket|ballistic|cruise missile)/.test(t)) return "missile";
  if (/(drone|uav|unmanned)/.test(t)) return "drone";
  if (/(cyber|hack|malware|electronic)/.test(t)) return "cyber";
  if (/(naval|ship|frigate|destroyer|sea)/.test(t)) return "naval";
  if (/(ground|infantry|tank|troop)/.test(t)) return "ground";
  return "unknown";
}

function addGdeltIncident(feature: GdeltGeoFeature): void {
  const [lon, lat] = feature.geometry.coordinates;
  const props = feature.properties;
  const html = props.html ?? "";
  const locationName = props.name ?? "Unknown";

  const id = crypto
    .createHash("md5")
    .update(`gdelt:${lat},${lon},${locationName}`)
    .digest("hex");

  if (store.incidents.has(id)) return;

  const actorClaimed = inferActorFromText(html + " " + locationName);
  const eventType = inferEventTypeFromText(html + " " + locationName);
  const confidence = Math.min(30 + props.count * 5, 75); // GDELT = lower confidence

  store.incidents.set(id, {
    id,
    happenedAt: new Date().toISOString(),
    lat,
    lon,
    locationName,
    eventType,
    actorClaimed,
    actorAssessed: actorClaimed,
    verificationStatus: "reported",
    confidence,
    description: `Reported activity in ${locationName} (${props.count} source${props.count !== 1 ? "s" : ""})`,
    sourceUrls: extractUrls(html),
    reasoning: `Based on ${props.count} media mention${props.count !== 1 ? "s" : ""} from GDELT. Actor inferred from text.`,
    changeLog: [
      {
        at: new Date().toISOString(),
        change: "Added from GDELT geographic event data",
      },
    ],
  });
}

function extractUrls(html: string): string[] {
  const matches = Array.from(html.matchAll(/href="([^"]+)"/g));
  return matches.map((m) => m[1]).filter((u) => u.startsWith("http")).slice(0, 3);
}
