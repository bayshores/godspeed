/**
 * The space record and its file writes, shared by the Files page and the
 * Edit space dialog. Every write goes to /api/spaces/*; the server then
 * announces spaces-changed and useSpaceRecord re-reads the record.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SpaceRecord, FolderStatus } from "@/shared/core";
import { useServerEvent } from "@/frontend/components/server-events";

/** The full record of one space (files and deadlines included) and its
 *  linked folder as the last scan saw it; null until loaded, and for "No space".
 *  shortcuts: the space's folder of shortcuts in the godspeed folder, or null.
 *  failed: the last read failed. A stale response for another space is
 *  dropped. */
export function useSpaceRecord(spaceId: string | null): {
	record: SpaceRecord | null;
	folder: FolderStatus | null;
	shortcuts: string | null;
	failed: boolean;
	reload: () => Promise<void>;
} {
	const [record, setRecord] = useState<SpaceRecord | null>(null);
	const [folder, setFolder] = useState<FolderStatus | null>(null);
	const [shortcuts, setShortcuts] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const request = useRef(0);
	const reload = useCallback(async () => {
		const id = ++request.current;
		if (!spaceId) {
			setRecord(null);
			setFolder(null);
			setFailed(false);
			return;
		}
		try {
			const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}`, { cache: "no-store" });
			if (id !== request.current) return;
			if (!res.ok) {
				setFailed(true);
				return;
			}
			const body = (await res.json()) as { space: SpaceRecord; folder: FolderStatus; shortcuts?: string | null };
			if (id !== request.current) return;
			setRecord(body.space);
			setFolder(body.folder);
			setShortcuts(body.shortcuts ?? null);
			setFailed(false);
		} catch {
			// Offline: keep what we have.
			if (id === request.current) setFailed(true);
		}
	}, [spaceId]);
	useEffect(() => {
		setRecord(null);
		setFolder(null);
		setShortcuts(null);
		setFailed(false);
		void reload();
	}, [reload]);
	useServerEvent("spaces-changed", () => void reload());
	return { record, folder, shortcuts, failed, reload };
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

const base = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}`;

/** Copy files into the space as study material or space info. Returns
 *  every failure (one line per file), or null. */
export async function uploadSpaceFiles(spaceId: string, files: readonly File[], kind: "study" | "info"): Promise<WriteResult> {
	if (files.length === 0) return null;
	const form = new FormData();
	form.append("kind", kind);
	for (const f of files) form.append("files", f);
	const { error, body } = await send(`${base(spaceId)}/files`, { method: "POST", body: form });
	if (error) return error;
	const results = (body as { results?: { name: string; ok: boolean; error?: string }[] } | null)?.results ?? [];
	const failed = results.filter((r) => !r.ok);
	return failed.length > 0 ? failed.map((r) => r.error ?? r.name).join("\n") : null;
}

export async function setSpaceFileKind(spaceId: string, fileId: string, kind: "study" | "info"): Promise<WriteResult> {
	return (await send(`${base(spaceId)}/files/${encodeURIComponent(fileId)}`, jsonInit("PUT", { kind }))).error;
}

export async function retrySpaceFile(spaceId: string, fileId: string): Promise<WriteResult> {
	return (await send(`${base(spaceId)}/files/${encodeURIComponent(fileId)}`, jsonInit("PUT", { retry: true }))).error;
}

export async function removeSpaceFile(spaceId: string, fileId: string): Promise<WriteResult> {
	return (await send(`${base(spaceId)}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" })).error;
}

export async function linkSpaceFolder(spaceId: string, path: string): Promise<WriteResult> {
	return (await send(`${base(spaceId)}/folder`, jsonInit("PUT", { path: path.trim() }))).error;
}

/** A space file's full path on this computer (null when it can't be found). */
export async function spaceFilePathOf(spaceId: string, fileId: string): Promise<string | null> {
	const { error, body } = await send(`${base(spaceId)}/files/${encodeURIComponent(fileId)}`, { method: "GET" });
	return error ? null : ((body as { path?: string } | null)?.path ?? null);
}

export async function unlinkSpaceFolder(spaceId: string): Promise<WriteResult> {
	return (await send(`${base(spaceId)}/folder`, { method: "DELETE" })).error;
}
