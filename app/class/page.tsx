import { ClassOverview } from "@/components/overview/class-overview";
import { slotsConfigured } from "@/src/core";
// The settings store alone — the @/src/server barrel would load the whole
// server (agent engine, MCP, extraction) just to read one field.
import { readSettingsRecord } from "@/src/server/settings-read";

// Dynamic: "Learn this" needs the configured state on the first frame
// (the same first-run gate the new-lesson draft reads).
export const dynamic = "force-dynamic";

/** The class's Overview page — opened from the sidebar's Overview row. */
export default function ClassOverviewPage() {
	return <ClassOverview initialConfigured={slotsConfigured(readSettingsRecord()?.models)} />;
}
