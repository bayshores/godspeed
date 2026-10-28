import { GraphScreen } from "@/components/graph/graph-screen";
// The settings store alone — the @/src/server barrel would load the whole
// server (agent engine, MCP, extraction) just to read one field.
import { readSettingsRecord } from "@/src/server/settings-read";
import { slotsConfigured } from "@/src/core";

// Dynamic: whether models are set up is read per navigation (the
// practice buttons open the setup dialog until they are).
export const dynamic = "force-dynamic";

/** The class's topic Graph — opened from the sidebar's Graph row. */
export default function GraphPage() {
	return <GraphScreen initialConfigured={slotsConfigured(readSettingsRecord()?.models)} />;
}
