import { useCallback, useState } from "react";
import type { CheatSheetView } from "@/shared/core";
import { jsonInit, send } from "@/frontend/lib/api";
import { useServerResource } from "@/frontend/components/use-server-resource";
import type { Pointed } from "./canvas-model";

/** A deadline's cheat sheet (GET …/cheat-sheet), read again whenever the
 *  server says it changed; `act` posts one action and returns the error
 *  line, or null. */
export function useCheatSheet(spaceId: string, deadlineId: string) {
	const url = sheetApiPath(spaceId, deadlineId);
	const { value: view, error: loadError, reload } = useServerResource<CheatSheetView>(url, {
		on: { "cheat-sheet-changed": (e) => e.deadlineId === deadlineId, "spaces-changed": true },
	});
	const act = useCallback(async (body: Record<string, unknown>) => (await send(url, jsonInit("POST", body))).error, [url]);

	return { view, loadError, reload, act };
}

/** The part pointed at and the version the chat asks to show, shared by
 *  the canvas and the chat. */
export function useSheetFocus() {
	const [pointed, setPointed] = useState<Pointed | null>(null);
	const [focus, setFocus] = useState<{ n: number; seq: number } | null>(null);
	const showVersion = useCallback((n: number) => setFocus((f) => ({ n, seq: (f?.seq ?? 0) + 1 })), []);
	return { pointed, setPointed, focus, showVersion };
}

function sheetApiPath(spaceId: string, deadlineId: string): string {
	return `/api/spaces/${encodeURIComponent(spaceId)}/deadlines/${encodeURIComponent(deadlineId)}/cheat-sheet`;
}

/** Version n of a sheet's PDF. */
export function sheetPdfPath(spaceId: string, deadlineId: string, n: number): string {
	return `${sheetApiPath(spaceId, deadlineId)}/pdf/${n}`;
}

/** A picture or PDF sent in the sheet's chat. */
export function sheetFilePath(spaceId: string, deadlineId: string, file: string): string {
	return `${sheetApiPath(spaceId, deadlineId)}/files/${encodeURIComponent(file)}`;
}

/** Where the version's PDF sits in the sheet's working folder: its path, or the error line. */
export async function sheetPdfFile(spaceId: string, deadlineId: string, n: number): Promise<{ path: string } | { error: string }> {
	const { error, body } = await send(sheetApiPath(spaceId, deadlineId), jsonInit("POST", { action: "file", n }));
	return error ? { error } : { path: (body as { path: string }).path };
}

/** Show in Finder (desktop): the version's PDF in the sheet's working
 *  folder. Resolves to the error line, or null. */
export async function showSheetPdf(spaceId: string, deadlineId: string, n: number): Promise<string | null> {
	const show = window.lh?.showInFolder;
	if (!show) return null;
	const file = await sheetPdfFile(spaceId, deadlineId, n);
	if ("error" in file) return file.error;
	await show(file.path);
	return null;
}

/** What Make it again asks for a sheet an older godspeed made. */
const REMAKE = "Make my cheat sheet again from what I asked before.";

/** Make it again: resolves to the error line, or null once it started. */
export async function remakeSheet(spaceId: string, deadlineId: string): Promise<string | null> {
	return (await send(sheetApiPath(spaceId, deadlineId), jsonInit("POST", { action: "ask", text: REMAKE }))).error;
}

/** The studio's address for a deadline. */
export function studioPath(deadlineId: string): string {
	return `/space/deadline/${encodeURIComponent(deadlineId)}/cheat-sheet`;
}
