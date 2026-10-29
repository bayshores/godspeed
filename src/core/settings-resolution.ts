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
 * - prompt switches: passed through; effective composition lives in
 *   src/store/prompt-overrides.ts (segment list derived from source).
 */

import {
	FACTORY_SETTINGS,
	type FactorySettings,
	type GeneralSettings,
	type CompactionSettings,
	type GraphSettings,
	type UserSettings,
} from "./settings.ts";

/** The concrete appearance view — same shape as the factory's. */
export type EffectiveAppearance = FactorySettings["appearance"];

/** The concrete view: every knob resolved, no absent fields. */
export interface EffectiveSettings {
	general: Required<Omit<GeneralSettings, "onboarded" | "lastSeenVersion">>;
	agent: {
		/** Delta map as stored — consumers resolve absent key → enabled. */
		tools: Record<string, boolean>;
		/** Delta map as stored — absent key → override off. */
		prompts: Record<string, boolean>;
		/** Prober graph tools: passthrough delta as stored —
		 * absent/undefined enabled = ON; consumers use graphToolsEnabled. */
		graphTools: { enabled?: boolean };
	};
	appearance: EffectiveAppearance;
	graph: Required<GraphSettings>;
	/** Compaction: resolved concrete — absent record
	 *  section resolves to the factory 150k. */
	compaction: Required<CompactionSettings>;
}

/** Resolve the whole record. `record` may be null (first boot) — every
 *  factory-defaulted field lands on its default. */
export function resolveSettings(record: UserSettings | null): EffectiveSettings {
	const agent = record?.agent ?? {};
	const appearance = record?.appearance ?? {};
	const md = appearance.mdRendering ?? {};
	const graph = record?.graph ?? {};
	const factoryAppearance = FACTORY_SETTINGS.appearance;
	const factoryMd = factoryAppearance.mdRendering;
	return {
		general: {
			autoUpdate: record?.general?.autoUpdate ?? FACTORY_SETTINGS.general.autoUpdate,
			activeClass: record?.general?.activeClass ?? FACTORY_SETTINGS.general.activeClass,
			teacherName: record?.general?.teacherName || FACTORY_SETTINGS.general.teacherName,
		},
		agent: {
			tools: agent.tools ?? {},
			prompts: agent.prompts ?? {},
			graphTools: agent.graphTools ?? {},
		},
		appearance: {
			mode: appearance.mode ?? factoryAppearance.mode,
			background: appearance.background ?? factoryAppearance.background,
			fontFamily: appearance.fontFamily ?? factoryAppearance.fontFamily,
			proseFontSize: appearance.proseFontSize ?? factoryAppearance.proseFontSize,
			sessionNameSerif: appearance.sessionNameSerif ?? factoryAppearance.sessionNameSerif,
			mdRendering: {
				headingWeight: md.headingWeight ?? factoryMd.headingWeight,
				boldColor: md.boldColor ?? factoryMd.boldColor,
				italicColor: md.italicColor ?? factoryMd.italicColor,
			},
		},
		graph: {
			enabled: graph.enabled ?? FACTORY_SETTINGS.graph.enabled,
			// The chunk budget: absent (older record, fresh install) resolves
			// to the factory 4096; the sanitizer has already clamped/floored
			// any stored value.
			extractionChunkTokens: graph.extractionChunkTokens ?? FACTORY_SETTINGS.graph.extractionChunkTokens,
		},
		compaction: {
			thresholdTokens: record?.compaction?.thresholdTokens ?? FACTORY_SETTINGS.compaction.thresholdTokens,
		},
	};
}

// ─── Graph channel gates ─────────────────────────────────────────────────────

/**
 * The WRITE channel gate (extraction): dies with the master
 * switch. Used by the chat-handler's post-turn trigger.
 */
export function extractionEnabled(graph: { enabled: boolean }): boolean {
	return graph.enabled;
}


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


