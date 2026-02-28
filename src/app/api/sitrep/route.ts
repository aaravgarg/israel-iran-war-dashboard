import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { startPipeline } from "@/lib/pipeline";

startPipeline();

export async function GET() {
  if (!store.sitrep) {
    return NextResponse.json({
      summary: "Pipeline is initializing. Check back in a moment.",
      keyDevelopments: [],
      threatLevel: "medium",
      generatedAt: new Date().toISOString(),
      basedOnArticles: 0,
      disclaimer: "AI-generated summary — always verify with primary sources.",
    });
  }
  return NextResponse.json(store.sitrep);
}
