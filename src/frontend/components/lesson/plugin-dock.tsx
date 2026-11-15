import { useDockWidth } from "@/frontend/components/cheat-sheet/use-dock-width";
import { PluginFrame } from "@/frontend/components/plugins/plugin-frame";
import type { PluginContext } from "@/frontend/components/plugins/plugin-frame-model";
import { Pane } from "@/frontend/components/ui/pane";
import type { ShownPlugin } from "@/frontend/lib/use-plugins-at";

/** A plugin's page in the cheat sheet's dock. The lit word in the lesson bar names it and closes it. */
export function PluginDock({ plugin, context }: { plugin: ShownPlugin; context: PluginContext }) {
	const [width] = useDockWidth();
	return (
		<Pane data-testid="plugin-dock" aria-label={plugin.name} style={{ "--lh-dock-w": `${width}px` } as React.CSSProperties} className="lh-sheet-dock flex h-full min-h-0 shrink-0 flex-col overflow-hidden">
			<PluginFrame manifest={plugin.manifest} values={plugin.values} context={context} className="min-h-0 flex-1" />
		</Pane>
	);
}
