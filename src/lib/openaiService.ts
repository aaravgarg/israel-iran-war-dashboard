/**
 * OpenAI integration:
 * - gpt-4o-mini for fast, cheap article/cluster summaries
 * - gpt-4o with Structured Outputs for incident extraction
 * - gpt-4o for sitrep generation
 */
import OpenAI from "openai";
import type { NewsArticle, Incident, Sitrep, Actor, EventType } from "@/types";
import crypto from "crypto";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

// ─── Article cluster summary ──────────────────────────────────────────────────

export async function summarizeCluster(articles: NewsArticle[]): Promise<string> {
  if (!process.env.OPENAI_API_KEY) return "AI summary unavailable (no API key).";
  if (articles.length === 0) return "No articles to summarize.";

  const headlines = articles
    .slice(0, 8)
    .map((a, i) => `${i + 1}. [${a.source}] ${a.title}`)
    .join("\n");

  try {
    const res = await getClient().chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 150,
      messages: [
        {
          role: "system",
          content:
            "You are a concise military analyst. Summarize the following news cluster in 2-3 sentences. Be factual and neutral.",
        },
        { role: "user", content: headlines },
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? "Summary unavailable.";
  } catch (err) {
    console.error("[openai] summarizeCluster error:", err);
    return "Summary temporarily unavailable.";
  }
}

// ─── Incident extraction (Structured Outputs) ─────────────────────────────────

interface ExtractedIncident {
  locationName: string;
  lat: number;
  lon: number;
  happenedAt: string;
  eventType: string;
  actorClaimed: string;
  confidence: number;
  description: string;
  reasoning: string;
}

export async function extractIncidents(
  articles: NewsArticle[]
): Promise<Omit<Incident, "id" | "changeLog">[]> {
  if (!process.env.OPENAI_API_KEY) return [];
  if (articles.length === 0) return [];

  const text = articles
    .slice(0, 10)
    .map((a) => `HEADLINE: ${a.title}\nSOURCE: ${a.source}\nURL: ${a.url}`)
    .join("\n\n");

  try {
    const res = await getClient().chat.completions.create({
      model: "gpt-4o",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "incident_extraction",
          strict: true,
          schema: {
            type: "object",
            properties: {
              incidents: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    locationName: { type: "string" },
                    lat: { type: "number" },
                    lon: { type: "number" },
                    happenedAt: { type: "string" },
                    eventType: {
                      type: "string",
                      enum: ["airstrike", "missile", "drone", "cyber", "ground", "naval", "unknown"],
                    },
                    actorClaimed: {
                      type: "string",
                      enum: ["israel", "iran", "hezbollah", "hamas", "usa", "houthis", "unknown"],
                    },
                    confidence: { type: "integer" },
                    description: { type: "string" },
                    reasoning: { type: "string" },
                  },
                  required: [
                    "locationName", "lat", "lon", "happenedAt", "eventType",
                    "actorClaimed", "confidence", "description", "reasoning",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["incidents"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content: `You are a military intelligence analyst extracting structured incident data from news headlines.
For each reported strike, attack, or military action, extract:
- Location with accurate lat/lon coordinates
- Event type and actor who conducted it
- Confidence score (0-100) based on how clearly the source reports it
- Brief description (1 sentence)
- Reasoning for the confidence score

Only extract actual military incidents (strikes, attacks, bombardments). Skip diplomatic news, opinion pieces, and general conflict updates.
Today's date context: ${new Date().toISOString().split("T")[0]}`,
        },
        { role: "user", content: text },
      ],
    });

    const content = res.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content) as { incidents: ExtractedIncident[] };

    return parsed.incidents.map((inc) => ({
      happenedAt: inc.happenedAt || new Date().toISOString(),
      lat: inc.lat,
      lon: inc.lon,
      locationName: inc.locationName,
      eventType: (inc.eventType as EventType) ?? "unknown",
      actorClaimed: (inc.actorClaimed as Actor) ?? "unknown",
      actorAssessed: (inc.actorClaimed as Actor) ?? "unknown",
      verificationStatus: inc.confidence >= 70 ? "reported" : "unverified" as const,
      confidence: Math.max(0, Math.min(100, inc.confidence)),
      description: inc.description,
      sourceUrls: articles.slice(0, 3).map((a) => a.url),
      reasoning: inc.reasoning,
    }));
  } catch (err) {
    console.error("[openai] extractIncidents error:", err);
    return [];
  }
}

// ─── Sitrep generation ────────────────────────────────────────────────────────

export async function generateSitrep(articles: NewsArticle[]): Promise<Sitrep> {
  const fallback: Sitrep = {
    summary: "Situation report unavailable. Check news feed for latest developments.",
    keyDevelopments: [],
    threatLevel: "medium",
    generatedAt: new Date().toISOString(),
    basedOnArticles: 0,
    disclaimer: "AI-generated summary — always verify with primary sources.",
  };

  if (!process.env.OPENAI_API_KEY) return fallback;
  if (articles.length === 0) return fallback;

  const headlines = articles
    .slice(0, 12)
    .map((a, i) => `${i + 1}. [${a.source}] ${a.title}`)
    .join("\n");

  try {
    const res = await getClient().chat.completions.create({
      model: "gpt-4o",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "sitrep",
          strict: true,
          schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              keyDevelopments: { type: "array", items: { type: "string" } },
              threatLevel: {
                type: "string",
                enum: ["low", "medium", "high", "critical"],
              },
            },
            required: ["summary", "keyDevelopments", "threatLevel"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content: `You are a geopolitical military analyst producing concise situation reports for the Israel-Iran conflict.
Write a brief, factual SITREP based on the provided headlines.
- summary: 2-3 sentence executive summary
- keyDevelopments: 3-5 bullet points of the most significant developments
- threatLevel: your assessed escalation level (low/medium/high/critical)
Be objective and factual. Do not speculate beyond what the sources report.`,
        },
        { role: "user", content: `Recent headlines:\n\n${headlines}` },
      ],
      max_tokens: 500,
    });

    const content = res.choices[0]?.message?.content;
    if (!content) return fallback;

    const parsed = JSON.parse(content) as {
      summary: string;
      keyDevelopments: string[];
      threatLevel: "low" | "medium" | "high" | "critical";
    };

    return {
      summary: parsed.summary,
      keyDevelopments: parsed.keyDevelopments,
      threatLevel: parsed.threatLevel,
      generatedAt: new Date().toISOString(),
      basedOnArticles: articles.length,
      disclaimer: "AI-generated summary — always verify with primary sources listed below.",
    };
  } catch (err) {
    console.error("[openai] generateSitrep error:", err);
    return fallback;
  }
}

// ─── Cluster articles by similarity ──────────────────────────────────────────

export function clusterArticlesByTitle(articles: NewsArticle[]): Map<string, NewsArticle[]> {
  const clusters = new Map<string, NewsArticle[]>();

  for (const article of articles) {
    const key = normalizeTitle(article.title);
    let found = false;

    for (const [clusterKey, clusterArticles] of Array.from(clusters)) {
      if (titleSimilarity(key, clusterKey) > 0.4) {
        clusterArticles.push(article);
        found = true;
        break;
      }
    }

    if (!found) {
      clusters.set(key, [article]);
    }
  }

  return clusters;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\b(the|a|an|in|on|at|to|for|of|and|or|is|are|was|were)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a: string, b: string): number {
  const wordsA = a.split(" ").filter((w) => w.length > 3);
  const wordsB = b.split(" ").filter((w) => w.length > 3);
  const wordsBSet = new Set(wordsB);
  const intersection = wordsA.filter((w) => wordsBSet.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function makeClusterId(key: string): string {
  return crypto.createHash("md5").update(key).digest("hex");
}
