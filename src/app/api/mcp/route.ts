/**
 * /api/mcp — the MCP endpoint for outside agents (src/backend/server/mcp.ts).
 * Thin transport: the server module owns access control and the tools.
 */
import { handleMcpRequest } from "@/backend/server";

export const dynamic = "force-dynamic";

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
