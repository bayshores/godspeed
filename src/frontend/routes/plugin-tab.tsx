import { useOutletContext, useParams } from "react-router";
import { LoadFailed } from "@/frontend/components/load-failed";
import { PickSpace } from "@/frontend/components/pick-space";
import { PluginFrame } from "@/frontend/components/plugins/plugin-frame";
import { useSpaces } from "@/frontend/components/space-context";
import { Pane } from "@/frontend/components/ui/pane";
import type { PluginsAt } from "@/frontend/lib/use-plugins-at";
import { NotFound } from "./not-found";
import { PageTitle } from "./page-title";

/** A plugin's own tab on the space's page: its page fills the area. A plugin that is gone or switched off is not found. */
export function PluginTab() {
	const { id } = useParams();
	const { plugins, reload } = useOutletContext<PluginsAt>();
	const { activeSpace } = useSpaces();
	if (plugins === undefined) return null;
	if (plugins === null) return <LoadFailed message="Couldn't load your plugins." onRetry={reload} className="px-6" />;
	const plugin = plugins.find((p) => p.id === id);
	if (!plugin) return <NotFound />;
	if (!activeSpace) {
		return (
			<div className="lh-page pt-(--lh-gap)">
				<PickSpace line={`Pick a space to open ${plugin.label}.`} />
			</div>
		);
	}
	return (
		<div className="lh-page h-full py-(--lh-gap)">
			<PageTitle page={plugin.label} />
			<Pane className="h-full overflow-hidden">
				<PluginFrame key={plugin.id} manifest={plugin.manifest} values={plugin.values} context={{ space: { id: activeSpace.id, name: activeSpace.name }, topic: null, question: null, lastAnswered: null, teacherMessage: null }} />
			</Pane>
		</div>
	);
}
