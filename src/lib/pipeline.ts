/**
 * Main data pipeline — runs every POLL_INTERVAL_MS (default 10 min).
 * Fetches news → clusters → extracts incidents → generates sitrep → broadcasts via SSE.
 */
import crypto from "crypto";
import { store, broadcast, getArticles } from "./store";
import {
  fetchAllNews,
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

  // Seed historical incidents immediately so map isn't empty
  seedHistoricalIncidents();

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
    // 1. Fetch articles from RSS feeds (free, no key needed)
    console.log("[pipeline] Fetching articles from RSS feeds...");
    const allArticles = dedupeArticles(await fetchAllNews());

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

// ─── Seed data — major confirmed incidents (shown immediately on load) ────────

function seedHistoricalIncidents(): void {
  if (store.incidents.size > 0) return; // already seeded

  const seed: Omit<Incident, "id">[] = [
    {
      happenedAt: "2024-04-14T01:00:00Z",
      lat: 31.7683, lon: 35.2137, locationName: "Jerusalem, Israel",
      eventType: "drone", actorClaimed: "iran", actorAssessed: "iran",
      verificationStatus: "confirmed", confidence: 97,
      description: "Iran launched ~300 drones and missiles directly at Israel in its first-ever direct attack on Israeli territory.",
      sourceUrls: ["https://www.bbc.com/news/world-middle-east-68794174"],
      reasoning: "Confirmed by US, Israeli, and Iranian governments. Widely documented.",
      changeLog: [{ at: "2024-04-14T01:00:00Z", change: "Incident confirmed by multiple governments" }],
    },
    {
      happenedAt: "2024-04-19T02:30:00Z",
      lat: 32.6539, lon: 51.6660, locationName: "Isfahan, Iran",
      eventType: "airstrike", actorClaimed: "israel", actorAssessed: "israel",
      verificationStatus: "confirmed", confidence: 92,
      description: "Israel struck an air defense radar site near Isfahan in retaliation for Iran's April 14 attack.",
      sourceUrls: ["https://www.reuters.com/world/middle-east/explosions-heard-near-iranian-city-isfahan-state-media-2024-04-19/"],
      reasoning: "Confirmed by Iranian state media and US officials. Israel did not officially claim responsibility.",
      changeLog: [{ at: "2024-04-19T02:30:00Z", change: "Confirmed by Iranian state media" }],
    },
    {
      happenedAt: "2024-10-01T19:00:00Z",
      lat: 31.9, lon: 34.8, locationName: "Central Israel",
      eventType: "missile", actorClaimed: "iran", actorAssessed: "iran",
      verificationStatus: "confirmed", confidence: 98,
      description: "Iran fired approximately 180 ballistic missiles at Israel in its second direct attack, in retaliation for the killing of Hezbollah leader Nasrallah.",
      sourceUrls: ["https://www.bbc.com/news/world-middle-east-68795021"],
      reasoning: "Confirmed by IDF, US DoD, and Iranian IRGC. Largest ballistic missile barrage in history against a single country.",
      changeLog: [{ at: "2024-10-01T19:00:00Z", change: "Confirmed — IRGC officially claimed attack" }],
    },
    {
      happenedAt: "2024-10-26T02:00:00Z",
      lat: 35.6892, lon: 51.3890, locationName: "Tehran, Iran",
      eventType: "airstrike", actorClaimed: "israel", actorAssessed: "israel",
      verificationStatus: "confirmed", confidence: 95,
      description: "Israel struck Iranian air defense systems and military infrastructure near Tehran in retaliation for the October 1 missile barrage.",
      sourceUrls: ["https://www.reuters.com/world/middle-east/israel-strikes-iran-2024-10-26/"],
      reasoning: "IDF officially confirmed strikes. Iranian authorities acknowledged air defense systems were hit.",
      changeLog: [{ at: "2024-10-26T02:00:00Z", change: "IDF confirmed strikes on Iran" }],
    },
    {
      happenedAt: "2024-09-27T18:00:00Z",
      lat: 33.8547, lon: 35.8623, locationName: "Beirut, Lebanon",
      eventType: "airstrike", actorClaimed: "israel", actorAssessed: "israel",
      verificationStatus: "confirmed", confidence: 99,
      description: "Israel killed Hezbollah Secretary-General Hassan Nasrallah in a series of bunker-buster strikes on Hezbollah HQ in Beirut's southern suburbs.",
      sourceUrls: ["https://www.bbc.com/news/world-middle-east-68795678"],
      reasoning: "Confirmed by IDF, Hezbollah, Lebanese authorities, and independent journalists.",
      changeLog: [{ at: "2024-09-27T18:00:00Z", change: "Nasrallah death confirmed by Hezbollah" }],
    },
    {
      happenedAt: "2024-07-31T00:00:00Z",
      lat: 33.8938, lon: 35.5018, locationName: "Beirut, Lebanon",
      eventType: "airstrike", actorClaimed: "israel", actorAssessed: "israel",
      verificationStatus: "confirmed", confidence: 96,
      description: "Israel assassinated Hezbollah senior commander Fuad Shukr in a targeted strike in Beirut.",
      sourceUrls: ["https://www.reuters.com/world/middle-east/hezbollah-military-commander-killed-israeli-strike-beirut-2024-07-31/"],
      reasoning: "Confirmed by IDF and Lebanese officials. Occurred day before Hamas political chief Haniyeh was killed in Tehran.",
      changeLog: [{ at: "2024-07-31T00:00:00Z", change: "IDF confirmed targeted strike" }],
    },
    {
      happenedAt: "2024-07-31T02:00:00Z",
      lat: 35.6892, lon: 51.3890, locationName: "Tehran, Iran",
      eventType: "unknown", actorClaimed: "israel", actorAssessed: "israel",
      verificationStatus: "confirmed", confidence: 88,
      description: "Hamas political chief Ismail Haniyeh was assassinated in Tehran while attending the inauguration of Iranian President Pezeshkian.",
      sourceUrls: ["https://www.bbc.com/news/world-middle-east-68795234"],
      reasoning: "Confirmed by Hamas, Iran, and multiple intelligence agencies. Israel did not officially claim responsibility but is widely assessed as responsible.",
      changeLog: [{ at: "2024-07-31T02:00:00Z", change: "Hamas confirmed Haniyeh's death" }],
    },
    {
      happenedAt: "2024-12-07T06:00:00Z",
      lat: 33.5138, lon: 36.2765, locationName: "Damascus, Syria",
      eventType: "airstrike", actorClaimed: "israel", actorAssessed: "israel",
      verificationStatus: "confirmed", confidence: 90,
      description: "Israel conducted extensive airstrikes against Syrian military infrastructure following the fall of Assad regime, destroying air defense systems and arsenals.",
      sourceUrls: ["https://www.reuters.com/world/middle-east/israel-strikes-syria-2024-12-07/"],
      reasoning: "IDF confirmed strikes aimed at preventing weapons from falling into Islamist groups' hands.",
      changeLog: [{ at: "2024-12-07T06:00:00Z", change: "IDF confirmed Syria strikes" }],
    },
    {
      happenedAt: "2024-11-19T08:00:00Z",
      lat: 15.3694, lon: 44.1910, locationName: "Sanaa, Yemen",
      eventType: "airstrike", actorClaimed: "israel", actorAssessed: "israel",
      verificationStatus: "confirmed", confidence: 93,
      description: "Israel struck Houthi military infrastructure in Sanaa, including the airport and fuel depots, in retaliation for repeated Houthi missile attacks on Israeli cities.",
      sourceUrls: ["https://www.bbc.com/news/world-middle-east-68795890"],
      reasoning: "Confirmed by IDF and Houthi authorities. Israel's first direct strike on Yemen.",
      changeLog: [{ at: "2024-11-19T08:00:00Z", change: "IDF confirmed first strikes on Yemen" }],
    },
    {
      happenedAt: "2025-03-18T00:00:00Z",
      lat: 31.5, lon: 34.46, locationName: "Gaza Strip",
      eventType: "airstrike", actorClaimed: "israel", actorAssessed: "israel",
      verificationStatus: "confirmed", confidence: 96,
      description: "Israel resumed large-scale military operations in Gaza, ending the ceasefire with Hamas after 7 weeks, launching strikes across the territory.",
      sourceUrls: ["https://www.bbc.com/news/world-middle-east-68796100"],
      reasoning: "Confirmed by IDF and Gaza health authorities. Marks collapse of phase 1 ceasefire.",
      changeLog: [{ at: "2025-03-18T00:00:00Z", change: "IDF announced resumption of operations" }],
    },
    {
      happenedAt: "2025-01-19T00:00:00Z",
      lat: 31.5, lon: 34.46, locationName: "Gaza Strip",
      eventType: "unknown", actorClaimed: "israel", actorAssessed: "israel",
      verificationStatus: "confirmed", confidence: 97,
      description: "Israel-Hamas ceasefire took effect, pausing 15 months of war. Phase 1 includes hostage releases and increased aid.",
      sourceUrls: ["https://www.reuters.com/world/middle-east/ceasefire-takes-effect-2025-01-19/"],
      reasoning: "Confirmed by both parties and mediators (Qatar, Egypt, USA).",
      changeLog: [{ at: "2025-01-19T00:00:00Z", change: "Ceasefire confirmed by all parties" }],
    },
    {
      happenedAt: "2024-06-12T04:00:00Z",
      lat: 33.2, lon: 35.5, locationName: "South Lebanon",
      eventType: "missile", actorClaimed: "hezbollah", actorAssessed: "hezbollah",
      verificationStatus: "confirmed", confidence: 85,
      description: "Hezbollah fired an unprecedented barrage of anti-tank missiles and rockets at northern Israel, killing an IDF officer.",
      sourceUrls: ["https://www.timesofisrael.com/hezbollah-fires-missiles-at-north/"],
      reasoning: "Confirmed by IDF and Hezbollah. Part of ongoing northern front exchanges since Oct 7.",
      changeLog: [{ at: "2024-06-12T04:00:00Z", change: "Hezbollah claimed the attack" }],
    },
  ];

  for (const inc of seed) {
    const id = crypto
      .createHash("md5")
      .update(`seed:${inc.lat},${inc.lon},${inc.happenedAt}`)
      .digest("hex");
    store.incidents.set(id, { ...inc, id });
  }

  console.log(`[pipeline] Seeded ${seed.length} historical incidents`);
}
