/**
 * The app's sound effects (public/sounds), behind two Settings → General
 * switches: "Startup sound" for the welcome screen's sound, "Sounds" for the rest.
 */

import { createContext, useCallback, useContext, useRef } from "react";
import { useSettings } from "@/frontend/components/settings-context";

type SoundName = "startup" | "intro" | "connected" | "all-set" | "right" | "wrong" | "done";

const PlayContext = createContext<(name: SoundName) => void>(() => {});

export function SoundProvider({ children }: { children: React.ReactNode }) {
	const { sounds, startupSound } = useSettings();
	// Read when a sound plays, so play itself never changes.
	const on = useRef({ sounds, startupSound });
	on.current = { sounds, startupSound };
	const loaded = useRef(new Map<SoundName, HTMLAudioElement>());

	const play = useCallback((name: SoundName) => {
		if (!(name === "startup" ? on.current.startupSound : on.current.sounds)) return;
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
