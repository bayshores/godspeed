import type { Metadata } from "next";
import { ClassSheetsPage } from "@/components/cheat-sheet/class-sheets";

export const metadata: Metadata = { title: "Cheat sheets" };

/** The class's Cheat sheets page, opened from the sidebar's Cheat sheets row. */
export default function ClassCheatSheetsPage() {
	return <ClassSheetsPage />;
}
