/**
 * Noise: soft brown noise to study to, made in the window (lib/noise-audio.ts).
 * The word "Noise" in a top bar turns it on and off. It plays across pages,
 * is off at every launch, and belongs to the "Sounds" switch: with Sounds
 * off it stops and its word is gone.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/frontend/components/settings-context";
import { barWord } from "@/frontend/components/top-bar/bar-look";
import { startNoise, type NoiseAudio } from "@/frontend/lib/noise-audio";

/** Seconds the noise takes to come and go on a click. */
const FADE = 0.4;
/** With Sounds switched off it goes at once, short of a click in the speaker. */
const CUT = 0.05;

const NoiseContext = createContext<{ playing: boolean; toggle: () => void }>({ playing: false, toggle: () => {} });

/** Around every page, so the noise plays on while pages change. */
export function NoiseProvider({ children }: { children: React.ReactNode }) {
	const { sounds } = useSettings();
	const [playing, setPlaying] = useState(false);
	const audio = useRef<NoiseAudio | null>(null);
	// It does not come back by itself when Sounds is switched on again.
	if (!sounds && playing) setPlaying(false);
	useEffect(() => {
		if (!sounds) audio.current?.fadeTo(false, CUT);
	}, [sounds]);
	useEffect(() => () => audio.current?.close(), []);

	const value = useMemo(
		() => ({
			playing,
			toggle: () => {
				audio.current ??= startNoise();
				audio.current.fadeTo(!playing, FADE);
				setPlaying(!playing);
			},
		}),
		[playing],
	);
	return <NoiseContext.Provider value={value}>{children}</NoiseContext.Provider>;
}

/** The word in a top bar, lit while the noise plays. */
export function NoiseWord() {
	const { sounds } = useSettings();
	const { playing, toggle } = useContext(NoiseContext);
	if (!sounds) return null;
	return (
		<button type="button" data-testid="noise-word" aria-pressed={playing} onClick={toggle} className={barWord(playing)}>
			Noise
		</button>
	);
}
