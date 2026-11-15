import { jsonInit, send, type WriteResult } from "./api";

/** A setting the plugin's manifest declares; godspeed draws its control. */
export type PluginSetting =
	| { key: string; label: string; kind: "toggle"; default: boolean; hint?: string }
	| { key: string; label: string; kind: "choice"; options: string[]; default: string; hint?: string }
	| { key: string; label: string; kind: "number"; min?: number; max?: number; default: number; hint?: string }
	| { key: string; label: string; kind: "text"; default: string; hint?: string };

/** The checked manifest.json, as the server keeps it. */
export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	description: string;
	author: string;
	entry: string;
	/** Where it shows; absent where it doesn't. */
	lesson?: { label: string };
	space?: { label: string };
	settings: PluginSetting[];
	/** Host names it may reach. */
	network: string[];
	/** "agent" and "space". */
	uses: string[];
}

export type SettingValue = boolean | number | string;

/** An installed plugin: its manifest, switch and setting values, and where it came from when that
 *  was godspeed's list; or why the manifest failed. */
export type InstalledPlugin =
	| { id: string; folder: string; manifest: PluginManifest; enabled: boolean; values: Record<string, SettingValue>; source?: { repo: string; tag: string; path?: string } }
	| { id: string; folder: string; error: string };

/** A plugin on godspeed's checked list: its GitHub repo and tag, the repo's folder it is in when
 *  it isn't at the top, and a copy of fields of its manifest at that tag. */
export type ListedPlugin = Pick<PluginManifest, "id" | "name" | "description" | "lesson" | "space" | "network" | "uses"> & { repo: string; tag: string; path?: string };

export type PluginResult = { error: string; plugin: null } | { error: null; plugin: InstalledPlugin };

/** Every installed plugin; null when the server doesn't answer. */
export async function fetchPlugins(): Promise<InstalledPlugin[] | null> {
	const { error, body } = await send("/api/plugins", { method: "GET" });
	return error ? null : (body as { plugins: InstalledPlugin[] }).plugins;
}

async function pluginReply(request: Promise<{ error: WriteResult; body: unknown }>): Promise<PluginResult> {
	const { error, body } = await request;
	return error ? { error, plugin: null } : { error: null, plugin: (body as { plugin: InstalledPlugin }).plugin };
}

/** Installs the plugin in a folder of the learner's. */
export function installPlugin(folder: string): Promise<PluginResult> {
	return pluginReply(send("/api/plugins", jsonInit("POST", { from: "folder", folder })));
}

/** godspeed's checked list; empty when it can't be read. */
export async function fetchListed(): Promise<ListedPlugin[]> {
	const { error, body } = await send("/api/plugin-list", { method: "GET" });
	return error ? [] : (body as { plugins: ListedPlugin[] }).plugins;
}

/** Installs the listed tag of the plugin on the list: an add, or an update of one installed from it. */
export function installListed(id: string): Promise<PluginResult> {
	return pluginReply(send("/api/plugins", jsonInit("POST", { from: "list", id })));
}

/** Changes its switch and/or setting values; the plugin comes back as stored. */
export function changePlugin(id: string, change: { enabled?: boolean; values?: Record<string, SettingValue> }): Promise<PluginResult> {
	return pluginReply(send(`/api/plugins/${encodeURIComponent(id)}`, jsonInit("PUT", change)));
}

/** Removes it and its stored data; null on success. */
export async function removePlugin(id: string): Promise<WriteResult> {
	return (await send(`/api/plugins/${encodeURIComponent(id)}`, { method: "DELETE" })).error;
}
