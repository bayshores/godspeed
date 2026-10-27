/**
 * /api/mcp-access — Settings → Agents: outside-agent access status and
 * controls (turn on, rotate the token, turn off). Desktop-window only like
 * every /api route except /api/mcp itself (src/proxy.ts).
 */
import { disableMcpAccess, enableMcpAccess, mcpAccessStatus, rotateMcpToken } from "@/server";

export const dynamic = "force-dynamic";

function view(req: Request) {
	return { ...mcpAccessStatus(), url: new URL("/api/mcp", req.url).toString().replace("//localhost:", "//127.0.0.1:") };
}

export async function GET(req: Request) {
	return Response.json(view(req), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { action?: unknown };
	if (body.action === "enable") enableMcpAccess();
	else if (body.action === "rotate") rotateMcpToken();
	else if (body.action === "disable") disableMcpAccess();
	else return Response.json({ error: 'action must be "enable", "rotate", or "disable"' }, { status: 400 });
	return Response.json(view(req), { headers: { "Cache-Control": "no-store" } });
}
