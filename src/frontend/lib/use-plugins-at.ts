import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPlugins, type InstalledPlugin, type PluginManifest, type SettingValue } from "./plugins-api";

/** Where a plugin can show. */
type Place = "lesson" | "space";

/** An installed plugin that is on and shows in one place, under that place's label. */
export interface ShownPlugin {
	id: string;
	name: string;
	label: string;
	manifest: PluginManifest;
	values: Record<string, SettingValue>;
}

/** The plugins that are on and show in `place`, in install order. */
export function pluginsAt(plugins: readonly InstalledPlugin[], place: Place): ShownPlugin[] {
	return plugins.flatMap((p) => {
		if ("error" in p || !p.enabled) return [];
		const where = p.manifest[place];
		return where ? [{ id: p.id, name: p.manifest.name, label: where.label, manifest: p.manifest, values: p.values }] : [];
	});
}

/** What a screen reads: the plugins shown there, `undefined` while loading, `null` when the server didn't answer. */
export interface PluginsAt {
	plugins: ShownPlugin[] | null | undefined;
	reload: () => void;
}

/** Reads the installed plugins each time the screen opens, so a switch in Settings shows next time.
 *  A screen whose loader read them passes them as `loaded` and opens with them. */
export function usePluginsAt(place: Place, loaded?: InstalledPlugin[] | null): PluginsAt {
	const [all, setAll] = useState(loaded);
	const reload = useCallback(() => void fetchPlugins().then(setAll), []);
	const read = loaded !== undefined;
	useEffect(() => {
		if (!read) reload();
	}, [read, reload]);
	const plugins = useMemo(() => (all ? pluginsAt(all, place) : all), [all, place]);
	return { plugins, reload };
}
