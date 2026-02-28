"use client";

import type { Sitrep, PipelineStatus, ThreatLevel } from "@/types";

interface Props {
  sitrep: Sitrep | null;
  pipeline: PipelineStatus | null;
}

const THREAT_COLORS: Record<ThreatLevel, { bg: string; text: string; glow: string }> = {
  low: { bg: "bg-green-900/40", text: "text-green-400", glow: "shadow-green-500/20" },
  medium: { bg: "bg-yellow-900/40", text: "text-yellow-400", glow: "shadow-yellow-500/20" },
  high: { bg: "bg-red-900/40", text: "text-red-400", glow: "shadow-red-500/20" },
  critical: { bg: "bg-purple-900/40", text: "text-purple-400", glow: "shadow-purple-500/20" },
};

export default function SitrepPanel({ sitrep, pipeline }: Props) {
  const isLoading = !sitrep || (pipeline?.running && !sitrep);
  const threat = sitrep?.threatLevel ?? "medium";
  const colors = THREAT_COLORS[threat];

  return (
    <div className="border-b border-war-border flex-shrink-0">
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-war-border">
        <div className="flex items-center gap-2">
          <span className="text-war-red text-xs">⚡</span>
          <span className="text-[10px] text-war-muted uppercase tracking-widest">
            SITREP
          </span>
          {pipeline?.running && (
            <span className="text-[8px] text-war-blue uppercase tracking-widest animate-pulse">
              updating...
            </span>
          )}
        </div>

        {sitrep && (
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 ${colors.bg} shadow-sm ${colors.glow}`}
          >
            <span className={`text-[10px] font-bold tracking-widest uppercase ${colors.text}`}>
              {threat}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        {isLoading ? (
          <SitrepSkeleton />
        ) : (
          <>
            {/* Summary */}
            <p className="text-war-text text-[11px] leading-relaxed mb-2">
              {sitrep!.summary}
            </p>

            {/* Key developments */}
            {sitrep!.keyDevelopments.length > 0 && (
              <ul className="space-y-1 mb-2">
                {sitrep!.keyDevelopments.map((dev, i) => (
                  <li key={i} className="flex gap-1.5 text-[10px] text-war-muted leading-snug">
                    <span className="text-war-green flex-shrink-0 mt-0.5">&gt;</span>
                    <span>{dev}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Meta */}
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-war-border">
              <span className="text-[8px] px-1 py-0.5 bg-war-blue/10 text-war-blue border border-war-blue/30 uppercase tracking-wider">
                AI
              </span>
              <span className="text-[9px] text-war-muted">
                {sitrep!.disclaimer}
              </span>
            </div>

            <div className="text-[9px] text-war-muted mt-1">
              Generated {new Date(sitrep!.generatedAt).toLocaleTimeString()} •{" "}
              {sitrep!.basedOnArticles} articles
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SitrepSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-2.5 bg-war-border rounded w-full" />
      <div className="h-2.5 bg-war-border rounded w-4/5" />
      <div className="h-2.5 bg-war-border rounded w-3/4" />
      <div className="mt-3 space-y-1.5">
        <div className="h-2 bg-war-border rounded w-full" />
        <div className="h-2 bg-war-border rounded w-5/6" />
        <div className="h-2 bg-war-border rounded w-4/6" />
      </div>
      <div className="text-[9px] text-war-muted mt-2">
        Generating situation report
        <span className="animate-blink">_</span>
      </div>
    </div>
  );
}
