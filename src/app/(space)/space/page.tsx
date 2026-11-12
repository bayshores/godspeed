import type { Metadata } from "next";
import { SpaceOverview } from "@/frontend/components/overview/space-overview";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Progress" };

/** The space's Progress tab. */
export default function SpaceOverviewPage() {
	return <SpaceOverview />;
}
