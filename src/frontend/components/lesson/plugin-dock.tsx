import { DOCK_DEFAULT_W } from "@/frontend/components/cheat-sheet/dock-model";
import { PluginFrame } from "@/frontend/components/plugins/plugin-frame";
import type { PluginContext } from "@/frontend/components/plugins/plugin-frame-model";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import type { ShownPlugin } from "@/frontend/lib/use-plugins-at";

/** A plugin's page in the cheat sheet's dock: its name, then the page. */
export function PluginDock({ plugin, context, onClose }: { plugin: ShownPlugin; context: PluginContext; onClose: () => void }) {
	return (
		<Pane data-testid="plugin-dock" aria-label={plugin.name} style={{ "--lh-dock-w": `${DOCK_DEFAULT_W}px` } as React.CSSProperties} className="lh-sheet-dock flex h-full min-h-0 shrink-0 flex-col">
			<header className="flex shrink-0 items-center gap-2 pt-4 pr-3 pb-1 pl-5">
				<h2 className="min-w-0 flex-1 truncate text-xl leading-snug text-ink">{plugin.name}</h2>
				<button type="button" data-testid="plugin-dock-close" onClick={onClose} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
					<PixelIcon name="close" />
					Close
				</button>
			</header>
			<div className="min-h-0 flex-1">
				<PluginFrame manifest={plugin.manifest} values={plugin.values} context={context} />
			</div>
		</Pane>
	);
}
