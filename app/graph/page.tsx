import { GraphScreen } from "@/components/graph/graph-screen";
import { readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

// Dynamic: whether models are set up is read per navigation (the
// practice buttons open the setup dialog until they are).
export const dynamic = "force-dynamic";

/** The class's topic Graph — opened from the sidebar's Graph row. */
export default function GraphPage() {
	return <GraphScreen initialConfigured={slotsConfigured(readSettingsRecord()?.models)} />;
}
