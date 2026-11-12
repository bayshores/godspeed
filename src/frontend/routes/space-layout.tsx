import { Outlet } from "react-router";
import { SpaceHead } from "@/frontend/components/space-page/space-head";
import { TeacherWork } from "@/frontend/components/teacher-work/teacher-work";

/** Every space page: the space's head and tabs, the teacher's work on the
 *  space when there is some, then the tab's page. */
export function SpaceLayout() {
	return (
		<div className="flex h-full flex-col">
			<SpaceHead />
			<TeacherWork />
			<div className="min-h-0 flex-1">
				<Outlet />
			</div>
		</div>
	);
}
