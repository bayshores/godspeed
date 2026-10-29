/**
 * PUT /api/settings/[section] — section-scoped record writes. One PUT
 * replaces ONE section replace-whole (absent fields = absent overrides);
 * sections are independent, so partial writes can never clobber each other.
 *
 *   section ∈ general | agent | appearance | graph | compaction
 *   Body: the complete desired section object. Parse + validate strictly
 *   (server/settings-body.ts): a bad shape/type is a 400 carrying the
 *   supported list where one exists.
 *
 * The static sibling (prompts) takes precedence over this dynamic segment —
 * Next resolves static routes first, so "prompts" never lands here.
 */

import {
	SETTINGS_SECTIONS,
	readSettingsRecord,
	writeSettingsRecord,
	type SettingsBodyResult,
} from "@/server";

export const dynamic = "force-dynamic";

/** One parser, result type erased to the common envelope. */
type AnySectionParser = (body: unknown) => SettingsBodyResult<unknown>;

export async function PUT(request: Request, ctx: { params: Promise<{ section: string }> }) {
	const { section } = await ctx.params;
	const parser = (SETTINGS_SECTIONS as Record<string, AnySectionParser>)[section];
	if (!parser) {
		return Response.json(
			{ error: `unknown settings section "${section}"`, supported: Object.keys(SETTINGS_SECTIONS) },
			{ status: 404 },
		);
	}
	const body = await request.json().catch(() => null);
	const parsed = parser(body);
	if (!parsed.ok) {
		return Response.json({ error: parsed.error }, { status: 400 });
	}
	const record = readSettingsRecord() ?? { version: 1 };
	const next = { ...record, [section]: parsed.settings };
	writeSettingsRecord(next);
	return Response.json({ settings: next });
}
