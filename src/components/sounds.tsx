"use client";

/**
 * The app's sound effects (public/sounds), behind the Settings → General
 * "Sounds" switch. The startup sound is not here: it plays on the launch
 * splash, before this app exists (electron/main.cjs).
 */

import { createContext, useCallback, useContext, useRef } from "react";
import { useSettingsSaved } from "@/components/settings-signal";

type SoundName = "intro" | "connected" | "all-set" | "right" | "wrong";

const PlayContext = createContext<(name: SoundName) => void>(() => {});

export function SoundProvider({ initialOn, children }: { initialOn: boolean; children: React.ReactNode }) {
	const on = useRef(initialOn);
	const loaded = useRef(new Map<SoundName, HTMLAudioElement>());

	useSettingsSaved((section) => {
		if (section !== "general") return;
		fetch("/api/settings", { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { settings?: { general?: { sounds?: boolean } } } | null) => {
				if (body) on.current = body.settings?.general?.sounds !== false;
			})
			.catch(() => {});
	});

	const play = useCallback((name: SoundName) => {
		if (!on.current) return;
		let audio = loaded.current.get(name);
		if (!audio) {
			audio = new Audio(`/sounds/${name}.mp3`);
			loaded.current.set(name, audio);
		}
		audio.currentTime = 0;
		// A plain browser may block sound before the first click: stay silent.
		audio.play().catch(() => {});
	}, []);

	return <PlayContext.Provider value={play}>{children}</PlayContext.Provider>;
}

export function useSound(): (name: SoundName) => void {
	return useContext(PlayContext);
}
