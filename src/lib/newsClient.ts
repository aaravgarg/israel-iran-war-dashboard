/**
 * News fetching — uses free RSS feeds from major outlets (no API key needed).
 * Optional: TheNewsAPI (https://www.thenewsapi.com — free tier 100 req/day, no CC)
 *
 * RSS sources used (all free, no key):
 *  - BBC News World
 *  - CNN Middle East
 *  - Al Jazeera
 *  - Times of Israel
 *  - Iran International
 *  - Sky News World
 */
import axios from "axios";
import crypto from "crypto";
import type { NewsArticle } from "@/types";

const RSS_FEEDS = [
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC News" },
  { url: "https://rss.cnn.com/rss/edition_meast.rss", source: "CNN" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" },
  { url: "https://www.timesofisrael.com/feed/", source: "Times of Israel" },
  { url: "https://iranintl.com/en/rss", source: "Iran International" },
  { url: "https://feeds.skynews.com/feeds/rss/world.xml", source: "Sky News" },
];

const CONFLICT_RE =
  /israel|iran|idf|irgc|hezbollah|hamas|houthi|gaza|beirut|tehran|tel aviv|airstrike|missile|strike|bomb|war|nuclear|drone/i;

// ─── RSS parser ───────────────────────────────────────────────────────────────

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  imageUrl: string | null;
}

async function fetchRssFeed(
  url: string,
  source: string
): Promise<NewsArticle[]> {
  try {
    const res = await axios.get<string>(url, {
      timeout: 10_000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WARMONBot/1.0)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      responseType: "text",
    });

    const xml: string = res.data;
    const items = parseRssItems(xml);

    return items
      .filter((item) =>
        CONFLICT_RE.test(item.title + " " + item.description)
      )
      .map((item) => ({
        id: crypto.createHash("md5").update(item.link).digest("hex"),
        title: stripHtml(item.title),
        description: stripHtml(item.description).slice(0, 220),
        url: item.link,
        imageUrl: item.imageUrl,
        source,
        publishedAt: item.pubDate
          ? new Date(item.pubDate).toISOString()
          : new Date().toISOString(),
        regionTags: inferRegionTags(item.title + " " + item.description),
      }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[rss] ${source} failed: ${msg.slice(0, 80)}`);
    return [];
  }
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const matches = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi));

  for (const match of matches) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link =
      extractTag(block, "link") ||
      extractAttr(block, "link", "href") ||
      extractTag(block, "guid");
    const pubDate =
      extractTag(block, "pubDate") || extractTag(block, "dc:date");
    const description =
      extractTag(block, "description") ||
      extractTag(block, "content:encoded");
    const imageUrl =
      extractAttr(block, "media:thumbnail", "url") ||
      extractAttr(block, "media:content", "url") ||
      extractAttr(block, "enclosure", "url") ||
      extractSrcFromImg(description);

    if (title && link) {
      items.push({ title, link, pubDate, description, imageUrl });
    }
  }
  return items;
}

// ─── TheNewsAPI (optional — free tier 100 req/day, sign up at thenewsapi.com) ─

async function fetchTheNewsAPI(): Promise<NewsArticle[]> {
  const key = process.env.THE_NEWS_API_KEY;
  if (!key) return [];

  try {
    const res = await axios.get("https://api.thenewsapi.com/v1/news/all", {
      params: {
        api_token: key,
        search: "Israel Iran war strike missile airstrike",
        language: "en",
        limit: 25,
        sort: "published_at",
      },
      timeout: 10_000,
    });

    return (res.data?.data ?? []).map(
      (a: {
        title: string;
        description: string;
        url: string;
        image_url: string | null;
        source: string;
        published_at: string;
      }) => ({
        id: crypto.createHash("md5").update(a.url).digest("hex"),
        title: a.title ?? "Untitled",
        description: a.description ?? "",
        url: a.url,
        imageUrl: a.image_url ?? null,
        source: a.source ?? "Unknown",
        publishedAt: a.published_at,
        regionTags: inferRegionTags(a.title + " " + a.description),
      })
    );
  } catch (err) {
    console.warn("[newsClient] TheNewsAPI failed:", err);
    return [];
  }
}

// ─── GDELT fallback ───────────────────────────────────────────────────────────

async function fetchGdeltArticles(): Promise<NewsArticle[]> {
  try {
    const res = await axios.get<{ articles?: GdeltRawArticle[] }>(
      "https://api.gdeltproject.org/api/v2/doc/doc",
      {
        params: {
          query:
            "Israel Iran (airstrike OR missile OR attack OR war) sourcelang:english",
          mode: "artlist",
          maxrecords: 30,
          timespan: "3d",
          format: "json",
        },
        timeout: 12_000,
      }
    );

    return (res.data?.articles ?? []).map((a) => ({
      id: crypto.createHash("md5").update(a.url).digest("hex"),
      title: a.title ?? "Untitled",
      description: "",
      url: a.url,
      imageUrl: a.socialimage ?? null,
      source: a.domain ?? "Unknown",
      publishedAt: parseGdeltDate(a.seendate),
      regionTags: inferRegionTags(a.title),
    }));
  } catch {
    return [];
  }
}

interface GdeltRawArticle {
  url: string;
  title: string;
  seendate: string;
  socialimage?: string;
  domain: string;
}

// ─── GDELT GEO (for map incident coordinates) ─────────────────────────────────

export interface GdeltGeoFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { name: string; count: number; html: string; shareimage?: string };
}

export async function fetchGdeltGeoEvents(): Promise<GdeltGeoFeature[]> {
  try {
    const res = await axios.get<{ features?: GdeltGeoFeature[] }>(
      "https://api.gdeltproject.org/api/v2/geo/geo",
      {
        params: {
          query:
            "(Israel OR Iran OR IDF OR Hezbollah OR Hamas) (airstrike OR missile OR attack)",
          mode: "PointData",
          maxrecords: process.env.GDELT_MAX_RECORDS ?? "250",
          timespan: process.env.GDELT_TIMESPAN ?? "7d",
          format: "GeoJSON",
        },
        timeout: 15_000,
      }
    );
    return res.data?.features ?? [];
  } catch {
    return [];
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function fetchAllNews(): Promise<NewsArticle[]> {
  // Parallel: all RSS feeds + TheNewsAPI
  const [rssResults, theNewsResults] = await Promise.all([
    Promise.all(RSS_FEEDS.map((f) => fetchRssFeed(f.url, f.source))),
    fetchTheNewsAPI(),
  ]);

  const rssFlat = rssResults.flat();
  console.log(`[newsClient] RSS: ${rssFlat.length} articles, TheNewsAPI: ${theNewsResults.length}`);

  // Only hit GDELT if RSS gave us very few articles
  const gdeltFallback = rssFlat.length < 5 ? await fetchGdeltArticles() : [];

  const all = [...rssFlat, ...theNewsResults, ...gdeltFallback];

  // Dedupe by ID, sort newest first
  const seen = new Set<string>();
  return all
    .filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    })
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  const m =
    xml.match(
      new RegExp(
        `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`,
        "i"
      )
    ) || xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function extractAttr(
  xml: string,
  tag: string,
  attr: string
): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, "i"));
  return m ? m[1] : null;
}

function extractSrcFromImg(html: string): string | null {
  const m = html?.match(/<img[^>]*\ssrc="([^"]+)"/i);
  return m ? m[1] : null;
}

function stripHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseGdeltDate(s: string): string {
  if (!s) return new Date().toISOString();
  try {
    const c = s.replace("T", "").replace("Z", "");
    return new Date(
      `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}T${c.slice(8, 10)}:${c.slice(10, 12)}:${c.slice(12, 14)}Z`
    ).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export function inferRegionTags(text: string): string[] {
  const t = text.toLowerCase();
  const tags: string[] = [];
  if (/(israel|tel aviv|idf|netanyahu|haifa|eilat)/.test(t)) tags.push("Israel");
  if (/(iran|tehran|irgc|khamenei|isfahan|bushehr)/.test(t)) tags.push("Iran");
  if (/(gaza|hamas|al-qassam|rafah|khan younis)/.test(t)) tags.push("Gaza");
  if (/(lebanon|hezbollah|beirut|nasrallah|south lebanon)/.test(t)) tags.push("Lebanon");
  if (/(yemen|houthi|sanaa|hodeidah)/.test(t)) tags.push("Yemen");
  if (/(syria|damascus|aleppo|deir ez-zor)/.test(t)) tags.push("Syria");
  if (/\biraq\b/.test(t)) tags.push("Iraq");
  if (/(west bank|ramallah|jenin|nablus|hebron)/.test(t)) tags.push("West Bank");
  if (/(red sea|strait of hormuz|gulf of aden|persian gulf)/.test(t)) tags.push("Maritime");
  return tags.length > 0 ? tags : ["Middle East"];
}
