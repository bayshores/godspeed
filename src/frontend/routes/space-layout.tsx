import { Outlet, useLocation } from "react-router";
import { Travel } from "@/frontend/components/travel/travel";
import { useSpaces } from "@/frontend/components/space-context";
import { SpaceHead } from "@/frontend/components/space-page/space-head";
import { spaceTabs } from "@/frontend/components/space-page/space-head-model";
import { SpaceWorkFrame } from "@/frontend/components/work/space-work-frame";
import { usePluginsAt } from "@/frontend/lib/use-plugins-at";

/** Every space page: the space's head and tabs, then the tab's page, in
 *  the work frame while the space is being worked on. The plugins that show
 *  in spaces are read once and handed to the head and to a plugin's tab. The
 *  head stays still while the tab's page travels under it, in the order of
 *  the tabs; another space starts its own. */
export function SpaceLayout() {
	const pluginsAt = usePluginsAt("space");
	const { pathname } = useLocation();
	const { active, activeSpace } = useSpaces();
	const column = spaceTabs(activeSpace ? "space" : "none", pluginsAt.plugins ?? []).findIndex((t) => t.href === pathname);
	return (
		<div className="flex h-full flex-col">
			<SpaceHead plugins={pluginsAt.plugins ?? []} />
			<div className="min-h-0 flex-1">
				<SpaceWorkFrame>
					<Travel key={active ?? "none"} place={{ key: pathname, depth: 0, column }}>
						<Outlet context={pluginsAt} />
					</Travel>
				</SpaceWorkFrame>
			</div>
		</div>
	);
}
