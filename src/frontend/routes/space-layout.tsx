import { Outlet, useLocation } from "react-router";
import { SpaceHead } from "@/frontend/components/space-page/space-head";
import { SpaceWorkFrame } from "@/frontend/components/work/space-work-frame";

/** Every space page: the space's head and tabs, then the tab's page, in
 *  the work frame while the space is being worked on. */
export function SpaceLayout() {
	const wide = useLocation().pathname === "/graph";
	return (
		<div className="flex h-full flex-col">
			<SpaceHead />
			<div className="min-h-0 flex-1">
				<SpaceWorkFrame wide={wide}>
					<Outlet />
				</SpaceWorkFrame>
			</div>
		</div>
	);
}
