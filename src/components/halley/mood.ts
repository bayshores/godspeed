/**
 * Halley's mood from the app's state (plan 2026-10-28, Phase 4). Pure.
 *
 * A brief reaction (a graded answer, a deadline under an hour away, a
 * failed job) shows on top of everything for a moment. Otherwise:
 * Talking while a teacher message streams, Thinking while the agent works,
 * Sleepy while no agent is connected, and Idle.
 */
import { HOUR } from "@/components/countdown-model";

export const HALLEY_MOODS = [
	"idle",
	"talking",
	"thinking",
	"happy",
	"sparkle",
	"oops",
	"shocked",
	"dizzy",
	"embarrassed",
	"sleepy",
] as const;
export type HalleyMood = (typeof HALLEY_MOODS)[number];

/** The moods that show for a moment, then pass. */
export type HalleyReaction = "happy" | "oops" | "shocked" | "dizzy";

/** How long each reaction shows. */
export const REACTION_MS: Record<HalleyReaction, number> = {
	happy: 1400,
	oops: 1400,
	shocked: 2400,
	dizzy: 2400,
};

export interface MoodInputs {
	/** The reaction showing right now, if any. */
	reaction: HalleyReaction | null;
	/** A teacher message is being written. */
	streaming: boolean;
	/** The agent has work (pending requests, jobs, a turn in flight). */
	working: boolean;
	/** null = not known yet. */
	connected: boolean | null;
}

export function pickMood(i: MoodInputs): HalleyMood {
	if (i.reaction) return i.reaction;
	if (i.streaming) return "talking";
	if (i.connected === false) return "sleepy";
	if (i.working) return "thinking";
	return "idle";
}

/** The deadlines that just crossed under one hour left (between two
 *  clock readings). Already-late ones and ones that started under an
 *  hour don't count: the face reacts once, when it crosses. */
export function crossedUnderHour(deadlines: readonly { id: string; dueMs: number }[], prevMs: number, nowMs: number): string[] {
	return deadlines.filter((d) => d.dueMs - prevMs >= HOUR && d.dueMs - nowMs < HOUR && d.dueMs > nowMs).map((d) => d.id);
}

/** Moods where the eyes don't follow the mouse. */
export function eyesStill(mood: HalleyMood): boolean {
	return mood === "sleepy" || mood === "dizzy" || mood === "embarrassed";
}
