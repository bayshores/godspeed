import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PluginFrame } from "@/frontend/components/plugins/plugin-frame";
import type { PluginContext } from "@/frontend/components/plugins/plugin-frame-model";
import { usePresence } from "@/frontend/components/presence";
import { sessionFindHasForegroundLayer } from "@/frontend/components/session-find";
import { BarWindow, barBottom, observeBar } from "@/frontend/components/ui/bar-window";
import type { ShownPlugin } from "@/frontend/lib/use-plugins-at";
import { stripWidth } from "@/frontend/components/strip/strip-dom";
import { pluginWindowBox } from "./plugin-window-model";

/** The plugin's word, among the lesson's words in the top bar. */
export const pluginWordTestId = (id: string) => `lesson-plugin-${id}`;

/**
 * A lesson plugin's page, in a window hanging from the top bar under the plugin's lit word, as
 * tall as the page says it is. The word opens and closes it, and Escape closes it; it stays while
 * the learner works in the lesson.
 */
export function PluginWindow({ plugin, context, onClose }: { plugin: ShownPlugin | null; context: PluginContext; onClose: () => void }) {
	const presence = usePresence(plugin !== null);
	// The last one opened stays on screen while it goes back up into the bar.
	const [last, setLast] = useState(plugin);
	if (plugin && plugin !== last) setLast(plugin);
	const shown = plugin ?? last;
	if (!presence.mounted || !shown) return null;
	return createPortal(<Window key={shown.id} plugin={shown} context={context} state={presence.state} onClose={onClose} />, document.body);
}

function Window({ plugin, context, state, onClose }: { plugin: ShownPlugin; context: PluginContext; state: "open" | "closed"; onClose: () => void }) {
	const [reported, setReported] = useState<number | null>(null);
	const [at, setAt] = useState<{ edge: number; width: number; height: number; strip: number; bar: number } | null>(null);

	// Before paint, so it opens in place.
	useLayoutEffect(() => {
		const place = () => {
			const word = document.querySelector(`[data-testid="${pluginWordTestId(plugin.id)}"]`)?.getBoundingClientRect().right;
			// While Find has the bar the word is gone, and the window stays where it was.
			setAt((now) => ({ edge: word ?? now?.edge ?? window.innerWidth, width: window.innerWidth, height: window.innerHeight, strip: stripWidth(), bar: barBottom() }));
		};
		place();
		const observer = new ResizeObserver(place);
		observeBar(observer);
		window.addEventListener("resize", place);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", place);
		};
	}, [plugin.id]);

	useEffect(() => {
		if (state !== "open") return;
		const onKey = (e: KeyboardEvent) => {
			// Find, a menu or a dialog closes first, and the agent's screen keeps its keys.
			if (e.key !== "Escape" || e.defaultPrevented || sessionFindHasForegroundLayer(document) || document.querySelector('[data-testid="session-find"]')) return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [state, onClose]);

	if (!at) return null;
	const box = pluginWindowBox(at.edge, at, at.bar, reported);
	return (
		<BarWindow
			right={box.right}
			width={box.width}
			height={box.height}
			state={state}
			data-testid="plugin-window"
			aria-label={plugin.name}
			className="transition-[height] duration-(--lh-dur) ease-(--lh-ease-out)"
		>
			<PluginFrame manifest={plugin.manifest} values={plugin.values} context={context} onSize={setReported} className="h-full justify-center py-0" />
		</BarWindow>
	);
}
