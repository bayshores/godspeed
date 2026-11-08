import type { Metadata } from "next";
import { GraphScreen } from "@/frontend/components/graph/graph-screen";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "graph" };

/** The class's topic Graph — opened from the sidebar's Graph row. */
export default function GraphPage() {
	return <GraphScreen />;
}
