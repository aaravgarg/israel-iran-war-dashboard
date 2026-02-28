/**
 * SSE endpoint — clients connect and receive real-time updates.
 * Sends a heartbeat every 25s and pushes updates when the pipeline runs.
 */
import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { startPipeline } from "@/lib/pipeline";

startPipeline();

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection confirmation
      const hello = JSON.stringify({
        type: "connected",
        data: {
          message: "WARMON feed connected",
          pipeline: store.pipeline,
          ts: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      });
      controller.enqueue(encoder.encode(`data: ${hello}\n\n`));

      // Register this client
      function send(msg: string) {
        controller.enqueue(encoder.encode(msg));
      }
      store.sseClients.add(send);

      // Heartbeat every 25s
      const heartbeat = setInterval(() => {
        try {
          const hb = JSON.stringify({
            type: "heartbeat",
            data: { ts: new Date().toISOString() },
            timestamp: new Date().toISOString(),
          });
          controller.enqueue(encoder.encode(`data: ${hb}\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      // Cleanup on disconnect
      return () => {
        clearInterval(heartbeat);
        store.sseClients.delete(send);
      };
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
