import { NextRequest, NextResponse } from "next/server";
import { getArticles, getClusters, store } from "@/lib/store";
import { startPipeline } from "@/lib/pipeline";

// Ensure pipeline is running
startPipeline();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const since = searchParams.get("since");
  const cluster = searchParams.get("cluster");

  let articles = getArticles();

  if (since) {
    const sinceDate = new Date(since).getTime();
    articles = articles.filter(
      (a) => new Date(a.publishedAt).getTime() > sinceDate
    );
  }

  if (cluster) {
    articles = articles.filter((a) => a.clusterId === cluster);
  }

  return NextResponse.json({
    articles: articles.slice(0, 50),
    clusters: getClusters().slice(0, 20),
    lastUpdated: store.pipeline.lastRun ?? new Date().toISOString(),
    nextRefreshAt:
      store.pipeline.nextRun ??
      new Date(Date.now() + 600_000).toISOString(),
    pipeline: store.pipeline,
  });
}
