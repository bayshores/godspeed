/**
 * The app's sound effects (public/sounds), behind two Settings → General
 * switches: "Startup sound" for the welcome screen's sound, "Sounds" for the rest.
 */

import { createContext, useCallback, useContext, useRef } from "react";
import { useSettingsSaved } from "@/frontend/components/settings-signal";

type SoundName = "startup" | "intro" | "connected" | "all-set" | "right" | "wrong" | "done";

const PlayContext = createContext<(name: SoundName) => void>(() => {});

export function SoundProvider({ initialOn, initialStartupOn, children }: { initialOn: boolean; initialStartupOn: boolean; children: React.ReactNode }) {
	const on = useRef(initialOn);
	const startupOn = useRef(initialStartupOn);
	const loaded = useRef(new Map<SoundName, HTMLAudioElement>());

	useSettingsSaved((section) => {
		if (section !== "general") return;
		fetch("/api/settings", { cache: "no-store" })
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { settings?: { general?: { sounds?: boolean; startupSound?: boolean } } } | null) => {
				if (!body) return;
				on.current = body.settings?.general?.sounds !== false;
				startupOn.current = body.settings?.general?.startupSound !== false;
			})
			.catch(() => {});
	});

	const play = useCallback((name: SoundName) => {
		if (!(name === "startup" ? startupOn : on).current) return;
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
