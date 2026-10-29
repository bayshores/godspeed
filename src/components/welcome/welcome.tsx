"use client";

/**
 * THE WELCOME SCREEN: covers the app on the first page load of each
 * launch (src/server/welcome.ts). Over the onboarding sky, "godspeed"
 * fades in, a comet flies in and lands on its left, and the word slides
 * right to make room: the logo. Under it, one line (the agent, the next
 * deadline) and "Let's go", which closes it; after an update the release
 * notes open next. A click during the animation skips to the end.
 * Server-rendered, so the window's first paint is this and not Home.
 */

import { useCallback, useEffect, useState } from "react";
import { useAgentStatus } from "@/components/agent-status";
import { useMinute } from "@/components/countdown";
import { byDue } from "@/components/deadlines-model";
import { Constellation, TAIL } from "@/components/onboarding/constellation";
import { usePresence } from "@/components/presence";
import { useOpenDeadlines } from "@/components/use-open-deadlines";
import { openWhatsNew } from "@/components/whats-new";
import { cn } from "@/lib/utils";
import { statusLine } from "./welcome-model";

/** When the button has risen (.wl-rise in globals.css). */
const ANIMATION_MS = 2800;
const LEAVE_MS = 400;

export function Welcome({ initialOpen, whatsNewSince }: { initialOpen: boolean; whatsNewSince: string | null }) {
	// Kept in state: later layout renders (router.refresh) say false.
	const [open, setOpen] = useState(initialOpen);
	const presence = usePresence(open, LEAVE_MS);
	const close = useCallback(() => {
		setOpen(false);
		if (whatsNewSince) setTimeout(() => openWhatsNew(whatsNewSince), LEAVE_MS);
	}, [whatsNewSince]);
	if (!presence.mounted) return null;
	return <WelcomeScreen leaving={!open} onClose={close} />;
}

function WelcomeScreen({ leaving, onClose }: { leaving: boolean; onClose: () => void }) {
	const agent = useAgentStatus();
	const nowMs = useMinute();
	const { deadlines } = useOpenDeadlines();
	const [played, setPlayed] = useState(false);
	const [skipped, setSkipped] = useState(false);
	const ready = played || skipped;

	useEffect(() => {
		const timer = setTimeout(() => setPlayed(true), ANIMATION_MS);
		return () => clearTimeout(timer);
	}, []);

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
				<svg aria-hidden viewBox="-10.9 -10.9 21.8 21.8" className="wl-comet size-6 shrink-0 overflow-visible">
					<defs>
						<linearGradient id="wl-tail" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="-37" y2="36">
							<stop offset="0" stopColor="#fff" stopOpacity="0.9" />
							<stop offset="1" stopColor="#fff" stopOpacity="0" />
						</linearGradient>
					</defs>
					<path className="wl-tail" d={TAIL} fill="url(#wl-tail)" />
					<circle r="10.9" fill="#fff" />
				</svg>
				<h1 className="wl-word font-title text-[64px] leading-none text-ink">godspeed</h1>
			</div>
			<div className={cn("wl-rise relative mt-10 flex flex-col items-center", !ready && "pointer-events-none")}>
				<p data-testid="welcome-status" className="min-h-6 text-[15px] leading-6 text-ink-2">
					{agent && nowMs !== null ? statusLine(agent, next, nowMs) : ""}
				</p>
				<button
					type="button"
					data-testid="welcome-go"
					autoFocus
					onClick={(e) => {
						e.stopPropagation();
						onClose();
					}}
					className="lh-press mt-8 bg-ink px-7 py-3 text-[15px] font-bold text-black hover:bg-white"
				>
					Let&apos;s go
				</button>
			</div>
		</div>
	);
}
