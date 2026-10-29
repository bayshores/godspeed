/**
 * The class record and its file writes, shared by the Files page and the
 * Edit class dialog. Every write goes to /api/classes/*; the server then
 * announces classes-changed and useClassRecord re-reads the record.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClassRecord, FolderProblem } from "@/core";
import { useServerEvent } from "@/components/server-events";

/** The full record of one class (files and deadlines included) and what
 *  is wrong with its linked folder; null until loaded, and for "No class".
 *  A stale response for another class is dropped. */
export function useClassRecord(classId: string | null): {
	record: ClassRecord | null;
	folderProblem: FolderProblem | null;
	reload: () => Promise<void>;
} {
	const [record, setRecord] = useState<ClassRecord | null>(null);
	const [folderProblem, setFolderProblem] = useState<FolderProblem | null>(null);
	const request = useRef(0);
	const reload = useCallback(async () => {
		const id = ++request.current;
		if (!classId) {
			setRecord(null);
			setFolderProblem(null);
			return;
		}
		try {
			const res = await fetch(`/api/classes/${encodeURIComponent(classId)}`, { cache: "no-store" });
			if (!res.ok || id !== request.current) return;
			const body = (await res.json()) as { class: ClassRecord; folderProblem: FolderProblem | null };
			if (id !== request.current) return;
			setRecord(body.class);
			setFolderProblem(body.folderProblem);
		} catch {
			/* offline: keep what we have */
		}
	}, [classId]);
	useEffect(() => {
		setRecord(null);
		setFolderProblem(null);
		void reload();
	}, [reload]);
	useServerEvent("classes-changed", () => void reload());
	return { record, folderProblem, reload };
}

/** A failed write's message, or null on success. */
export type WriteResult = string | null;

/** One request: its error message (null on success) and its JSON body. */
export async function send(url: string, init: RequestInit): Promise<{ error: WriteResult; body: unknown }> {
	try {
		const res = await fetch(url, init);
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		if (!res.ok) return { error: body.error ?? `Request failed (${res.status})`, body };
		return { error: null, body };
	} catch {
		return { error: "Network error. Try again.", body: null };
	}
}

export function jsonInit(method: string, body: unknown): RequestInit {
	return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const base = (classId: string) => `/api/classes/${encodeURIComponent(classId)}`;

/** Copy files into the class as study material or course info. Returns
 *  every failure (one line per file), or null. */
export async function uploadClassFiles(classId: string, files: readonly File[], kind: "study" | "info"): Promise<WriteResult> {
	if (files.length === 0) return null;
	const form = new FormData();
	form.append("kind", kind);
	for (const f of files) form.append("files", f);
	const { error, body } = await send(`${base(classId)}/files`, { method: "POST", body: form });
	if (error) return error;
	const results = (body as { results?: { name: string; ok: boolean; error?: string }[] } | null)?.results ?? [];
	const failed = results.filter((r) => !r.ok);
	return failed.length > 0 ? failed.map((r) => r.error ?? r.name).join("\n") : null;
}

export async function setClassFileKind(classId: string, fileId: string, kind: "study" | "info"): Promise<WriteResult> {
	return (await send(`${base(classId)}/files/${encodeURIComponent(fileId)}`, jsonInit("PUT", { kind }))).error;
}

export async function retryClassFile(classId: string, fileId: string): Promise<WriteResult> {
	return (await send(`${base(classId)}/files/${encodeURIComponent(fileId)}`, jsonInit("PUT", { retry: true }))).error;
}

export async function removeClassFile(classId: string, fileId: string): Promise<WriteResult> {
	return (await send(`${base(classId)}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" })).error;
}

export async function linkClassFolder(classId: string, path: string): Promise<WriteResult> {
	return (await send(`${base(classId)}/folder`, jsonInit("PUT", { path: path.trim() }))).error;
}

/** A class file's full path on this computer (null when it can't be found). */
export async function classFilePathOf(classId: string, fileId: string): Promise<string | null> {
	const { error, body } = await send(`${base(classId)}/files/${encodeURIComponent(fileId)}`, { method: "GET" });
	return error ? null : ((body as { path?: string } | null)?.path ?? null);
}

export async function unlinkClassFolder(classId: string): Promise<WriteResult> {
	return (await send(`${base(classId)}/folder`, { method: "DELETE" })).error;
}
