import type { Metadata } from "next";
import { SpaceHome } from "@/frontend/components/space-page/space-home";

// Dynamic: the root layout reads the settings record per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Progress" };

/** The space's first tab: Progress, or a prep's sheet. */
export default function SpaceHomePage() {
	return <SpaceHome />;
}
