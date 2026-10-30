/**
 * THE REATTACH STREAM, and the only turn wire: POST /api/chat
 * acknowledges and closes, so the
 * submitter too attaches here. One SSE stream per chat: a running turn →
 * subscribe to the live turn object: FULL replay of the event log, then
 * live chunks until settle ([DONE]). No running turn → the cheap terminal
 * ({"type":"turn-settled"} + [DONE]): the client refetches the record.
 * A retained settlement-failure notice precedes that terminal when a
 * reply could not be saved before the submitter attached.
 *
 * 404 mirrors the POST handler's unknown-chat. Framework route is a thin
 * wrapper over the server barrel (the import law); tests drive the seams
 * (turn-runs + ui-stream) directly.
 */
import { getChat, runningTurn, piTurnResponse, settledTurnResponse } from "@/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	if (!getChat(id)) return Response.json({ error: "Unknown chat" }, { status: 404 });
	const handle = runningTurn(id);
	if (!handle) return settledTurnResponse(id);
	return piTurnResponse(handle);
}
