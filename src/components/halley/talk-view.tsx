"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightIcon, SquareIcon } from "lucide-react";
import type { AgentAction, LhMessage } from "@/core";
import { MessageResponse } from "@/components/ai-elements/message";
import { NoAgentLine } from "@/components/agent-folder/no-agent-line";
import { agentWaiting, type AgentStatus } from "@/components/agent-status";
import { ActionBar, fieldKeys } from "@/components/lesson/panel-parts";
import { useServerEvent } from "@/components/server-events";
import { useChatSession } from "@/components/session";
import { actionFor, appRequestText, speakerOf, startsTurn, talkRows } from "./talk-model";
import { pastLabel } from "./tour";

interface TalkChat {
	id: string;
	messages: LhMessage[];
	turnInFlight: boolean;
	turnError?: string;
}

/** A message asked from elsewhere in the window (askTeacher). */
export interface TalkAsk {
	id: number;
	text: string;
}

/**
 * The Talk tab: one ongoing chat with the teacher outside lessons (set up
 * classes, files and deadlines, ask quick questions), laid out like a
 * script, the speaker's name in the margin. Clear chat empties it.
 */
export function TalkView({
	name,
	agent,
	recent,
	onPick,
	ask,
	onAsked,
}: {
	name: string;
	agent: AgentStatus | null;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
	ask: TalkAsk | null;
	onAsked?: (id: number) => void;
}) {
	const [chat, setChat] = useState<TalkChat | null>(null);
	const [failed, setFailed] = useState(false);
	const [epoch, setEpoch] = useState(0);

	useEffect(() => {
		let live = true;
		setFailed(false);
		fetch("/api/talk", { method: "POST" })
			.then((r) => (r.ok ? (r.json() as Promise<TalkChat>) : Promise.reject(new Error(String(r.status)))))
			.then((c) => live && setChat(c))
			.catch(() => live && setFailed(true));
		return () => {
			live = false;
		};
	}, [epoch]);

	if (failed)
		return (
			<p data-testid="talk-error" className="px-6 py-5 text-[13.5px] text-ink-2">
				Couldn&apos;t open the chat.{" "}
				<button type="button" className="lh-press font-bold text-ink underline underline-offset-2" onClick={() => setEpoch((e) => e + 1)}>
					Try again
				</button>
			</p>
		);
	if (!chat) return null;
	return (
		<TalkThread
			key={`${chat.id}-${epoch}`}
			chat={chat}
			name={name}
			agent={agent}
			recent={recent}
			onPick={onPick}
			ask={ask}
			onAsked={onAsked}
			onCleared={() => {
				setChat(null);
				setEpoch((e) => e + 1);
			}}
		/>
	);
}

function TalkThread({
	chat,
	name,
	agent,
	recent,
	onPick,
	ask,
	onAsked,
	onCleared,
}: {
	chat: TalkChat;
	name: string;
	agent: AgentStatus | null;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
	ask: TalkAsk | null;
	onAsked?: (id: number) => void;
	onCleared: () => void;
}) {
	const session = useChatSession({ chatId: chat.id, initialMessages: chat.messages, initialError: chat.turnError, initiallyInFlight: chat.turnInFlight });
	const [text, setText] = useState("");
	const [clearError, setClearError] = useState<string | null>(null);
	const busy = session.status === "submitted" || session.status === "streaming";
	const rows = talkRows(session.messages);
	const endRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [rows.length, session.status]);

	// A turn godspeed started by itself (a request it made): show it as it runs.
	const { resumeStream } = session;
	useServerEvent("turn-started", (p) => {
		if (p.chatId === chat.id && !busy) resumeStream();
	});

	const { send: sendMessage } = session;
	const sendText = useCallback(
		(message: string) => {
			void sendMessage({ type: "text", text: message }).then((sent) => {
				if (!sent) setText(message);
			});
		},
		[sendMessage],
	);

	// A message asked from elsewhere: sent now, or left in the box while the
	// teacher is still replying. Each ask is handled once.
	const handled = useRef<number | null>(null);
	useEffect(() => {
		if (!ask || handled.current === ask.id) return;
		handled.current = ask.id;
		if (busy) setText(ask.text);
		else sendText(ask.text);
		onAsked?.(ask.id);
	}, [ask, busy, sendText, onAsked]);

	const send = () => {
		const message = text.trim();
		if (!message || busy) return;
		setText("");
		sendText(message);
	};

	const clear = () => {
		setClearError(null);
		fetch("/api/talk", { method: "DELETE" })
			.then((r) => (r.ok ? onCleared() : setClearError("Couldn't clear the chat.")))
			.catch(() => setClearError("Couldn't clear the chat."));
	};

	const margin = "w-16 shrink-0 truncate pt-px text-[12.5px] font-bold text-ink-3";

	return (
		<div data-testid="talk" className="flex min-h-0 flex-1 flex-col">
			<div data-testid="talk-thread" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
				{rows.length === 0 && (
					<p data-testid="talk-empty" className="text-[14px] leading-5 text-ink-2">
						Ask {name} to add a class, link a folder of course files, add deadlines from a syllabus, or anything about your classes.
					</p>
				)}
				{rows.map((row, i) => {
					const first = startsTurn(rows, i);
					const speaker = speakerOf(row);
					const who = first ? (speaker === "you" ? "You" : speaker === "app" ? "godspeed" : name) : "";
					let body: React.ReactNode;
					if (row.kind === "you")
						body = (
							<p data-testid="talk-you" className="text-[14px] leading-5 whitespace-pre-wrap break-words text-ink">
								{row.text}
							</p>
						);
					else if (row.kind === "app")
						body = (
							<p data-testid="talk-app" className="text-[14px] leading-5 text-ink-2">
								{appRequestText(name, row.deadlines)}
							</p>
						);
					else if (row.kind === "teacher")
						body = (
							<div
								data-testid="talk-teacher"
								className="min-w-0 break-words text-ink"
								style={{ "--lh-prose-size": "14px", "--lh-prose-leading": `${20 / 14}` } as React.CSSProperties}
							>
								<MessageResponse>{row.text}</MessageResponse>
							</div>
						);
					else {
						const action = actionFor(row.change, recent);
						body = (
							<button
								type="button"
								data-testid="talk-change"
								disabled={!action}
								onClick={() => action && onPick(action)}
								className="lh-press flex w-full items-center gap-2 bg-tone px-3 py-2 text-left text-[13px] text-ink-2 enabled:hover:text-ink disabled:cursor-default"
							>
								<span className="min-w-0 flex-1 truncate" title={pastLabel(row.change.label)}>{pastLabel(row.change.label)}</span>
								{action && <ArrowRightIcon aria-hidden className="size-[13px] shrink-0 text-ink-3" />}
							</button>
						);
					}
					return (
						<div key={row.id} data-testid="talk-row" className={first && i > 0 ? "mt-5 flex gap-3" : i > 0 ? "mt-2 flex gap-3" : "flex gap-3"}>
							<span data-testid="talk-who" className={margin} title={who || undefined}>
								{who}
							</span>
							<div className="min-w-0 flex-1">{body}</div>
						</div>
					);
				})}
				{/* While no agent has taken the message, the panel's head says so. */}
				{busy && !agentWaiting(agent) && (
					<p data-testid="talk-busy" className="mt-4 pl-[76px] text-[13px] text-ink-3">
						Writing…
					</p>
				)}
				{session.error && !busy && (
					<p data-testid="talk-failed" className="mt-4 pl-[76px] text-[13px] text-ink-2">
						{session.error.message}
					</p>
				)}
				{clearError && (
					<p data-testid="talk-clear-failed" className="mt-4 pl-[76px] text-[13px] text-ink-2">
						{clearError}
					</p>
				)}
				<div ref={endRef} />
			</div>
			<div className="shrink-0 border-t border-tone-2">
				<NoAgentLine className="px-6 pt-3.5" />
				<textarea
					rows={2}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => fieldKeys(e, send)}
					placeholder={`Tell ${name} what to set up, or ask about your classes`}
					aria-label={`Message ${name}`}
					className="lh-input block max-h-40 min-h-[76px] w-full resize-none bg-transparent px-6 py-4 text-[14px]! leading-5! text-ink outline-none field-sizing-content placeholder:text-ink-3 focus:inset-ring focus:inset-ring-ink-2"
				/>
				<div className="flex items-stretch">
					<div className="min-w-0 flex-1">
						{busy ? (
							<ActionBar testId="talk-stop" waiting onClick={session.stop} label={<span className="flex items-center gap-2"><SquareIcon aria-hidden className="size-3.5" />Stop</span>} />
						) : (
							<ActionBar testId="talk-send" onClick={send} disabled={!text.trim()} label="Send" />
						)}
					</div>
					{rows.length > 0 && (
						<button
							type="button"
							data-testid="talk-clear"
							disabled={busy}
							onClick={clear}
							className="lh-press shrink-0 border-l border-tone-2 px-5 text-[13px] text-ink-2 hover:text-ink disabled:opacity-50"
						>
							Clear chat
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
