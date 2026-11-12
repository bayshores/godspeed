"use client";

import { useSpaces } from "@/frontend/components/space-context";
import { SpaceOverview } from "@/frontend/components/overview/space-overview";
import { PrepSheet } from "@/frontend/components/prep/prep-sheet";

/** A space's first tab: its Progress, or a prep's sheet. */
export function SpaceHome() {
	const { activeSpace } = useSpaces();
	return activeSpace?.prep ? <PrepSheet key={activeSpace.id} spaceId={activeSpace.id} /> : <SpaceOverview />;
}
