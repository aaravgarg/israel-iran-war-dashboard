"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Incident } from "@/types";

interface Props {
  incidents: Incident[];
  value: [number, number];
  onChange: (range: [number, number]) => void;
}

const PRESETS = [
  { label: "6H", hours: 6 },
  { label: "24H", hours: 24 },
  { label: "7D", hours: 24 * 7 },
  { label: "ALL", hours: Infinity },
];

export default function TimeScrubber({ incidents, value, onChange }: Props) {
  const [playing, setPlaying] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("ALL");
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Get time bounds from incidents
  const bounds = getTimeBounds(incidents);

  const applyPreset = useCallback(
    (hours: number, label: string) => {
      setActivePreset(label);
      if (hours === Infinity) {
        onChange([0, 100]);
      } else {
        const now = Date.now();
        const from = now - hours * 3_600_000;
        if (!bounds || bounds.min === bounds.max) {
          onChange([0, 100]);
          return;
        }
        const span = bounds.max - bounds.min;
        const fromPct = Math.max(0, ((from - bounds.min) / span) * 100);
        onChange([fromPct, 100]);
      }
    },
    [bounds, onChange]
  );

  // Replay animation
  const startReplay = useCallback(() => {
    if (playing) {
      if (playRef.current) clearInterval(playRef.current);
      setPlaying(false);
      onChange([0, 100]);
      return;
    }

    setPlaying(true);
    onChange([0, 0]);
    let progress = 0;

    playRef.current = setInterval(() => {
      progress += 2;
      if (progress > 100) {
        if (playRef.current) clearInterval(playRef.current);
        setPlaying(false);
        onChange([0, 100]);
        return;
      }
      onChange([0, progress]);
    }, 150);
  }, [playing, onChange]);

  useEffect(() => {
    return () => {
      if (playRef.current) clearInterval(playRef.current);
    };
  }, []);

  if (incidents.length === 0) {
    return (
      <div className="h-10 bg-war-panel border-t border-war-border flex items-center justify-center">
        <span className="text-war-muted text-[10px] tracking-widest uppercase">
          Time scrubber — waiting for incident data
        </span>
      </div>
    );
  }

  return (
    <div className="h-12 bg-war-panel border-t border-war-border flex items-center gap-4 px-4 flex-shrink-0">
      {/* Preset buttons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => applyPreset(p.hours, p.label)}
            className={`text-[9px] px-2 py-1 uppercase tracking-widest transition-colors ${
              activePreset === p.label
                ? "bg-war-blue/20 text-war-blue border border-war-blue/50"
                : "text-war-muted border border-war-border hover:text-war-text hover:border-war-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-war-border flex-shrink-0" />

      {/* Slider */}
      <div className="flex-1 flex items-center gap-3">
        {/* From label */}
        <span className="text-[9px] text-war-muted flex-shrink-0 w-28 text-right">
          {bounds ? formatTime(bounds.min + (bounds.max - bounds.min) * value[0] / 100) : "—"}
        </span>

        <div className="flex-1 relative">
          <input
            type="range"
            min={0}
            max={100}
            value={value[1]}
            onChange={(e) => {
              const v = parseInt(e.target.value);
              onChange([value[0], Math.max(value[0] + 5, v)]);
              setActivePreset("");
            }}
            className="w-full"
            disabled={playing}
          />
        </div>

        {/* To label */}
        <span className="text-[9px] text-war-muted flex-shrink-0 w-28">
          {bounds ? formatTime(bounds.min + (bounds.max - bounds.min) * value[1] / 100) : "—"}
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-war-border flex-shrink-0" />

      {/* Replay button */}
      <button
        onClick={startReplay}
        className={`text-[9px] px-3 py-1 uppercase tracking-widest transition-colors flex items-center gap-1.5 flex-shrink-0 border ${
          playing
            ? "text-war-red border-war-red/50 bg-war-red/10"
            : "text-war-green border-war-green/50 bg-war-green/10 hover:bg-war-green/20"
        }`}
      >
        {playing ? (
          <>
            <span className="animate-pulse">■</span> STOP
          </>
        ) : (
          <>▶ REPLAY</>
        )}
      </button>

      {/* Incident count in range */}
      <div className="text-[9px] text-war-muted flex-shrink-0">
        <span className="text-war-text font-bold">
          {countInRange(incidents, value, bounds)}
        </span>{" "}
        incidents
      </div>
    </div>
  );
}

function getTimeBounds(
  incidents: Incident[]
): { min: number; max: number } | null {
  if (incidents.length === 0) return null;
  const times = incidents.map((i) => new Date(i.happenedAt).getTime());
  return { min: Math.min(...times), max: Math.max(...times) };
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function countInRange(
  incidents: Incident[],
  range: [number, number],
  bounds: { min: number; max: number } | null
): number {
  if (!bounds || range[0] === 0 && range[1] === 100) return incidents.length;
  const span = bounds.max - bounds.min;
  const fromTime = bounds.min + (span * range[0]) / 100;
  const toTime = bounds.min + (span * range[1]) / 100;
  return incidents.filter((i) => {
    const t = new Date(i.happenedAt).getTime();
    return t >= fromTime && t <= toTime;
  }).length;
}
