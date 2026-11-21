/** Showing a space's file on the desktop: selected in its folder, or opened in its app. */
import type { WriteResult } from "@/frontend/lib/api";
import { spaceFilePathOf } from "./space-files-api";

export type FileShow = "folder" | "open";

/** A PDF opens in its app; any other file is shown in its folder. */
export const fileShowFor = (name: string): FileShow => (/\.pdf$/i.test(name) ? "open" : "folder");

/** Resolves to the error line when the file is not on this computer. With no `how`, the file found decides. */
export async function showSpaceFile(spaceId: string, fileId: string, how?: FileShow): Promise<WriteResult> {
	const path = await spaceFilePathOf(spaceId, fileId);
	if (!path) return "Can't find this file on your computer.";
	void ((how ?? fileShowFor(path)) === "open" ? window.lh?.openPath : window.lh?.showInFolder)?.(path);
	return null;
}
