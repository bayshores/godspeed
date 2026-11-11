import type { Metadata } from "next";
import { ClassSheetsPage } from "@/frontend/components/cheat-sheet/class-sheets";

export const metadata: Metadata = { title: "Cheat sheets" };

/** The class's Cheat sheets tab. */
export default function ClassCheatSheetsPage() {
	return <ClassSheetsPage />;
}
