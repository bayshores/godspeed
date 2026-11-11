/**
 * Download helpers: the tiny save-a-blob seam shared by the demo + figure
 * cards and the lesson export, plus the filename slug. The slug and the
 * header parsing are pure (test-pinned); saveBlob touches the DOM and only
 * runs on click.
 */

/** Slugify a demo title into a filename stem — lowercase, accents folded,
 *  runs of non-alphanumerics collapsed to "-", trimmed, capped at 64
 *  chars. Empty/fully-symbolic titles fall back to "demo". */
export function slugFilename(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
	return slug || "demo";
}

/** How long a saved file's blob URL stays alive. WebKit reads the blob only after the save
 *  dialog closes, where Chromium read it at once. */
const REVOKE_AFTER_MS = 60_000;

/** Save a blob as a downloaded file. */
export function saveBlob(name: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/** Save text as a downloaded file. */
export function saveText(name: string, text: string, mime: string): void {
	saveBlob(name, new Blob([text], { type: mime }));
}

/** The `filename="…"` of a Content-Disposition header, or null. */
export function dispositionFileName(header: string | null): string | null {
	return header?.match(/filename="([^"]+)"/)?.[1] ?? null;
}
