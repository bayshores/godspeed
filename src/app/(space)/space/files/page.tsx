import type { Metadata } from "next";
import { FilesPage } from "@/frontend/components/files/files-page";

export const metadata: Metadata = { title: "Files" };

/** The space's Files tab. */
export default function SpaceFilesPage() {
	return <FilesPage />;
}
