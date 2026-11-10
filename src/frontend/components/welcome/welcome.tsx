/**
 * THE WELCOME SCREEN: covers the app on the first page load of each
 * launch (src/backend/server/welcome.ts) and plays the startup sound. Over the
 * onboarding sky, "godspeed" fades in, a comet flies in and lands on its
 * left, and the word slides right to make room: the logo. Under it, a
 * boot log types out (the version, the agent, the next deadline; after
 * updating from the old look, "new look"), then "Let's go", which closes
 * it; after an update the release notes open next. A click during the
 * animation skips to the end. The first paint waits for /api/boot
 * (src/frontend/main.tsx), so it is still this and not Home. The app's
 * panes hold their draw-in while it covers them (html[data-lh-hold], set
 * by main.tsx) and draw in as it leaves.
 */

import { useCallback, useEffect, useState } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useMinute } from "@/frontend/components/countdown";
import { byDue } from "@/frontend/components/deadlines-model";
import { Constellation, HEAD_R, TAIL, TAIL_ANGLE } from "@/frontend/components/onboarding/constellation";
import { usePresence } from "@/frontend/components/presence";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { useSound } from "@/frontend/components/sounds";
import { openFolderNotice } from "@/frontend/components/agent-folder/folder-notice";
import { openWhatsNew } from "@/frontend/components/whats-new";
import { cn } from "@/frontend/lib/utils";
import { bootLines, lookUpgraded } from "./welcome-model";

/** When the button has risen (.wl-rise in globals.css). */
const ANIMATION_MS = 2800;
const LEAVE_MS = 400;
/** The boot log starts once the logo has landed, and types this fast. */
const BOOT_START_MS = 2200;
const LETTER_MS = 12;
const VERSION = process.env.LH_VERSION ?? "";

/** Lets the app's panes draw in (they hold while the screen covers them). */
function releasePanes() {
	delete document.documentElement.dataset.lhHold;
}

export function Welcome({ initialOpen, whatsNewSince }: { initialOpen: boolean; whatsNewSince: string | null }) {
	// Kept in state: a later /api/boot read (onboarding finishing) says false.
	const [open, setOpen] = useState(initialOpen);
	const presence = usePresence(open, LEAVE_MS);
	const close = useCallback(() => {
		setOpen(false);
		releasePanes();
		// "What's new" and the godspeed folder notice never come on the same launch.
		setTimeout(() => (whatsNewSince ? openWhatsNew(whatsNewSince) : openFolderNotice()), LEAVE_MS);
	}, [whatsNewSince]);
	if (!presence.mounted) return null;
	return <WelcomeScreen leaving={!open} onClose={close} upgraded={lookUpgraded(whatsNewSince)} />;
}

function WelcomeScreen({ leaving, onClose, upgraded }: { leaving: boolean; onClose: () => void; upgraded: boolean }) {
	const agent = useAgentStatus();
	const nowMs = useMinute();
	const { deadlines } = useOpenDeadlines();
	const [played, setPlayed] = useState(false);
	const [skipped, setSkipped] = useState(false);
	const ready = played || skipped;
	const play = useSound();

	useEffect(() => {
		play("startup");
		const timer = setTimeout(() => setPlayed(true), ANIMATION_MS);
		return () => clearTimeout(timer);
	}, [play]);

	// Capture phase on window: runs before the app's own shortcuts and keeps
	// them from firing under the screen.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			e.stopPropagation();
			if (e.key !== "Enter" && e.key !== "Escape") return;
			e.preventDefault();
			if (ready) onClose();
			else setSkipped(true);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [ready, onClose]);

	const next = deadlines ? byDue(deadlines)[0] : undefined;

	return (
		<div
			role="dialog"
			aria-modal
			aria-label="Welcome"
			data-testid="welcome"
			onClick={() => !ready && setSkipped(true)}
			className={cn(
				"ob-root fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-y-auto bg-background px-4 transition-opacity duration-[400ms]",
				skipped && "ob-skip",
				leaving && "pointer-events-none opacity-0",
			)}
		>
			<div aria-hidden className="lh-drag absolute inset-x-0 top-0 z-10 h-12" />
			<Constellation mode="welcome" />
			<div className="relative flex items-center gap-[18px]">
				{/* The comet's head fills this 24px slot; the tail hangs outside it. */}
				<svg aria-hidden viewBox={`${-HEAD_R} ${-HEAD_R} ${HEAD_R * 2} ${HEAD_R * 2}`} className="wl-comet size-6 shrink-0 overflow-visible">
					<defs>
						<linearGradient id="wl-tail">
							<stop offset="0" style={{ stopColor: "var(--foreground)" }} stopOpacity="0.85" />
							<stop offset="1" style={{ stopColor: "var(--foreground)" }} stopOpacity="0" />
						</linearGradient>
						<filter id="wl-tail-blur" x="-20%" y="-100%" width="140%" height="300%">
							<feGaussianBlur stdDeviation="3" />
						</filter>
					</defs>
					<g transform={`rotate(${TAIL_ANGLE.toFixed(1)})`}>
						<path className="wl-tail" d={TAIL} fill="url(#wl-tail)" filter="url(#wl-tail-blur)" />
					</g>
					<circle r={HEAD_R} className="fill-ink" />
				</svg>
				<h1 className="wl-word font-bold text-[64px] leading-none text-ink">godspeed</h1>
			</div>
			<div className={cn("wl-rise relative mt-10 flex flex-col items-center", !ready && "pointer-events-none")}>
				<BootLog lines={agent && nowMs !== null ? bootLines(VERSION, agent, next, nowMs, upgraded) : []} skipped={skipped} />
				<button
					type="button"
					data-testid="welcome-go"
					autoFocus
					onClick={(e) => {
						e.stopPropagation();
						onClose();
					}}
					className="lh-btn lh-btn-main mt-8"
				>
					Let&apos;s go
				</button>
			</div>
		</div>
	);
}

/** The boot log: its lines type out one letter at a time after the logo
 *  lands, a block cursor at the end; a skip or Reduce motion shows them
 *  whole. */
function BootLog({ lines, skipped }: { lines: readonly string[]; skipped: boolean }) {
	const [typed, setTyped] = useState(0);
	const total = lines.reduce((n, l) => n + l.length, 0);
	const instant = skipped || prefersReducedMotion();
	useEffect(() => {
		if (instant) return;
		let timer: ReturnType<typeof setInterval> | undefined;
		const start = setTimeout(() => {
			timer = setInterval(() => setTyped((n) => n + 1), LETTER_MS);
		}, BOOT_START_MS);
		return () => {
			clearTimeout(start);
			clearInterval(timer);
		};
	}, [instant]);
	const shown = instant ? total : Math.min(typed, total);
	let left = shown;
	return (
		<div data-testid="welcome-status" className="flex min-h-[72px] w-[34ch] flex-col font-mono text-[15px] leading-6 text-ink-2">
			<span className="sr-only">{lines.join(", ")}</span>
			{lines.map((line, i) => {
				const part = line.slice(0, Math.max(0, left));
				const typing = left >= 0 && left < line.length;
				left -= line.length;
				return (
					<span key={i} aria-hidden className="whitespace-pre">
						{i === 0 ? <span className="text-ink">{part}</span> : part}
						{typing && <span aria-hidden className="ml-px inline-block h-[1.1em] w-[0.6em] translate-y-[3px] bg-tint" />}
					</span>
				);
			})}
		</div>
	);
}
