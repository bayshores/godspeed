/**
 * A space's file writes, shared by the Files page and the Edit space
 * dialog. Every write goes to /api/spaces/*; the server then announces
 * spaces-changed and useSpaceRecord (space-record.tsx) re-reads the record.
 */

import { send, jsonInit, type WriteResult } from "@/frontend/lib/api";
import { spaceUrl } from "./space-record";

/** Copy files into the space; each one's first read sorts it into study
 *  material or space info. Returns every failure (one line per file), or
 *  null. */
export async function uploadSpaceFiles(spaceId: string, files: readonly File[]): Promise<WriteResult> {
	if (files.length === 0) return null;
	const form = new FormData();
	for (const f of files) form.append("files", f);
	const { error, body } = await send(`${spaceUrl(spaceId)}/files`, { method: "POST", body: form });
	if (error) return error;
	const results = (body as { results?: { name: string; ok: boolean; error?: string }[] } | null)?.results ?? [];
	const failed = results.filter((r) => !r.ok);
	return failed.length > 0 ? failed.map((r) => r.error ?? r.name).join("\n") : null;
}

export async function setSpaceFileKind(spaceId: string, fileId: string, kind: "study" | "info"): Promise<WriteResult> {
	return (await send(`${spaceUrl(spaceId)}/files/${encodeURIComponent(fileId)}`, jsonInit("PUT", { kind }))).error;
}

export async function retrySpaceFile(spaceId: string, fileId: string): Promise<WriteResult> {
	return (await send(`${spaceUrl(spaceId)}/files/${encodeURIComponent(fileId)}`, jsonInit("PUT", { retry: true }))).error;
}

export async function removeSpaceFile(spaceId: string, fileId: string): Promise<WriteResult> {
	return (await send(`${spaceUrl(spaceId)}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" })).error;
}

export async function linkSpaceFolder(spaceId: string, path: string): Promise<WriteResult> {
	return (await send(`${spaceUrl(spaceId)}/folder`, jsonInit("PUT", { path: path.trim() }))).error;
}

/** A space file's full path on this computer (null when it can't be found). */
export async function spaceFilePathOf(spaceId: string, fileId: string): Promise<string | null> {
	const { error, body } = await send(`${spaceUrl(spaceId)}/files/${encodeURIComponent(fileId)}`, { method: "GET" });
	return error ? null : ((body as { path?: string } | null)?.path ?? null);
}

export async function unlinkSpaceFolder(spaceId: string): Promise<WriteResult> {
	return (await send(`${spaceUrl(spaceId)}/folder`, { method: "DELETE" })).error;
}
