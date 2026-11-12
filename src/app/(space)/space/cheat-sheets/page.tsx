import type { Metadata } from "next";
import { SpaceSheetsPage } from "@/frontend/components/cheat-sheet/space-sheets";

export const metadata: Metadata = { title: "Cheat sheets" };

/** The space's Cheat sheets tab. */
export default function SpaceCheatSheetsPage() {
	return <SpaceSheetsPage />;
}
