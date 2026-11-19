/**
 * The settings record, held once for the whole window. Every reader takes
 * it from here and every save goes through here, so a save never sends an
 * old copy of fields it did not change.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CURRENT_SETTINGS_VERSION, type GeneralSettings, type UserSettings } from "@/shared/core";
import { jsonInit, type WriteResult } from "@/frontend/lib/api";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import { liveGeneral, type BootGeneral, type LiveGeneral } from "./settings-context-model";

/** General fields to change: a value sets one, null removes it, the rest stay. */
export type GeneralPatch = { [K in keyof GeneralSettings]?: GeneralSettings[K] | null };
/** The sections saved whole. */
type WholeSection = "agent" | "appearance" | "graph";

interface SettingsState extends LiveGeneral {
	/** undefined while loading, null when the read failed. */
	record: UserSettings | null | undefined;
	/** The line to show when the save failed, null once saved. */
	patchGeneral: (fields: GeneralPatch) => Promise<WriteResult>;
	saveSection: (section: WholeSection, body: object) => Promise<WriteResult>;
	/** Read the record again; a failed read keeps it. */
	refresh: () => Promise<void>;
}

async function readRecord(): Promise<UserSettings> {
	const res = await fetch("/api/settings", { cache: "no-store" });
	if (!res.ok) throw new Error(`status ${res.status}`);
	// No record yet is a first launch, every setting at its default.
	const body = (await res.json()) as { settings: UserSettings | null };
	return body.settings ?? { version: CURRENT_SETTINGS_VERSION };
}

/** One save. `keep` gets the record the server stored, never the request
 *  body: the server may clean up what it stores. */
async function save(section: "general" | WholeSection, method: "PATCH" | "PUT", body: object, keep: (record: UserSettings) => void): Promise<WriteResult> {
	let res: Response;
	try {
		res = await fetch(`/api/settings/${section}`, jsonInit(method, body));
	} catch {
		return "Network error. Try again.";
	}
	if (!res.ok) {
		const detail = (await res.json().catch(() => ({}))) as { error?: string };
		return `${section}: ${detail.error ?? res.status}`;
	}
	const stored = ((await res.json().catch(() => null)) as { settings?: UserSettings } | null)?.settings;
	if (stored) keep(stored);
	return null;
}

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({ boot, children }: { boot: BootGeneral; children: ReactNode }) {
	const [record, setRecord] = useState<UserSettings | null | undefined>(undefined);
	// A failed read keeps the record; it is null only when none was ever read.
	const refresh = useCallback(() => readRecord().then(setRecord, () => setRecord((prev) => prev ?? null)), []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	// An agent saved, undid or edited a rule, or the server came back and the
	// news may have been missed.
	useServerEvent("rules-changed", () => void refresh());
	useServerResync(() => void refresh());
	const patchGeneral = useCallback((fields: GeneralPatch) => save("general", "PATCH", fields, setRecord), []);
	const saveSection = useCallback((section: WholeSection, body: object) => save(section, "PUT", body, setRecord), []);
	const { teacherName, sounds, startupSound } = liveGeneral(record, boot);
	const value = useMemo<SettingsState>(
		() => ({ record, teacherName, sounds, startupSound, patchGeneral, saveSection, refresh }),
		[record, teacherName, sounds, startupSound, patchGeneral, saveSection, refresh],
	);
	return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

const ignore = () => {};
/** Outside a provider (isolated renders, tests): nothing read, the defaults,
 *  and saves that still reach the server. */
const OUTSIDE: SettingsState = {
	record: undefined,
	...liveGeneral(undefined, { sounds: true, startupSound: true }),
	patchGeneral: (fields) => save("general", "PATCH", fields, ignore),
	saveSection: (section, body) => save(section, "PUT", body, ignore),
	refresh: async () => {},
};

export function useSettings(): SettingsState {
	return useContext(SettingsContext) ?? OUTSIDE;
}
