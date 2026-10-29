/**
 * The Teaching section's writes: each composes the whole agent section
 * (the PUT replaces it) with one change.
 */

import type { AgentSettings, AreaId, PromptSegmentInfo, TeachingArea } from "@/core";

export function composeTool(agent: AgentSettings | undefined, id: string, on: boolean): AgentSettings {
	return { ...agent, tools: { ...agent?.tools, [id]: on } };
}

/** Exactly one quiz style is active: `explain: true` arms free recall
 *  (`quiz` itself is never written; agent/tools.ts swaps it). */
export function composeQuizStyle(agent: AgentSettings | undefined, style: "choice" | "free"): AgentSettings {
	return { ...agent, tools: { ...agent?.tools, explain: style === "free" } };
}

export function composeGraphTools(agent: AgentSettings | undefined, on: boolean): AgentSettings {
	return { ...agent, graphTools: { enabled: on } };
}

/** One area's rules replaced; an emptied area is dropped. */
export function composeRules(agent: AgentSettings | undefined, area: AreaId, rules: string[]): AgentSettings {
	const next = { ...agent?.rules };
	if (rules.length) next[area] = rules;
	else delete next[area];
	return { ...agent, rules: next };
}

/** The area's parts that exist in the current prompt, in panel order. */
export function areaParts(area: TeachingArea, segments: PromptSegmentInfo[]): PromptSegmentInfo[] {
	return area.parts.flatMap((path) => segments.filter((s) => s.path === path));
}
