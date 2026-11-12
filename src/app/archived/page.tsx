import type { Metadata } from "next";
import { ArchivedSpaces } from "@/frontend/components/archived-spaces";

export const metadata: Metadata = { title: "Archived spaces" };

export default function Archived() {
	return <ArchivedSpaces />;
}
