/**
 * /api/mcp-access — Settings → Outside agents: the access status and the
 * token (always present — outside-agent access is always on), plus
 * rotating the token. Desktop-window only like every /api route except
 * /api/mcp itself (proxy.ts).
 */
import { mcpAccessStatus, rotateMcpToken } from "@/server";

export const dynamic = "force-dynamic";

function view(req: Request) {
	return { ...mcpAccessStatus(), url: new URL("/api/mcp", req.url).toString().replace("//localhost:", "//127.0.0.1:") };
}

export async function GET(req: Request) {
	return Response.json(view(req), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
	const body = (await req.json().catch(() => ({}))) as { action?: unknown };
	if (body.action === "rotate") rotateMcpToken();
	else return Response.json({ error: 'action must be "rotate"' }, { status: 400 });
	return Response.json(view(req), { headers: { "Cache-Control": "no-store" } });
}
