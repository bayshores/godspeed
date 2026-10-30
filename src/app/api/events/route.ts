/**
 * THE NOTIFICATION CHANNEL ROUTE: one SSE connection per open window over
 * the core event bus, which the chat view, sidebar and activity dock
 * subscribe to. The response plumbing lives in the
 * server seam (events-stream.ts); the framework route stays a thin
 * wrapper (the import law; tests drive the seam directly).
 */
import { eventsResponse } from "@/server";

export const dynamic = "force-dynamic";

export function GET(): Response {
	return eventsResponse();
}
