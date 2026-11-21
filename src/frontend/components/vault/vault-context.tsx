/**
 * The notes folder as the server sees it (GET /api/vault), read once for the window and again
 * whenever its notes change. Every change goes through `change` or `retry`, whose answer is the
 * status every reader then shows.
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { jsonInit, send, type WriteResult } from "@/frontend/lib/api";
import { useServerResource } from "@/frontend/components/use-server-resource";
import type { VaultStatus, VaultWords } from "./vault-model";

/** The fields to change: the folder (null unlinks it) or who writes the note. */
type VaultChange = { path: string | null } | { words: VaultWords };

interface VaultState {
	/** null until read, and when the first read failed. */
	status: VaultStatus | null;
	error: string | null;
	change: (fields: VaultChange) => Promise<WriteResult>;
	/** Read the folder again after it was missing or failed. */
	retry: () => Promise<WriteResult>;
}

async function write(url: string, init: RequestInit, keep: (status: VaultStatus) => void): Promise<WriteResult> {
	const { error, body } = await send(url, init);
	if (!error) keep(body as VaultStatus);
	return error;
}

const VaultContext = createContext<VaultState | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
	const { value: status, error, update } = useServerResource<VaultStatus>("/api/vault", { on: { "vault-notes-changed": true } });
	const keep = useCallback((next: VaultStatus) => update(() => next), [update]);
	const change = useCallback((fields: VaultChange) => write("/api/vault", jsonInit("PATCH", fields), keep), [keep]);
	const retry = useCallback(() => write("/api/vault/retry", { method: "POST" }, keep), [keep]);
	const value = useMemo(() => ({ status, error, change, retry }), [status, error, change, retry]);
	return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

const ignore = () => {};
/** Outside a provider (isolated renders, tests): nothing read, and writes that still reach the server. */
const OUTSIDE: VaultState = {
	status: null,
	error: null,
	change: (fields) => write("/api/vault", jsonInit("PATCH", fields), ignore),
	retry: () => write("/api/vault/retry", { method: "POST" }, ignore),
};

export function useVault(): VaultState {
	return useContext(VaultContext) ?? OUTSIDE;
}
