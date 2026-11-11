import type { Metadata } from "next";
import { ClassOverview } from "@/frontend/components/overview/class-overview";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Progress" };

/** The class's Progress tab. */
export default function ClassOverviewPage() {
	return <ClassOverview />;
}
