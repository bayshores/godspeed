/**
 * /api/mcp/forget — an outside agent lost its context (src/server/mcp.ts).
 */
import { handleAgentForget } from "@/server";

export const dynamic = "force-dynamic";

export const POST = handleAgentForget;
