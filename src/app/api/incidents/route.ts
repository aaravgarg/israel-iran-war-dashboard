import { NextRequest, NextResponse } from "next/server";
import { getIncidents, store } from "@/lib/store";
import { startPipeline } from "@/lib/pipeline";
import type { Actor, EventType, VerificationStatus } from "@/types";

startPipeline();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const actor = searchParams.get("actor") as Actor | null;
  const type = searchParams.get("type") as EventType | null;
  const status = searchParams.get("status") as VerificationStatus | null;
  const confidenceGte = searchParams.get("confidence_gte");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let incidents = getIncidents();

  if (actor) incidents = incidents.filter((i) => i.actorClaimed === actor);
  if (type) incidents = incidents.filter((i) => i.eventType === type);
  if (status) incidents = incidents.filter((i) => i.verificationStatus === status);
  if (confidenceGte) {
    const min = parseInt(confidenceGte);
    incidents = incidents.filter((i) => i.confidence >= min);
  }
  if (from) {
    const fromDate = new Date(from).getTime();
    incidents = incidents.filter(
      (i) => new Date(i.happenedAt).getTime() >= fromDate
    );
  }
  if (to) {
    const toDate = new Date(to).getTime();
    incidents = incidents.filter(
      (i) => new Date(i.happenedAt).getTime() <= toDate
    );
  }

  return NextResponse.json({
    incidents: incidents.slice(0, 200),
    total: incidents.length,
    lastUpdated: store.pipeline.lastRun ?? new Date().toISOString(),
    nextRefreshAt:
      store.pipeline.nextRun ??
      new Date(Date.now() + 600_000).toISOString(),
  });
}
