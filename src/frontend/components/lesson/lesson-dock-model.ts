/** The panel docked beside a lesson: which one is open, what it remembers per lesson and how wide it is. Pure. */

/** The panels a lesson docks beside its page, one at a time. */
export type DockPanelKind = "sheet" | "document";

/** What a lesson remembers of its panel: the one open, the deadline whose
 *  cheat sheet was picked and the file the Document panel shows. */
export interface DockState {
	panel: DockPanelKind | null;
	deadlineId?: string;
	fileId?: string;
}

const DOCK_MIN_W = 320;
export const DOCK_DEFAULT_W = 340;
/** The lesson keeps at least this much room beside the panel for its page. */
const SESSION_MIN_W = 1000;

/** The key keeps the cheat sheet's old name, so a lesson's saved panel still reads. */
export function dockStateKey(chatId: string): string {
	return `lh:sheet-dock:${chatId}`;
}

const isText = (v: unknown): v is string => typeof v === "string" && v !== "";

/** A saved state; one saved before the Document panel (`open: true`) is the cheat sheet open. */
export function parseDockState(raw: string | null): DockState {
	try {
		const v = JSON.parse(raw ?? "") as { panel?: unknown; open?: unknown; deadlineId?: unknown; fileId?: unknown };
		const panel = v.panel === "sheet" || v.panel === "document" ? v.panel : v.open === true ? "sheet" : null;
		return { panel, ...(isText(v.deadlineId) ? { deadlineId: v.deadlineId } : {}), ...(isText(v.fileId) ? { fileId: v.fileId } : {}) };
	} catch {
		return { panel: null };
	}
}

/** The panel open: the one asked for while the lesson has it (a cheat sheet in a space, a PDF
 *  for its document), else none, so a remembered Document panel whose file left the space is closed. */
export function openPanel(asked: DockPanelKind | null, has: Record<DockPanelKind, boolean>): DockPanelKind | null {
	return asked && has[asked] ? asked : null;
}

/** The panel's width: what was dragged to, within what the window leaves. */
export function dockWidth(wanted: number, windowW: number): number {
	return Math.round(Math.max(DOCK_MIN_W, Math.min(wanted, windowW - SESSION_MIN_W)));
}
