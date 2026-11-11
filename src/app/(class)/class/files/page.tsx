import type { Metadata } from "next";
import { FilesPage } from "@/frontend/components/files/files-page";

export const metadata: Metadata = { title: "Files" };

/** The class's Files tab. */
export default function ClassFilesPage() {
	return <FilesPage />;
}
