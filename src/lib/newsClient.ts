/**
 * Fetches news and geographic event data.
 * Primary: GDELT Doc 2.0 API (free, no key needed)
 * Optional: Bing News Search API (set BING_NEWS_API_KEY)
 */
import axios from "axios";
import crypto from "crypto";
import type { NewsArticle } from "@/types";

const GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_GEO_URL = "https://api.gdeltproject.org/api/v2/geo/geo";

const CONFLICT_QUERY =
  "(Israel OR Iran OR IDF OR IRGC OR Hezbollah OR Hamas OR Houthis) " +
  "(airstrike OR missile OR strike OR attack OR bombing OR drone OR war OR conflict)";

export interface RawGdeltArticle {
  url: string;
  url_mobile?: string;
  title: string;
  seendate: string; // YYYYMMDDTHHMMSSZ
  socialimage?: string;
  domain: string;
  language: string;
  sourcecountry: string;
}

export interface GdeltGeoFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] }; // [lon, lat]
  properties: {
    name: string;
    count: number;
    html: string;
    shareimage?: string;
  };
}

// ─── GDELT Doc 2.0 ────────────────────────────────────────────────────────────

export async function fetchGdeltNews(): Promise<NewsArticle[]> {
  try {
    const res = await axios.get<{ articles?: RawGdeltArticle[] }>(GDELT_DOC_URL, {
      params: {
        query: CONFLICT_QUERY,
        mode: "artlist",
        maxrecords: 50,
        timespan: "1d",
        format: "json",
      },
      timeout: 15_000,
    });

    const raw = res.data?.articles ?? [];
    return raw.map((a) => ({
      id: crypto.createHash("md5").update(a.url).digest("hex"),
      title: a.title ?? "Untitled",
      description: "",
      url: a.url,
      imageUrl: a.socialimage ?? null,
      source: a.domain ?? "Unknown",
      publishedAt: parseGdeltDate(a.seendate),
      regionTags: inferRegionTags(a.title + " " + a.sourcecountry),
    }));
  } catch (err) {
    console.error("[newsClient] GDELT Doc fetch failed:", err);
    return [];
  }
}

// ─── GDELT GEO 2.0 ────────────────────────────────────────────────────────────

export async function fetchGdeltGeoEvents(): Promise<GdeltGeoFeature[]> {
  try {
    const timespan = process.env.GDELT_TIMESPAN ?? "7d";
    const maxrecords = process.env.GDELT_MAX_RECORDS ?? "250";

    const res = await axios.get<{ features?: GdeltGeoFeature[] }>(GDELT_GEO_URL, {
      params: {
        query:
          "(Israel OR Iran OR IDF OR IRGC OR Hezbollah OR Hamas) " +
          "(airstrike OR missile OR bombing OR strike OR attack)",
        mode: "PointData",
        maxrecords,
        timespan,
        format: "GeoJSON",
      },
      timeout: 20_000,
    });

    return res.data?.features ?? [];
  } catch (err) {
    console.error("[newsClient] GDELT Geo fetch failed:", err);
    return [];
  }
}

// ─── Bing News (optional) ─────────────────────────────────────────────────────

export async function fetchBingNews(): Promise<NewsArticle[]> {
  const key = process.env.BING_NEWS_API_KEY;
  const endpoint =
    process.env.BING_NEWS_ENDPOINT ??
    "https://api.bing.microsoft.com/v7.0/news/search";

  if (!key) return [];

  try {
    const res = await axios.get(endpoint, {
      params: {
        q: "Israel Iran strike missile airstrike attack war",
        count: 30,
        mkt: "en-US",
        freshness: "Day",
      },
      headers: { "Ocp-Apim-Subscription-Key": key },
      timeout: 15_000,
    });

    const items = res.data?.value ?? [];
    return items.map(
      (a: {
        url: string;
        name: string;
        description: string;
        image?: { thumbnail?: { contentUrl?: string } };
        provider?: Array<{ name: string }>;
        datePublished: string;
      }) => ({
        id: crypto.createHash("md5").update(a.url).digest("hex"),
        title: a.name ?? "Untitled",
        description: a.description ?? "",
        url: a.url,
        imageUrl: a.image?.thumbnail?.contentUrl ?? null,
        source: a.provider?.[0]?.name ?? "Unknown",
        publishedAt: a.datePublished,
        regionTags: inferRegionTags(a.name + " " + a.description),
      })
    );
  } catch (err) {
    console.error("[newsClient] Bing fetch failed:", err);
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseGdeltDate(s: string): string {
  // GDELT format: 20241015T123000Z
  if (!s) return new Date().toISOString();
  try {
    const clean = s.replace("T", "").replace("Z", "");
    const year = clean.slice(0, 4);
    const month = clean.slice(4, 6);
    const day = clean.slice(6, 8);
    const hour = clean.slice(8, 10) || "00";
    const min = clean.slice(10, 12) || "00";
    const sec = clean.slice(12, 14) || "00";
    return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function inferRegionTags(text: string): string[] {
  const t = text.toLowerCase();
  const tags: string[] = [];
  if (t.includes("israel") || t.includes("tel aviv") || t.includes("idf")) tags.push("Israel");
  if (t.includes("iran") || t.includes("tehran") || t.includes("irgc")) tags.push("Iran");
  if (t.includes("gaza") || t.includes("hamas")) tags.push("Gaza");
  if (t.includes("lebanon") || t.includes("hezbollah") || t.includes("beirut")) tags.push("Lebanon");
  if (t.includes("yemen") || t.includes("houthi")) tags.push("Yemen");
  if (t.includes("syria") || t.includes("damascus")) tags.push("Syria");
  if (t.includes("iraq")) tags.push("Iraq");
  if (t.includes("west bank") || t.includes("ramallah")) tags.push("West Bank");
  return tags.length > 0 ? tags : ["Middle East"];
}
