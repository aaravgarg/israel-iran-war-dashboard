"use client";
import dynamic from "next/dynamic";

// Dashboard is fully client-side (needs window/SSE/Leaflet)
const Dashboard = dynamic(() => import("@/components/Dashboard"), {
  ssr: false,
  loading: () => (
    <div className="h-screen w-screen bg-war-bg flex items-center justify-center">
      <div className="text-war-blue font-mono text-sm tracking-widest animate-pulse">
        INITIALIZING WARMON...
      </div>
    </div>
  ),
});

export default function Home() {
  return <Dashboard />;
}
