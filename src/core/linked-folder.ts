/** Linked folders by where they live: Google Drive for desktop's folders
 *  sit under ~/Library/CloudStorage/GoogleDrive-<account>/. */

export function isGoogleDriveFolder(folder: string): boolean {
	return /\/Library\/CloudStorage\/GoogleDrive-[^/]+(\/|$)/.test(folder);
}

/** The folder's own name, its last path segment. */
export function folderName(folder: string): string {
	return folder.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || folder;
}

/** Where a folder's files come from: "Google Drive", else its name. */
export function folderSource(folder: string): string {
	return isGoogleDriveFolder(folder) ? "Google Drive" : folderName(folder);
}
