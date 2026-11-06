/**
 * /api/mcp/forget — an outside agent lost its context (src/backend/server/mcp.ts).
 */
import { handleAgentForget } from "@/backend/server";

export const dynamic = "force-dynamic";

export const POST = handleAgentForget;
