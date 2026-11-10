/**
 * /api/mcp/compacting — an outside agent started compacting its context (src/backend/server/mcp.ts).
 */
import { handleAgentCompacting } from "@/backend/server";

export const dynamic = "force-dynamic";

export const POST = handleAgentCompacting;
