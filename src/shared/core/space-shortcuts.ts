/**
 * The godspeed folder's spaces/: where each space file's shortcut goes.
 * Grouped like the Files page (core/file-groups.ts): spaces/<space>/
 * <group>/<file>, closed spaces under spaces/Closed/. Names are made
 * safe on every OS, and two of one name get " (2)". The server writes them.
 */

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A file or folder name that works on macOS, Windows and Linux. */
export function safeEntryName(name: string): string {
	let out = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, "-").replace(/[. ]+$/, "").trim();
	if (!out) out = "Untitled";
	const dot = out.lastIndexOf(".");
	const stem = dot > 0 ? out.slice(0, dot) : out;
	if (RESERVED.test(stem)) out = `${stem}_${out.slice(stem.length)}`;
	return out.slice(0, 150);
}

