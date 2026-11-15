import type { PluginManifest } from "@/frontend/lib/plugins-api";

/** A choice of this many options or fewer sits side by side; more open as a list. */
export const SEGMENTED_MAX = 4;

function joinWords(words: string[]): string {
	return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** What godspeed says about a plugin from its manifest, never the plugin's own words: where it
 *  shows and what it uses. */
export function pluginFacts(manifest: PluginManifest, agentName?: string): string {
	const places = [manifest.lesson && "lessons", manifest.space && "spaces"].filter((p): p is string => !!p);
	const uses = [
		...(manifest.uses.includes("agent") ? [agentName?.trim() || "your agent"] : []),
		...(manifest.uses.includes("space") ? ["the space's facts"] : []),
		...manifest.network,
	];
	return [places.length > 0 && `Shows in ${joinWords(places)}.`, uses.length > 0 && `Uses ${joinWords(uses)}.`].filter(Boolean).join(" ");
}

/** The line under a plugin's name: its own sentence, then godspeed's facts. */
export function pluginLine(manifest: PluginManifest, agentName?: string): string {
	const about = /[.!?]$/.test(manifest.description) ? manifest.description : `${manifest.description}.`;
	return `${about} ${pluginFacts(manifest, agentName)}`;
}
