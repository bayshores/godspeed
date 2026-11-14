/**
 * THE SETTINGS RESOLUTION LAYER: pure
 * projection of the delta record (core/settings.ts UserSettings) into
 * EffectiveSettings — every field CONCRETE, ready for consumers with no
 * delta-walking of their own.
 *
 * Resolution rule: explicit value in the record wins;
 * absent key resolves to the compiled factory default. There are no model
 * settings to resolve: the outside agent (MCP) is the only model.
 * This module stays browser-safe/pure.
 *
 * Deliberately NOT resolved here (see settings.ts module doc):
 * - tool toggles: passed through as the delta map; consumers look up by
 *   tool id with absent → enabled (the honoring lives in the agent band);
 * - rules: passed through; the prompt section is built in teaching-areas.ts.
 */

import {
	FACTORY_SETTINGS,
	type FactorySettings,
	type GeneralSettings,
	type GraphSettings,
	type UserSettings,
} from "./settings.ts";
import type { AreaRules } from "./teaching-areas.ts";

/** The concrete appearance view — same shape as the factory's. */
export type EffectiveAppearance = FactorySettings["appearance"];

/** The concrete view: every knob resolved, no absent fields. */
interface EffectiveSettings {
	general: Required<Omit<GeneralSettings, "onboarded" | "lastSeenVersion">>;
	agent: {
		/** Delta map as stored — consumers resolve absent key → enabled. */
		tools: Record<string, boolean>;
		/** The learner's rules per area (absent area = none). */
		rules: AreaRules;
		/** Prober graph tools: passthrough delta as stored —
		 * absent/undefined enabled = ON; consumers use graphToolsEnabled. */
		graphTools: { enabled?: boolean };
	};
	appearance: EffectiveAppearance;
	graph: Required<GraphSettings>;
}

/** Resolve the whole record. `record` may be null (first boot) — every
 *  factory-defaulted field lands on its default. */
export function resolveSettings(record: UserSettings | null): EffectiveSettings {
	const agent = record?.agent ?? {};
	const appearance = record?.appearance ?? {};
	const graph = record?.graph ?? {};
	const factoryAppearance = FACTORY_SETTINGS.appearance;
	return {
		general: {
			autoUpdate: record?.general?.autoUpdate ?? FACTORY_SETTINGS.general.autoUpdate,
			activeSpace: record?.general?.activeSpace ?? FACTORY_SETTINGS.general.activeSpace,
			teacherName: record?.general?.teacherName || FACTORY_SETTINGS.general.teacherName,
			sounds: record?.general?.sounds ?? FACTORY_SETTINGS.general.sounds,
			deadlineReminders: record?.general?.deadlineReminders ?? FACTORY_SETTINGS.general.deadlineReminders,
		},
		agent: {
			tools: agent.tools ?? {},
			rules: agent.rules ?? {},
			graphTools: agent.graphTools ?? {},
		},
		appearance: {
			background: appearance.background ?? factoryAppearance.background,
			fontFamily: appearance.fontFamily ?? factoryAppearance.fontFamily,
			proseFontSize: appearance.proseFontSize ?? factoryAppearance.proseFontSize,
		},
		graph: {
			enabled: graph.enabled ?? FACTORY_SETTINGS.graph.enabled,
		},
	};
}

// ─── Graph tools gate ────────────────────────────────────────────────────────

/**
 * The PROBER GRAPH TOOLS gate: the
 * toggle is an agent-capability switch (it gates tool registration), but
 * the tools only mean anything when the graph itself runs — so the
 * effective gate composes the graph master switch AND the toggle.
 * Teacher's tool factories consume this at registration time.
 */
export function graphToolsEnabled(effective: {
	graph: { enabled: boolean };
	agent: { graphTools: { enabled?: boolean } };
}): boolean {
	return effective.graph.enabled && (effective.agent.graphTools.enabled ?? true);
}

