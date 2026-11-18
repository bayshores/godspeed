import { Outlet } from "react-router";
import { SpaceHead } from "@/frontend/components/space-page/space-head";
import { SpaceWorkFrame } from "@/frontend/components/work/space-work-frame";
import { usePluginsAt } from "@/frontend/lib/use-plugins-at";

/** Every space page: the space's head and tabs, then the tab's page, in
 *  the work frame while the space is being worked on. The plugins that show
 *  in spaces are read once and handed to the head and to a plugin's tab. */
export function SpaceLayout() {
	const pluginsAt = usePluginsAt("space");
	return (
		<div className="flex h-full flex-col">
			<SpaceHead plugins={pluginsAt.plugins ?? []} />
			<div className="min-h-0 flex-1">
				<SpaceWorkFrame>
					<Outlet context={pluginsAt} />
				</SpaceWorkFrame>
			</div>
		</div>
	);
}
