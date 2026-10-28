/**
 * PUT /api/settings/[section] — section-scoped record writes
 * (settings-storage wave, 2026-09-19). One PUT replaces ONE section
 * replace-whole (absent fields = absent overrides — the house settings
 * discipline, same as the per-chat and defaults routes); sections are
 * independent, so partial writes can never clobber each other.
 *
 *   section ∈ general | agent | appearance | graph | compaction
 *   Body: the complete desired section object. Parse + validate strictly
 *   (server/settings-body.ts): a bad shape/type is a 400 carrying the
 *   supported list where one exists. The agent section additionally validates prompt
 *   switches — under the orphan-heal contract (interlude 2026-09-26): an
 *   ON switch with its override file present is valid as-is; an ON whose
 *   file is gone (deleted outside the app, a disk wipe, or a record from
 *   before the delete-clears-switch fix) is an ORPHAN and is healed to
 *   OFF (the key drops) inside the same write — never a 400. Invariant:
 *   a user can never get stuck unable to write settings, and switch
 *   state never contradicts file reality for long (the delete route
 *   clears the switch by construction; this is the backstop).
 *
 * The static siblings (defaults, prompts) take precedence over this
 * dynamic segment — Next resolves static routes first, so "prompts" never
 * lands here.
 */

import type { AgentSettings } from "@/core";
import {
	SETTINGS_SECTIONS,
	allSegmentPaths,
	promptOverrides,
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
	let agentHealed: AgentSettings | undefined;

	// Section-specific cross-validation (against the prompt store) — the
	// parsers only see shapes.
	if (section === "agent") {
		// Orphan-heal (contract fix, interlude 2026-09-26): an ON switch
		// whose override file is gone (or whose segment left the source
		// tree) is healed to OFF (key dropped) inside this write — never a
		// 400. The old 400 trapped users: the record's own orphaned ON was
		// mirrored back by every write while the disabled toggle couldn't
		// reach the OFF escape hatch. An ON with a real file stays valid.
		const agent = parsed.settings as AgentSettings;
		const segments = new Set(allSegmentPaths());
		const orphans: string[] = [];
		for (const [path, on] of Object.entries(agent.prompts ?? {})) {
			if (on && (!segments.has(path) || promptOverrides.readOverride(path) === null)) orphans.push(path);
		}
		if (orphans.length > 0) {
			const prompts = { ...(agent.prompts ?? {}) };
			for (const path of orphans) delete prompts[path];
			agentHealed = { ...agent, prompts };
			console.info(`[settings] healed orphaned prompt switch(es) to off: ${orphans.join(", ")}`);
		}
	}

	// The agent section lands HEALED when orphaned prompt switches were
	// found above (the healed copy) — after every write the record and
	// file reality agree.
	const sectionOut = section === "agent" && agentHealed ? agentHealed : parsed.settings;

	// Read-modify-write ONE section of the record; everything else rides
	// along untouched (other sections, unknown keys — sanitize preserves).
	const record = readSettingsRecord() ?? { version: 1 };
	const next = { ...record, [section]: sectionOut };
	writeSettingsRecord(next);
	return Response.json({ settings: next });
}
