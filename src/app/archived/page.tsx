import type { Metadata } from "next";
import { ArchivedClasses } from "@/frontend/components/archived-classes";

export const metadata: Metadata = { title: "Archived classes" };

export default function Archived() {
	return <ArchivedClasses />;
}
