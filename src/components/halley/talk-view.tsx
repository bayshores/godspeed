"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon } from "lucide-react";
import type { AgentAction, LhMessage } from "@/core";
import { MessageResponse } from "@/components/ai-elements/message";
import { agentWaiting, type AgentStatus } from "@/components/agent-status";
import { fieldKeys, ToneButton } from "@/components/lesson/panel-parts";
import { StopButton } from "@/components/lesson/panel-composer";
import { useChatSession } from "@/components/session";
import { actionFor, talkRows } from "./talk-model";
import { pastLabel } from "./tour";

interface TalkChat {
	id: string;
	messages: LhMessage[];
	turnInFlight: boolean;
	turnError?: string;
}

/**
 * The Talk tab: one ongoing chat with the teacher outside lessons (set up
 * classes, files and deadlines, ask quick questions). Clear empties it.
 */
export function TalkView({
	name,
	agent,
	recent,
	onPick,
}: {
	name: string;
	agent: AgentStatus | null;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
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
			<p data-testid="talk-error" className="text-[13.5px] text-ink-2">
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
	onCleared,
}: {
	chat: TalkChat;
	name: string;
	agent: AgentStatus | null;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
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

	const send = () => {
		const message = text.trim();
		if (!message || busy) return;
		setText("");
		void session.send({ type: "text", text: message }).then((sent) => {
			if (!sent) setText(message);
		});
	};

	const clear = () => {
		setClearError(null);
		fetch("/api/talk", { method: "DELETE" })
			.then((r) => (r.ok ? onCleared() : setClearError("Couldn't clear the chat.")))
			.catch(() => setClearError("Couldn't clear the chat."));
	};

	return (
		<div data-testid="talk" className="flex min-h-0 flex-1 flex-col gap-3">
			<div data-testid="talk-thread" className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
				{rows.length === 0 && (
					<p data-testid="talk-empty" className="text-[13.5px] text-ink-2">
						Ask {name} to add a class, link a folder of course files, add deadlines from a syllabus, or anything about your classes.
					</p>
				)}
				{rows.map((row) => {
					if (row.kind === "you")
						return (
							<div key={row.id} data-testid="talk-you" className="bg-tone px-3 py-2 text-[14px] leading-[19px] whitespace-pre-wrap text-ink">
								{row.text}
							</div>
						);
					if (row.kind === "teacher")
						return (
							<div
								key={row.id}
								data-testid="talk-teacher"
								className="text-ink"
								style={{ "--lh-prose-size": "14px", "--lh-prose-leading": `${20 / 14}` } as React.CSSProperties}
							>
								<MessageResponse>{row.text}</MessageResponse>
							</div>
						);
					const action = actionFor(row.change, recent);
					return (
						<button
							key={row.id}
							type="button"
							data-testid="talk-change"
							disabled={!action}
							onClick={() => action && onPick(action)}
							className="lh-press -my-1.5 flex w-full items-center gap-2 py-1 text-left text-[13px] text-ink-2 enabled:hover:text-ink disabled:cursor-default"
						>
							<span className="min-w-0 flex-1 truncate">{pastLabel(row.change.label)}</span>
							{action && <ArrowRightIcon aria-hidden className="size-[13px] shrink-0 text-ink-3" />}
						</button>
					);
				})}
				{busy && (
					<p data-testid="talk-busy" className="text-[13px] text-ink-3">
						{agentWaiting(agent) ? "Waiting for your agent" : `${name} is writing…`}
					</p>
				)}
				{session.error && !busy && (
					<p data-testid="talk-failed" className="text-[13px] text-ink-2">
						{session.error.message}
					</p>
				)}
				<div ref={endRef} />
			</div>
			<div className="flex shrink-0 items-end bg-background">
				<textarea
					rows={1}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => fieldKeys(e, send)}
					placeholder={`Ask ${name} anything`}
					aria-label={`Ask ${name} anything`}
					className="lh-input field-sizing-content max-h-32 min-w-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-[14px]! leading-5! text-ink outline-none placeholder:text-ink-3"
				/>
				<div className="p-2">
					{busy ? (
						<StopButton onStop={session.stop} />
					) : (
						<ToneButton testId="talk-send" onClick={send} disabled={!text.trim()}>
							Send
						</ToneButton>
					)}
				</div>
			</div>
			{rows.length > 0 && (
				<div className="-mt-1 flex shrink-0 items-center justify-between text-[12.5px]">
					<span className="text-ink-3">{clearError}</span>
					<button type="button" data-testid="talk-clear" disabled={busy} onClick={clear} className="lh-press text-ink-3 hover:text-ink disabled:opacity-50">
						Clear
					</button>
				</div>
			)}
		</div>
	);
}
