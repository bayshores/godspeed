/**
 * GET /api/boot — what the window needs before its first paint, read once
 * per page load and again when onboarding finishes (src/backend/server/boot.ts).
 */
import { bootInfo } from "@/backend/server/boot";

export const dynamic = "force-dynamic";

export function GET() {
	return Response.json(bootInfo(), { headers: { "Cache-Control": "no-store" } });
}
