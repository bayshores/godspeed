import { Home } from "@/components/home";
// The settings store alone — the @/src/server barrel would load the whole
// server (agent engine, MCP, extraction) just to read one field.
import { readSettingsRecord } from "@/src/server/settings-read";
import { slotsConfigured } from "@/src/core";

// Dynamic: the configured state is server-rendered into the page (the
// setup CTA's truth on the first frame), and every navigation re-reads
// the record (dynamic routes aren't cached client-side).
export const dynamic = "force-dynamic";

export default function HomePage() {
	// First-run gate (model-slots wave): chats cannot start until the user
	// has picked all three slots — the dock shows the CTA while the raw
	// record's models section lacks any slot pin.
	const record = readSettingsRecord();
	return <Home initialConfigured={slotsConfigured(record?.models)} />;
}
