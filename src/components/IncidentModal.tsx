"use client";

import { useEffect } from "react";
import type { Incident } from "@/types";
import { ACTOR_COLORS, ACTOR_LABELS, EVENT_TYPE_ICONS } from "@/types";

interface Props {
  incident: Incident;
  onClose: () => void;
}

const VERIFICATION_STYLES: Record<
  string,
  { border: string; text: string; bg: string }
> = {
  confirmed: { border: "border-green-500", text: "text-green-400", bg: "bg-green-900/20" },
  reported: { border: "border-blue-500", text: "text-blue-400", bg: "bg-blue-900/20" },
  disputed: { border: "border-orange-500", text: "text-orange-400", bg: "bg-orange-900/20" },
  unverified: { border: "border-gray-600", text: "text-gray-400", bg: "bg-gray-900/20" },
};

export default function IncidentModal({ incident, onClose }: Props) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const color = ACTOR_COLORS[incident.actorClaimed] ?? "#6b7280";
  const verif = VERIFICATION_STYLES[incident.verificationStatus] ?? VERIFICATION_STYLES.unverified;
  const icon = EVENT_TYPE_ICONS[incident.eventType] ?? "💥";

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-lg bg-war-panel border border-war-border shadow-2xl"
        style={{ boxShadow: `0 0 40px ${color}20` }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between p-4 border-b"
          style={{ borderColor: color + "40" }}
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none">{icon}</span>
            <div>
              <h2 className="text-war-text font-bold text-sm leading-tight">
                {incident.locationName}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color }}
                >
                  {ACTOR_LABELS[incident.actorClaimed] ?? incident.actorClaimed}
                </span>
                <span className="text-war-border">•</span>
                <span className="text-war-muted text-[10px] uppercase">
                  {incident.eventType}
                </span>
              </div>
            </div>
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            className="text-war-muted hover:text-war-text transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* Verification badge */}
          <div className={`flex items-center gap-2 p-2 border ${verif.border} ${verif.bg}`}>
            <span className={`text-xs font-bold uppercase tracking-widest ${verif.text}`}>
              {incident.verificationStatus}
            </span>
            <span className="text-war-muted text-[10px]">
              — {verificationDescription(incident.verificationStatus)}
            </span>
          </div>

          {/* Confidence meter */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-war-muted uppercase tracking-wider">
                Confidence
              </span>
              <span className="text-xs text-war-text font-bold">
                {incident.confidence}%
              </span>
            </div>
            <div className="h-1.5 bg-war-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${incident.confidence}%`,
                  backgroundColor: confidenceColor(incident.confidence),
                  boxShadow: `0 0 6px ${confidenceColor(incident.confidence)}`,
                }}
              />
            </div>
            {incident.reasoning && (
              <p className="text-[10px] text-war-muted mt-1 italic">
                {incident.reasoning}
              </p>
            )}
          </div>

          {/* Details */}
          <div className="space-y-2">
            <DetailRow
              label="Time"
              value={new Date(incident.happenedAt).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            />
            <DetailRow
              label="Coordinates"
              value={`${incident.lat.toFixed(4)}, ${incident.lon.toFixed(4)}`}
            />
            {incident.actorAssessed !== incident.actorClaimed && (
              <DetailRow
                label="Actor (assessed)"
                value={ACTOR_LABELS[incident.actorAssessed] ?? incident.actorAssessed}
              />
            )}
            {(incident.casualtyMin !== undefined ||
              incident.casualtyMax !== undefined) && (
              <DetailRow
                label="Casualties"
                value={
                  incident.casualtyMin === incident.casualtyMax
                    ? String(incident.casualtyMin ?? "Unknown")
                    : `${incident.casualtyMin ?? "?"} – ${incident.casualtyMax ?? "?"}`
                }
              />
            )}
          </div>

          {/* Description */}
          {incident.description && (
            <div>
              <div className="text-[10px] text-war-muted uppercase tracking-wider mb-1">
                Report
              </div>
              <p className="text-war-text text-xs leading-relaxed">
                {incident.description}
              </p>
            </div>
          )}

          {/* Sources */}
          {incident.sourceUrls.length > 0 && (
            <div>
              <div className="text-[10px] text-war-muted uppercase tracking-wider mb-1">
                Sources ({incident.sourceUrls.length})
              </div>
              <div className="space-y-1">
                {incident.sourceUrls.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-war-blue text-[10px] hover:underline truncate"
                  >
                    ↗ {new URL(url).hostname}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Change log */}
          {incident.changeLog.length > 0 && (
            <div>
              <div className="text-[10px] text-war-muted uppercase tracking-wider mb-1">
                Change Log
              </div>
              <div className="space-y-1">
                {incident.changeLog.map((entry, i) => (
                  <div key={i} className="text-[10px] flex gap-2">
                    <span className="text-war-muted flex-shrink-0">
                      {new Date(entry.at).toLocaleTimeString()}
                    </span>
                    <span className="text-war-text">{entry.change}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI disclaimer */}
          <div className="pt-2 border-t border-war-border">
            <p className="text-[9px] text-war-muted italic">
              ⚠ Incident data is extracted from news reporting and may not be
              independently verified. Always cross-reference with primary sources.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] text-war-muted uppercase tracking-wider w-24 flex-shrink-0">
        {label}
      </span>
      <span className="text-war-text text-xs">{value}</span>
    </div>
  );
}

function confidenceColor(confidence: number): string {
  if (confidence >= 70) return "#22c55e";
  if (confidence >= 40) return "#f97316";
  return "#ef4444";
}

function verificationDescription(status: string): string {
  const desc: Record<string, string> = {
    confirmed: "Verified by 2+ independent reputable sources",
    reported: "Reported by at least one source, unconfirmed",
    disputed: "Conflicting claims from multiple sources",
    unverified: "Single source or AI-extracted, not yet verified",
  };
  return desc[status] ?? "Status unknown";
}
