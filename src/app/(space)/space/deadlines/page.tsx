import type { Metadata } from "next";
import { DeadlinesTab } from "@/frontend/components/space-page/deadlines-tab";

export const metadata: Metadata = { title: "Deadlines" };

/** The space's Deadlines tab. */
export default function SpaceDeadlinesPage() {
	return (
		<div className="h-full overflow-y-auto">
			<h1 className="sr-only">Deadlines</h1>
			<DeadlinesTab />
		</div>
	);
}
