"use client";

/**
 * The teacher mascot, drawn on a 10×13 pixel grid: a round white body with
 * plain dark eyes under a small mortarboard. One face per mood; the idle
 * face blinks every few seconds. Crisp at any size.
 */
import { useSyncExternalStore } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import type { HalleyMood } from "./mood";

const COLORS: Record<string, string> = {
	W: "#F2F4FF", // body
	S: "#B9C1E8", // body shade
	K: "#0B1026", // eyes
	C: "#2A3270", // cap
	A: "#A5B4FC", // tassel
};

/** The cap sits on rows 0–3 and the body on rows 3–12 (the tassel's last
 *  pixel hangs beside the top of the head). */
const CAP = ["....CC....", "CCCCCCCCCC", "..CCCCCC.A", "........A."];
const BODY = [
	"...WWWW...",
	".WWWWWWWW.",
	".WWWWWWWW.",
	"WWWWWWWWWW",
	"WWWWWWWWWW",
	"WWWWWWWWWW",
	"WWWWWWWWWW",
	".WWWWWWWS.",
	".WWWWWWSS.",
	"...WSSS...",
];
const BODY_TOP = 3;

type Face = "idle" | "blink" | "reading" | "thinking" | "happy" | "oops";

/** Eye pixels per face, as [row, column] on the body. */
const EYES: Record<Face, ReadonlyArray<readonly [number, number]>> = {
	idle: [[4, 3], [5, 3], [4, 6], [5, 6]],
	blink: [[5, 3], [5, 4], [5, 6], [5, 7]],
	reading: [[4, 4], [5, 4], [4, 7], [5, 7]],
	thinking: [[3, 3], [4, 3], [3, 6], [4, 6]],
	happy: [[5, 2], [4, 3], [5, 4], [5, 5], [4, 6], [5, 7]],
	oops: [[4, 2], [5, 3], [4, 4], [4, 5], [5, 6], [4, 7]],
};

const FACE_OF: Record<HalleyMood, Face> = {
	idle: "idle",
	sleepy: "blink",
	talking: "reading",
	thinking: "thinking",
	happy: "happy",
	oops: "oops",
	shocked: "oops",
	dizzy: "oops",
};

/** Horizontal runs of one color, so a row is a few rects, not ten. */
function runs(grid: readonly string[]): Array<{ x: number; y: number; w: number; color: string }> {
	const out: Array<{ x: number; y: number; w: number; color: string }> = [];
	grid.forEach((row, y) => {
		for (let x = 0; x < row.length; ) {
			const ch = row[x]!;
			let end = x + 1;
			while (row[end] === ch) end++;
			const color = COLORS[ch];
			if (color) out.push({ x, y, w: end - x, color });
			x = end;
		}
	});
	return out;
}

/** The whole picture without eyes: the body under the cap. */
const PICTURE = (() => {
	const rows = [...CAP.slice(0, BODY_TOP), ...BODY].map((r) => r.split(""));
	CAP[BODY_TOP]!.split("").forEach((ch, x) => {
		if (ch !== ".") rows[BODY_TOP]![x] = ch;
	});
	return runs(rows.map((r) => r.join("")));
})();

function Eyes({ face }: { face: Face }) {
	return (
		<g fill={COLORS.K}>
			{EYES[face].map(([y, x]) => (
				<rect key={`${y}-${x}`} x={x} y={y + BODY_TOP} width={1} height={1} />
			))}
		</g>
	);
}

// One blink timer for every idle mascot on screen, so the page wakes only
// twice per blink.
const OPEN_MS = 4032;
const SHUT_MS = 168;
const blinkSubs = new Set<() => void>();
let shut = false;
let blinkTimer: ReturnType<typeof setTimeout> | null = null;

function blinkStep() {
	shut = !shut;
	for (const notify of blinkSubs) notify();
	blinkTimer = setTimeout(blinkStep, shut ? SHUT_MS : OPEN_MS);
}

function subscribeBlink(notify: () => void): () => void {
	blinkSubs.add(notify);
	blinkTimer ??= setTimeout(blinkStep, OPEN_MS);
	return () => {
		blinkSubs.delete(notify);
		if (blinkSubs.size > 0 || blinkTimer === null) return;
		clearTimeout(blinkTimer);
		blinkTimer = null;
		shut = false;
	};
}

// Read on every tick, so turning reduced motion on stops the blink at once.
const blinkFace = (): Face => (shut && !prefersReducedMotion() ? "blink" : "idle");
const openFace = (): Face => "idle";

function BlinkingEyes() {
	return <Eyes face={useSyncExternalStore(subscribeBlink, blinkFace, openFace)} />;
}

export function TeacherSprite({ mood, className }: { mood: HalleyMood; className?: string }) {
	const face = FACE_OF[mood];
	return (
		<svg
			viewBox="0 0 10 13"
			shapeRendering="crispEdges"
			data-testid="teacher-sprite"
			data-face={face}
			aria-hidden
			className={cn("block aspect-[10/13] h-auto", className)}
		>
			{PICTURE.map((r) => (
				<rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.color} />
			))}
			{face === "idle" ? <BlinkingEyes /> : <Eyes face={face} />}
		</svg>
	);
}
