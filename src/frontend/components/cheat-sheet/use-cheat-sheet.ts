import { useCallback, useEffect, useRef, useState } from "react";
import type { CheatSheetView, ClassSheetsView } from "@/shared/core";
import { jsonInit, send } from "@/frontend/components/files/class-files-api";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import type { Pointed } from "./canvas-model";

/** A deadline's cheat sheet (GET …/cheat-sheet), read again whenever the
 *  server says it changed; `act` posts one action and returns the error
 *  line, or null. */
export function useCheatSheet(classId: string, deadlineId: string) {
	const url = sheetApiPath(classId, deadlineId);
	const [view, setView] = useState<CheatSheetView | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const request = useRef(0);

	const reload = useCallback(async () => {
		const id = ++request.current;
		const { error, body } = await send(url, { method: "GET" });
		if (id !== request.current) return;
		if (error) setLoadError(error);
		else {
			setView(body as CheatSheetView);
			setLoadError(null);
		}
	}, [url]);

	useEffect(() => {
		void reload();
	}, [reload]);
	useServerEvent("cheat-sheet-changed", (e) => {
		if (e.deadlineId === deadlineId) void reload();
	});
	useServerEvent("classes-changed", () => void reload());
	useServerResync(() => void reload());

	const act = useCallback(async (body: Record<string, unknown>) => (await send(url, jsonInit("POST", body))).error, [url]);

	return { view, loadError, reload, act };
}

/** A class's deadlines with where each sheet is, read again whenever a
 *  sheet or the class changes. */
export function useClassSheets(classId: string | null) {
	const [view, setView] = useState<ClassSheetsView | null>(null);
	const [failed, setFailed] = useState(false);
	const request = useRef(0);
	const reload = useCallback(async () => {
		const id = ++request.current;
		if (!classId) return setView(null);
		const { error, body } = await send(`/api/classes/${encodeURIComponent(classId)}/cheat-sheets`, { method: "GET" });
		if (id !== request.current) return;
		setFailed(!!error);
		if (!error) setView(body as ClassSheetsView);
	}, [classId]);
	useEffect(() => {
		setView(null);
		void reload();
	}, [reload]);
	useServerEvent("cheat-sheet-changed", () => void reload());
	useServerEvent("classes-changed", () => void reload());
	useServerResync(() => void reload());
	return { view, failed, reload };
}

/** The part pointed at and the version the chat asks to show, shared by
 *  the canvas and the chat. */
export function useSheetFocus() {
	const [pointed, setPointed] = useState<Pointed | null>(null);
	const [focus, setFocus] = useState<{ n: number; seq: number } | null>(null);
	const showVersion = useCallback((n: number) => setFocus((f) => ({ n, seq: (f?.seq ?? 0) + 1 })), []);
	return { pointed, setPointed, focus, showVersion };
}

function sheetApiPath(classId: string, deadlineId: string): string {
	return `/api/classes/${encodeURIComponent(classId)}/deadlines/${encodeURIComponent(deadlineId)}/cheat-sheet`;
}

/** Version n of a sheet's PDF. */
export function sheetPdfPath(classId: string, deadlineId: string, n: number): string {
	return `${sheetApiPath(classId, deadlineId)}/pdf/${n}`;
}

/** A picture or PDF sent in the sheet's chat. */
export function sheetFilePath(classId: string, deadlineId: string, file: string): string {
	return `${sheetApiPath(classId, deadlineId)}/files/${encodeURIComponent(file)}`;
}

/** Show in Finder (desktop): the version's PDF in the sheet's working
 *  folder. Resolves to the error line, or null. */
export async function showSheetPdf(classId: string, deadlineId: string, n: number): Promise<string | null> {
	const show = window.lh?.showInFolder;
	if (!show) return null;
	const { error, body } = await send(sheetApiPath(classId, deadlineId), jsonInit("POST", { action: "file", n }));
	if (error) return error;
	await show((body as { path: string }).path);
	return null;
}

/** What Make it again asks for a sheet an older godspeed made. */
const REMAKE = "Make my cheat sheet again from what I asked before.";

/** Make it again: resolves to the error line, or null once it started. */
export async function remakeSheet(classId: string, deadlineId: string): Promise<string | null> {
	return (await send(sheetApiPath(classId, deadlineId), jsonInit("POST", { action: "ask", text: REMAKE }))).error;
}

/** The studio's address for a deadline. */
export function studioPath(deadlineId: string): string {
	return `/class/deadline/${encodeURIComponent(deadlineId)}/cheat-sheet`;
}
