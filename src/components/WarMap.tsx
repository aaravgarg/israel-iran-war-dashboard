"use client";

import { useEffect, useRef } from "react";
import type { Incident } from "@/types";
import { ACTOR_COLORS, EVENT_TYPE_ICONS } from "@/types";

interface Props {
  incidents: Incident[];
  onIncidentClick: (incident: Incident) => void;
}

// Leaflet is loaded via CDN in layout.tsx, accessed as window.L
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L: any;
  }
}

export default function WarMap({ incidents, onIncidentClick }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletMap = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map());

  // ─── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    // Wait for Leaflet to be available (CDN)
    const init = () => {
      if (!window.L) {
        setTimeout(init, 100);
        return;
      }

      const map = window.L.map(mapRef.current, {
        center: [29.5, 38.0],
        zoom: 5,
        zoomControl: true,
        attributionControl: true,
      });

      // CartoDB Dark Matter tiles (free, no API key)
      window.L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 19,
        }
      ).addTo(map);

      leafletMap.current = map;
    };

    init();

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
        markersRef.current.clear();
      }
    };
  }, []);

  // ─── Update markers when incidents change ──────────────────────────────────
  useEffect(() => {
    if (!leafletMap.current || !window.L) return;

    const map = leafletMap.current;
    const markers = markersRef.current;

    // Remove markers no longer in view
    const incomingIds = new Set(incidents.map((i) => i.id));
    for (const [id, marker] of Array.from(markers.entries())) {
      if (!incomingIds.has(id)) {
        map.removeLayer(marker);
        markers.delete(id);
      }
    }

    // Add new markers
    for (const incident of incidents) {
      if (markers.has(incident.id)) continue;
      if (!incident.lat || !incident.lon) continue;

      const color = ACTOR_COLORS[incident.actorClaimed] ?? "#6b7280";
      // Radius: 5 base + scales with confidence (max 20)
      const radius = 5 + (incident.confidence / 100) * 15;

      const marker = window.L.circleMarker([incident.lat, incident.lon], {
        radius,
        color,
        fillColor: color,
        fillOpacity: 0.6,
        weight: 1.5,
        opacity: 0.9,
        className: "incident-marker",
      });

      const icon = EVENT_TYPE_ICONS[incident.eventType] ?? "💥";
      const statusColor: Record<string, string> = {
        confirmed: "#22c55e",
        reported: "#3b82f6",
        disputed: "#f97316",
        unverified: "#6b7280",
      };

      marker.bindTooltip(
        `<div style="font-family:monospace;font-size:11px;color:#e2e8f0">
          <strong>${icon} ${incident.locationName}</strong><br/>
          <span style="color:${color};font-size:10px;text-transform:uppercase;letter-spacing:0.08em">
            ${incident.actorClaimed}
          </span> &bull; ${incident.eventType}<br/>
          <span style="color:${statusColor[incident.verificationStatus] ?? "#6b7280"};font-size:10px">
            ${incident.verificationStatus.toUpperCase()}
          </span> &bull; ${incident.confidence}% confidence
        </div>`,
        { permanent: false, direction: "top" }
      );

      marker.on("click", () => {
        onIncidentClick(incident);
      });

      // Pulse effect on new incidents (added in last 5 min)
      const isRecent =
        Date.now() - new Date(incident.happenedAt).getTime() < 300_000;
      if (isRecent) {
        marker.setStyle({ weight: 3, opacity: 1 });
      }

      marker.addTo(map);
      markers.set(incident.id, marker);
    }
  }, [incidents, onIncidentClick]);

  return (
    <div
      ref={mapRef}
      className="w-full h-full"
      style={{ background: "#050a14" }}
    />
  );
}
