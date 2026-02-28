"use client";

import { useRef, useEffect } from "react";
import type { NewsArticle, NewsCluster } from "@/types";

interface Props {
  articles: NewsArticle[];
  clusters: NewsCluster[];
}

export default function NewsFeed({ articles, clusters }: Props) {
  const prevArticleIds = useRef<Set<string>>(new Set());

  // Track new articles for flash animation
  useEffect(() => {
    const currentIds = new Set(articles.map((a) => a.id));
    prevArticleIds.current = currentIds;
  }, [articles]);

  if (articles.length === 0) {
    return (
      <div className="p-4 flex flex-col items-center justify-center h-full text-center">
        <div className="text-war-blue text-2xl mb-3">⌛</div>
        <div className="text-war-muted text-xs tracking-widest uppercase">
          Fetching intelligence...
        </div>
        <div className="text-war-muted text-xs mt-1 opacity-60">
          Pipeline initializing
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-war-border">
      {/* Story clusters (if any) */}
      {clusters.length > 0 && (
        <div className="p-3">
          <div className="text-[9px] text-war-muted uppercase tracking-widest mb-2">
            Story Clusters
          </div>
          <div className="space-y-2">
            {clusters.slice(0, 3).map((cluster) => (
              <ClusterCard key={cluster.id} cluster={cluster} />
            ))}
          </div>
        </div>
      )}

      {/* Individual articles */}
      <div>
        {articles.slice(0, 40).map((article, idx) => (
          <ArticleCard
            key={article.id}
            article={article}
            isNew={idx < 3 && prevArticleIds.current.size === 0}
          />
        ))}
      </div>
    </div>
  );
}

function ClusterCard({ cluster }: { cluster: NewsCluster }) {
  const severity = cluster.severityScore;
  const severityColor =
    severity >= 70
      ? "text-red-400"
      : severity >= 40
      ? "text-orange-400"
      : "text-yellow-400";

  return (
    <div className="border border-war-border bg-war-bg/50 p-2.5 hover:border-war-blue/40 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-war-text text-xs font-semibold line-clamp-2 leading-tight">
          {cluster.title}
        </span>
        <span className={`text-[10px] flex-shrink-0 ${severityColor}`}>
          {severity}
        </span>
      </div>
      {cluster.summary && (
        <p className="text-war-muted text-[10px] leading-relaxed line-clamp-2">
          {cluster.summary}
        </p>
      )}
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-war-muted text-[9px]">
          {cluster.articleCount} source{cluster.articleCount !== 1 ? "s" : ""}
        </span>
        <span className="text-war-border">•</span>
        <span className="text-war-muted text-[9px]">{cluster.primaryRegion}</span>
        <span className="text-war-border">•</span>
        <span className="text-war-muted text-[9px]">
          {timeAgo(cluster.lastUpdatedAt)}
        </span>
      </div>
    </div>
  );
}

function ArticleCard({
  article,
  isNew,
}: {
  article: NewsArticle;
  isNew: boolean;
}) {
  return (
    <div
      className={`p-3 border-b border-war-border hover:bg-war-bg/30 transition-colors cursor-pointer border-l-2 ${
        isNew ? "news-new border-l-green-500" : "border-l-war-border"
      }`}
    >
      {/* Source + time */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-war-blue text-[9px] uppercase tracking-widest">
          {article.source}
        </span>
        <span className="text-war-border">•</span>
        <span className="text-war-muted text-[9px]">
          {timeAgo(article.publishedAt)}
        </span>
        {article.regionTags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="text-[8px] px-1 py-0.5 border border-war-border text-war-muted uppercase tracking-wider"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Title */}
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-war-text text-xs leading-snug hover:text-war-blue transition-colors line-clamp-2"
      >
        {article.title}
      </a>

      {/* Description */}
      {article.description && (
        <p className="text-war-muted text-[10px] mt-1 line-clamp-1 leading-relaxed">
          {article.description}
        </p>
      )}
    </div>
  );
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
