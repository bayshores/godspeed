"use client";

/**
 * THE SHARED CLOCK: one clock for every
 * countdown on screen (the sidebar's Due soon, Home) and Home's date line.
 * It ticks only as fast as what is mounted needs:
 *  - every animation frame while a deadline in its last hour is shown
 *    (hundredths), once a second with reduced motion;
 *  - once a second while one is in its last 24h;
 *  - otherwise it sleeps until the next text change (a whole day passing,
 *    the last 24h starting, the next minute for the date line).
 * Formatting is pure: src/components/countdown-model.ts.
 */

import { useCallback, useSyncExternalStore } from "react";
import { prefersReducedMotion } from "@/components/presence";
import { cn } from "@/lib/utils";
import { HOUR, MINUTE, SECOND, countdown, dueAtMs, nextWake, tickRate, type Countdown as CountdownValue } from "./countdown-model";

interface Sub {
	/** A due moment (ms), or null for a minute clock. */
	due: number | null;
	notify: () => void;
}

const subs = new Set<Sub>();
let now = Date.now();
let timer: ReturnType<typeof setTimeout> | null = null;
let frame: number | null = null;

function stop() {
	if (timer !== null) clearTimeout(timer);
	if (frame !== null) cancelAnimationFrame(frame);
	timer = null;
	frame = null;
}

function dues(): number[] {
	const out: number[] = [];
	for (const s of subs) if (s.due !== null) out.push(s.due);
	return out;
}

function tick() {
	timer = null;
	frame = null;
	now = Date.now();
	for (const s of subs) s.notify();
	schedule();
}

function schedule() {
	stop();
	if (subs.size === 0) return;
	const at = Date.now();
	const rate = tickRate(dues(), at, prefersReducedMotion());
	if (rate === "frame" && typeof requestAnimationFrame === "function") {
		frame = requestAnimationFrame(tick);
		return;
	}
	if (rate === "second" || rate === "frame") {
		timer = setTimeout(tick, SECOND - (at % SECOND));
		return;
	}
	const minutes = [...subs].some((s) => s.due === null);
	const wake = nextWake(dues(), at, minutes);
	// Capped so a sleeping computer catches up within the hour.
	if (wake !== null) timer = setTimeout(tick, Math.min(Math.max(wake - at, 0), HOUR));
}

function subscribeTo(due: number | null, notify: () => void): () => void {
	const sub: Sub = { due, notify };
	subs.add(sub);
	now = Date.now();
	schedule();
	return () => {
		subs.delete(sub);
		schedule();
	};
}

/** Server and hydration renders show no time (the server's clock is not
 *  the window's). */
const serverSnapshot = () => null;

function keyOf(c: CountdownValue): string {
	return `${c.mode}|${c.color}|${c.text}`;
}

function parseKey(key: string): CountdownValue {
	const [mode, color, ...text] = key.split("|");
	return { mode: mode as CountdownValue["mode"], color: color!, text: text.join("|") };
}

/** A live countdown to `due`; null until the window's first render. */
function useCountdown(due: { date: string; time?: string }): CountdownValue | null {
	const dueMs = dueAtMs(due);
	const subscribe = useCallback((notify: () => void) => subscribeTo(dueMs, notify), [dueMs]);
	const key = useSyncExternalStore(
		subscribe,
		() => keyOf(countdown(dueMs, now, { hundredths: !prefersReducedMotion() })),
		serverSnapshot,
	);
	return key === null ? null : parseKey(key);
}

/** True once `due` has passed, live (exact to the second). `fixedNow`
 *  answers for a fixed moment (tests). */
export function useIsOverdue(due: { date: string; time?: string }, fixedNow?: number): boolean {
	const dueMs = dueAtMs(due);
	const subscribe = useCallback((notify: () => void) => subscribeTo(dueMs, notify), [dueMs]);
	const live = useSyncExternalStore(subscribe, () => dueMs <= now, () => false);
	return fixedNow !== undefined ? dueMs <= fixedNow : live;
}

/** The current minute (ms), live; null until the window's first render. */
export function useMinute(): number | null {
	const subscribe = useCallback((notify: () => void) => subscribeTo(null, notify), []);
	return useSyncExternalStore(subscribe, () => Math.floor(now / MINUTE) * MINUTE, serverSnapshot);
}

/**
 * The countdown text. `className` sizes the plain words ("in 2 days",
 * "Overdue"); `clockClassName` sizes the ticking clock. Pass `now` for a
 * fixed moment (tests).
 */
export function Countdown({
	due,
	now: fixedNow,
	className,
	clockClassName,
}: {
	due: { date: string; time?: string };
	now?: number;
	className?: string;
	clockClassName?: string;
}) {
	if (fixedNow !== undefined) return <CountdownView value={countdown(dueAtMs(due), fixedNow)} className={className} clockClassName={clockClassName} />;
	return <LiveCountdown due={due} className={className} clockClassName={clockClassName} />;
}

function LiveCountdown({ due, className, clockClassName }: { due: { date: string; time?: string }; className?: string; clockClassName?: string }) {
	const value = useCountdown(due);
	return <CountdownView value={value} className={className} clockClassName={clockClassName} />;
}

function CountdownView({ value, className, clockClassName }: { value: CountdownValue | null; className?: string; clockClassName?: string }) {
	if (!value) return <span data-testid="countdown" className={cn("whitespace-nowrap", className)}>{" "}</span>;
	const ticking = value.mode === "clock" || value.mode === "fine";
	return (
		<span
			data-testid="countdown"
			data-mode={value.mode}
			style={{ color: value.color }}
			className={cn(
				"whitespace-nowrap",
				ticking ? cn("font-mono font-bold tabular-nums", clockClassName ?? className) : className,
				value.mode === "overdue" && "font-bold",
			)}
		>
			{value.text}
		</span>
	);
}
