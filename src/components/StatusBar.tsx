"use client";

import { useEffect, useState } from "react";
import type { PipelineStatus } from "@/types";

interface Props {
  connected: boolean;
  lastUpdated: string | null;
  nextRefreshAt: string | null;
  pipeline: PipelineStatus | null;
  incidentCount: number;
  articleCount: number;
}

export default function StatusBar({
  connected,
  lastUpdated,
  nextRefreshAt,
  pipeline,
  incidentCount,
  articleCount,
}: Props) {
  const [countdown, setCountdown] = useState<string>("");

  useEffect(() => {
    if (!nextRefreshAt) return;
    const tick = () => {
      const diff = new Date(nextRefreshAt).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown("refreshing...");
        return;
      }
      const mins = Math.floor(diff / 60_000);
      const secs = Math.floor((diff % 60_000) / 1000);
      setCountdown(`${mins}m ${secs.toString().padStart(2, "0")}s`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [nextRefreshAt]);

  return (
    <header className="h-10 flex items-center justify-between px-4 bg-war-panel border-b border-war-border flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="text-war-red font-mono font-bold text-sm tracking-[0.2em] uppercase">
          &#9888; WARMON
        </div>
        <div className="text-war-muted text-[10px] tracking-[0.15em] uppercase border border-war-border px-2 py-0.5">
          Israel / Iran
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-[10px] text-war-muted">
        <Stat label="incidents" value={incidentCount} />
        <Stat label="articles" value={articleCount} />

        {lastUpdated && (
          <div className="flex items-center gap-1">
            <span className="text-war-muted">updated</span>
            <span className="text-war-text">
              {new Date(lastUpdated).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
        )}

        {countdown && (
          <div className="flex items-center gap-1">
            <span className="text-war-muted">next</span>
            <span className={pipeline?.running ? "text-war-blue animate-pulse" : "text-war-text"}>
              {pipeline?.running ? "running..." : countdown}
            </span>
          </div>
        )}

        {/* Connection dot */}
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${
              connected
                ? "bg-green-500 shadow-[0_0_6px_#22c55e] animate-pulse-slow"
                : "bg-red-500 shadow-[0_0_6px_#ef4444]"
            }`}
          />
          <span className={connected ? "text-green-400" : "text-red-400"}>
            {connected ? "LIVE" : "RECONNECTING"}
          </span>
        </div>
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-war-text font-semibold">{value}</span>
      <span className="text-war-muted">{label}</span>
    </div>
  );
}
