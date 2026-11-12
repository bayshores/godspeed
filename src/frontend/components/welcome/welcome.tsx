"use client";

/**
 * THE WELCOME SCREEN: covers the app on the first page load of each
 * launch (src/backend/server/welcome.ts) and plays the startup sound. Over the
 * onboarding sky, "godspeed" fades in, the teacher mascot flies in and lands
 * on its left, and the word slides right to make room: the logo. Under it,
 * start lines type out (the version, the agent, the next deadline; after
 * updating from the old look, "New look"), then "Let's go", which closes
 * it; after an update the release notes open next. A click during the
 * animation skips to the end. Server-rendered, so the window's first
 * paint is this and not Home.
 */

import { useCallback, useEffect, useState } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useMinute } from "@/frontend/components/countdown";
import { byDue } from "@/frontend/components/deadlines-model";
import { Constellation } from "@/frontend/components/onboarding/constellation";
import { Wordmark } from "@/frontend/components/onboarding/wordmark";
import { BIG_BUTTON } from "@/frontend/components/ui/big-button";
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

export function Welcome({ initialOpen, whatsNewSince }: { initialOpen: boolean; whatsNewSince: string | null }) {
	// Kept in state: later layout renders (router.refresh) say false.
	const [open, setOpen] = useState(initialOpen);
	const presence = usePresence(open, LEAVE_MS);
	const close = useCallback(() => {
		setOpen(false);
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
				"ob-root fixed inset-0 z-[60] flex flex-col items-center justify-center gap-[30px] overflow-y-auto bg-background px-4 transition-opacity duration-[400ms]",
				skipped && "ob-skip",
				leaving && "pointer-events-none opacity-0",
			)}
		>
			<div aria-hidden className="lh-drag absolute inset-x-0 top-0 z-10 h-12" />
			<Constellation mode="welcome" />
			<Wordmark markClassName="wl-mark" wordClassName="wl-word" />
			<div className={cn("wl-rise relative flex flex-col items-center gap-[30px]", !ready && "pointer-events-none")}>
				<BootLog lines={agent && nowMs !== null ? bootLines(VERSION, agent, next, nowMs, upgraded) : []} skipped={skipped} />
				<button
					type="button"
					data-testid="welcome-go"
					autoFocus
					onClick={(e) => {
						e.stopPropagation();
						onClose();
					}}
					className={cn("lh-btn lh-btn-main", BIG_BUTTON)}
				>
					Let&apos;s go
				</button>
			</div>
		</div>
	);
}

/** The start lines: they type out one letter at a time after the logo
 *  lands, a block cursor at the end; a skip or Reduce motion shows them
 *  whole. Each line is laid out in full (hidden) so the centered text does
 *  not shift as it types. */
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
		<div data-testid="welcome-status" className="flex min-h-[78px] flex-col items-center gap-1.5 font-count text-base leading-[22px] text-ink-2">
			<span className="sr-only">{lines.join(", ")}</span>
			{lines.map((line, i) => {
				const part = line.slice(0, Math.max(0, left));
				const typing = left >= 0 && left < line.length;
				left -= line.length;
				return (
					<span key={i} aria-hidden className="relative whitespace-pre">
						<span className="invisible">{line}</span>
						<span className="absolute top-0 left-0">
							{part}
							{typing && <span aria-hidden className="ml-px inline-block h-[1.1em] w-[0.6em] translate-y-[3px] bg-tint" />}
						</span>
					</span>
				);
			})}
		</div>
	);
}
