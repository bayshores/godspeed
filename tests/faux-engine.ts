/**
 * A scripted pi engine on pi-ai's faux provider: each model call takes the
 * next response step. tokenSize is set so every test string streams as ONE
 * delta, so text assertions read contiguous text.
 */
import { createFauxCore, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";

export function fauxEngine(steps: FauxResponseStep[] = []): PiEngine {
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}
