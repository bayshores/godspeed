"use client";

/**
 * THE TEACHER PANE, at the foot of the sidebar: the mascot saying what the
 * agent is doing in a speech bubble ("reading" over "06_Counting.pdf  3 of
 * 12"), then talk (the teacher's panel) and follow (the window goes where
 * the agent works) side by side. With Follow off, a fresh change on another
 * page shows here with a button to go to it. With no agent connected: the
 * button that opens the last one used.
 */

import { useEffect, useRef, useState } from "react";
import type { AgentAction } from "@/shared/core";
import { useReopenAgent } from "@/frontend/components/agent-folder/use-agent-folder";
import { agentStatusLabel, useAgentStatus } from "@/frontend/components/agent-status";
import { useActivity } from "@/frontend/components/activity-dock";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { pageName } from "./follow";
import { announceDelay, type AgentDoing } from "./follow-status";
import { useHalley } from "./halley-provider";
import type { HalleyMood } from "./mood";
import { TeacherSprite } from "./teacher-sprite";

export function TeacherPane() {
	const halley = useHalley();
	const agent = useAgentStatus();
	const { feed } = useActivity();
	if (!halley) return null;
	return (
		<TeacherPaneView
			name={halley.name}
			mood={halley.mood}
			doing={halley.doing}
			idleLine={agentStatusLabel(agent, feed.jobs.length + feed.extractions.length)}
			disconnected={!!agent && !agent.connected}
			following={halley.follow}
			onFollow={halley.setFollow}
			offer={halley.offer}
			onGo={halley.go}
			talkOpen={halley.panelOpen}
			onTalk={() => halley.setPanelOpen(!halley.panelOpen)}
		/>
	);
}

export function TeacherPaneView({
	name,
	mood,
	doing,
	idleLine,
	disconnected,
	following,
	onFollow,
	offer,
	onGo,
	talkOpen,
	onTalk,
}: {
	name: string;
	mood: HalleyMood;
	/** null while no agent is connected. */
	doing: AgentDoing | null;
	/** The agent line shown while nothing is being done. */
	idleLine: string;
	disconnected: boolean;
	following: boolean;
	onFollow: (on: boolean) => void;
	offer: AgentAction | null;
	onGo: (action: AgentAction) => void;
	talkOpen: boolean;
	onTalk: () => void;
}) {
	return (
		<Pane name={name.toLowerCase()} data-testid="teacher-pane" className="flex shrink-0 flex-col gap-3 px-4 pt-5 pb-4">
			<div className="flex items-end gap-2.5">
				<TeacherSprite mood={mood} className="w-10 shrink-0" />
				<Bubble>{doing ? <Doing doing={doing} /> : disconnected ? <NotConnected /> : <p className="text-ink">{idleLine}</p>}</Bubble>
			</div>
			{doing && <Announce name={name} text={doing.text} />}
			{disconnected && <ReopenAgent />}
			{!following && offer && <Offer offer={offer} onGo={onGo} />}
			<div className="flex gap-2">
				<button type="button" data-testid="teacher-talk" data-halley-panel-toggle="" aria-expanded={talkOpen} onClick={onTalk} className="lh-btn flex-1 justify-center">
					talk
				</button>
				{doing && (
					<button
						type="button"
						data-testid={following ? "follow-stop" : "follow-start"}
						aria-pressed={following}
						onClick={() => onFollow(!following)}
						className={cn("lh-btn flex-1 justify-center", following && "text-tint")}
					>
						{following ? "following" : "follow"}
					</button>
				)}
			</div>
		</Pane>
	);
}

/** What the teacher says, in a bubble pointing down at the mascot. */
function Bubble({ children }: { children: React.ReactNode }) {
	return (
		<div data-testid="teacher-bubble" className="min-w-0 flex-1 rounded-[10px] rounded-bl-[2px] border border-tone-2 bg-tone px-3 py-2.5 font-[family-name:var(--font-prose)] text-sm leading-5">
			{children}
		</div>
	);
}

/** "reading" in the accent over the rest of the line; a quiet line while idle. */
function Doing({ doing }: { doing: AgentDoing }) {
	const [verb, ...rest] = doing.text.split(" ");
	if (!doing.working || rest.length === 0) {
		return (
			<p data-testid="teacher-doing" className="text-ink">
				{doing.text.toLowerCase()}
			</p>
		);
	}
	return (
		<p data-testid="teacher-doing" className="flex min-w-0 flex-col gap-0.5">
			<span className="flex items-center gap-2 font-[family-name:var(--font-ui)] text-tint">
				{verb!.toLowerCase()}
				<BrailleSpinner />
			</span>
			<span className="flex min-w-0 items-baseline gap-2 text-ink">
				<span className="truncate">{rest.join(" ")}</span>
				{doing.count && <span className="shrink-0 text-xs text-ink-3 tabular-nums">{doing.count}</span>}
			</span>
		</p>
	);
}

function Offer({ offer, onGo }: { offer: AgentAction; onGo: (a: AgentAction) => void }) {
	return (
		<div data-testid="follow-offer" className="flex flex-col gap-2 text-sm">
			<span className="truncate text-ink">{offer.label.toLowerCase()}</span>
			<button type="button" data-testid="follow-go" onClick={() => onGo(offer)} className="lh-btn self-start">
				go to {pageName(offer.page).toLowerCase()}
			</button>
		</div>
	);
}

/** The bubble while no agent is connected. */
function NotConnected() {
	const { label } = useReopenAgent();
	return <p className="text-ink">I&apos;m not connected yet. {label} and I&apos;ll start.</p>;
}

/** While no agent is connected: the button that opens it. */
function ReopenAgent() {
	const reopen = useReopenAgent();
	return (
		<div data-testid="sidebar-reopen" className="flex flex-col gap-2">
			<button type="button" data-testid="sidebar-reopen-open" disabled={reopen.busy} onClick={reopen.open} className="lh-btn lh-btn-main justify-center">
				{reopen.label.toLowerCase()}
			</button>
			{reopen.error && (
				<p role="alert" className="text-xs text-ans-wrong">
					{reopen.error}
				</p>
			)}
			{reopen.manual && <p className="text-xs text-ink-3">Run the command from Settings, Connection in your terminal.</p>}
		</div>
	);
}

/** What a screen reader hears: the newest line, at most every few seconds
 *  (a file read in parts would otherwise speak every part). */
function Announce({ name, text }: { name: string; text: string }) {
	const [said, setSaid] = useState(text);
	const lastAt = useRef<number | null>(null);
	useEffect(() => {
		if (text === said) return;
		const t = setTimeout(() => {
			lastAt.current = Date.now();
			setSaid(text);
		}, announceDelay(lastAt.current, Date.now()));
		return () => clearTimeout(t);
	}, [text, said]);
	return (
		<span aria-live="polite" className="sr-only">
			{`${name}: ${said}`}
		</span>
	);
}
