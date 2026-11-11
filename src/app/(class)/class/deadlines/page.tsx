import type { Metadata } from "next";
import { DeadlinesTab } from "@/frontend/components/class-page/deadlines-tab";

export const metadata: Metadata = { title: "Deadlines" };

/** The class's Deadlines tab. */
export default function ClassDeadlinesPage() {
	return (
		<div className="h-full overflow-y-auto">
			<h1 className="sr-only">Deadlines</h1>
			<DeadlinesTab />
		</div>
	);
}
