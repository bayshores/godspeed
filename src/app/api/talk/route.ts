/**
 * The Talk chat in the teacher's panel.
 *   POST   → the chat (made on first use): id, messages, turnInFlight, turnError.
 *   DELETE → Clear: empties it (409 while the teacher is replying).
 */
import { clearTalk, openTalk } from "@/backend/server";

export const dynamic = "force-dynamic";

export async function POST() {
	return Response.json(openTalk());
}

export async function DELETE() {
	const outcome = await clearTalk();
	return outcome.ok ? Response.json({ ok: true }) : Response.json({ error: outcome.error }, { status: outcome.status });
}
