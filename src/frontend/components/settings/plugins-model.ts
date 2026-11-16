import type { InstalledPlugin, ListedPlugin, PluginManifest } from "@/frontend/lib/plugins-api";

/** A choice of this many options or fewer sits side by side; more open as a list. */
export const SEGMENTED_MAX = 4;

function joinWords(words: string[]): string {
	return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** What a manifest or a list entry says about a plugin. */
type About = Pick<PluginManifest, "description" | "network" | "uses">;

/** What godspeed says about a plugin from its manifest, never the plugin's own words: what it uses. */
export function pluginFacts(manifest: About, agentName?: string): string {
	const uses = [
		...(manifest.uses.includes("agent") ? [agentName?.trim() || "your agent"] : []),
		...(manifest.uses.includes("space") ? ["the space's facts"] : []),
		...manifest.network,
	];
	return uses.length > 0 ? `Uses ${joinWords(uses)}.` : "";
}

/** The line under a plugin's name: its own sentence, then godspeed's facts. */
export function pluginLine(manifest: About, agentName?: string): string {
	const about = /[.!?]$/.test(manifest.description) ? manifest.description : `${manifest.description}.`;
	return `${about} ${pluginFacts(manifest, agentName)}`.trim();
}

/** The listed plugins not installed yet, in the list's order: the Add sheet's rows. */
export function addable(listed: ListedPlugin[], installed: InstalledPlugin[]): ListedPlugin[] {
	return listed.filter((entry) => !installed.some((p) => p.id === entry.id));
}

/** What Add does: shows the Add sheet when the list has something to add, else opens the folder
 *  chooser, which only the desktop app has. Null: there is no Add. */
export function addAction(rows: number, canPickFolder: boolean): "sheet" | "chooser" | null {
	if (rows > 0) return "sheet";
	return canPickFolder ? "chooser" : null;
}

/** The entry an installed plugin can update to: it came from the list, and the list now names
 *  another repo, tag or folder for it. */
export function updateFor(plugin: InstalledPlugin, listed: ListedPlugin[]): ListedPlugin | null {
	const source = "manifest" in plugin ? plugin.source : undefined;
	const entry = listed.find((e) => e.id === plugin.id);
	return source && entry && (entry.repo !== source.repo || entry.tag !== source.tag || entry.path !== source.path) ? entry : null;
}
