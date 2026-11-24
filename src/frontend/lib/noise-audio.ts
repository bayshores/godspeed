import { brownNoise } from "@/shared/core";

/** The loop's length: long enough that no ear finds the repeat. */
const LOOP_SECONDS = 8;
/** How loud the noise plays, of full scale: under a voice, over a room's hum. */
const LOUDNESS = 0.08;

export interface NoiseAudio {
	/** Fades the noise in or out over `seconds`. */
	fadeTo: (on: boolean, seconds: number) => void;
	close: () => void;
}

const logged = (what: string) => (err: unknown) => console.error(`[noise] could not ${what}:`, err);

/**
 * A silent loop of brown noise, made by code, a different one for each ear.
 * Call it from a click: a window lets sound begin only then. Faded out, it
 * stops the sound device, so the computer may sleep.
 */
export function startNoise(): NoiseAudio {
	const ctx = new AudioContext();
	const length = Math.round(ctx.sampleRate * LOOP_SECONDS);
	const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
	for (let ear = 0; ear < 2; ear++) buffer.getChannelData(ear).set(brownNoise(length, Math.random));
	const source = ctx.createBufferSource();
	source.buffer = buffer;
	source.loop = true;
	const gain = ctx.createGain();
	gain.gain.value = 0;
	source.connect(gain).connect(ctx.destination);
	source.start();
	let rest: ReturnType<typeof setTimeout> | undefined;
	return {
		fadeTo(on, seconds) {
			clearTimeout(rest);
			const now = ctx.currentTime;
			gain.gain.cancelScheduledValues(now);
			gain.gain.setValueAtTime(gain.gain.value, now);
			gain.gain.linearRampToValueAtTime(on ? LOUDNESS : 0, now + seconds);
			if (on) ctx.resume().catch(logged("start"));
			else rest = setTimeout(() => ctx.suspend().catch(logged("rest")), seconds * 1000 + 50);
		},
		close() {
			clearTimeout(rest);
			ctx.close().catch(logged("close"));
		},
	};
}
