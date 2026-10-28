import { ClassOverview } from "@/components/overview/class-overview";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

/** The class's Overview page — opened from the sidebar's Overview row. */
export default function ClassOverviewPage() {
	return <ClassOverview />;
}
