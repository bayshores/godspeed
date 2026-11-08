import type { Metadata } from "next";
import { FilesPage } from "@/frontend/components/files/files-page";

export const metadata: Metadata = { title: "files" };

/** The class's Files page, opened from the sidebar's Files row. */
export default function ClassFilesPage() {
	return <FilesPage />;
}
