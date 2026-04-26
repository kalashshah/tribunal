// Server-Sent Events relay: long-polls the clerk's AXL `/recv` endpoint and
// streams events for the requested caseId to the browser. Filters by
// payload.meta.caseId so multiple cases can run in parallel without
// cross-talk.

import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const CLERK_AXL_URL = process.env.AXL_PORT_CLERK_URL ?? "http://127.0.0.1:9002";

export async function GET(req: NextRequest, ctx: { params: { caseId: string } }) {
  const wantedCaseId = ctx.params.caseId;
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let stopped = false;
      req.signal.addEventListener("abort", () => { stopped = true; });

      while (!stopped) {
        try {
          const r = await fetch(`${CLERK_AXL_URL}/recv`);
          if (r.status === 204 || !r.ok) {
            await new Promise((res) => setTimeout(res, 250));
            continue;
          }
          const text = await r.text();
          let payload: any;
          try { payload = JSON.parse(text); } catch { payload = text; }
          if (payload?.meta?.caseId == null || String(payload.meta.caseId) === wantedCaseId) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          }
        } catch {
          await new Promise((res) => setTimeout(res, 500));
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
    },
  });
}
