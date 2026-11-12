import type { Metadata } from "next";
import { GraphScreen } from "@/frontend/components/graph/graph-screen";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Graph" };

/** The space's Graph tab: its topics and facts. */
export default function GraphPage() {
	return <GraphScreen />;
}
