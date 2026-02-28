"use client";

import { useEffect, useRef } from "react";
import type { Incident } from "@/types";
import { ACTOR_COLORS, EVENT_TYPE_ICONS } from "@/types";

interface Props {
  incidents: Incident[];
  onIncidentClick: (incident: Incident) => void;
}

export default function WarMap({ incidents, onIncidentClick }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletMap = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<Map<string, any>>(new Map());
  const onClickRef = useRef(onIncidentClick);
  onClickRef.current = onIncidentClick;

  // ─── Init map once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    // Dynamic import avoids SSR issues; CSS is bundled via webpack
    import("leaflet").then((L) => {
      if (!mapRef.current || leafletMap.current) return;

      const map = L.map(mapRef.current, {
        center: [29.5, 38.0],
        zoom: 5,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 19,
        }
      ).addTo(map);

      leafletMap.current = map;
    });

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
        markersRef.current.clear();
      }
    };
  }, []);

  // ─── Update markers when incidents change ────────────────────────────────
  useEffect(() => {
    if (!leafletMap.current) return;

    import("leaflet").then((L) => {
      const map = leafletMap.current;
      if (!map) return;
      const markers = markersRef.current;

      // Remove stale markers
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
        const radius = 5 + (incident.confidence / 100) * 15;

        const marker = L.circleMarker([incident.lat, incident.lon], {
          radius,
          color,
          fillColor: color,
          fillOpacity: 0.65,
          weight: 1.5,
          opacity: 0.9,
        });

        const icon = EVENT_TYPE_ICONS[incident.eventType] ?? "💥";
        const statusColors: Record<string, string> = {
          confirmed: "#22c55e",
          reported: "#3b82f6",
          disputed: "#f97316",
          unverified: "#6b7280",
        };

        marker.bindTooltip(
          `<div style="font-family:monospace;font-size:11px;color:#e2e8f0;padding:4px 6px">
            <strong>${icon} ${incident.locationName}</strong><br/>
            <span style="color:${color};font-size:10px;text-transform:uppercase">${incident.actorClaimed}</span>
            &bull; ${incident.eventType}<br/>
            <span style="color:${statusColors[incident.verificationStatus] ?? "#6b7280"};font-size:10px">${incident.verificationStatus.toUpperCase()}</span>
            &bull; ${incident.confidence}% confidence
          </div>`,
          { permanent: false, direction: "top" }
        );

        marker.on("click", () => onClickRef.current(incident));
        marker.addTo(map);
        markers.set(incident.id, marker);
      }
    });
  }, [incidents]);

  return (
    <div
      ref={mapRef}
      className="w-full h-full"
      style={{ background: "#050a14" }}
    />
  );
}
