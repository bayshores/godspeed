"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightIcon, SquareIcon } from "lucide-react";
import type { AgentAction, LhMessage } from "@/shared/core";
import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { NoAgentLine } from "@/frontend/components/agent-folder/no-agent-line";
import { agentWaiting, type AgentStatus } from "@/frontend/components/agent-status";
import { AttachButton, AttachmentTray, attachmentInputProps, useAttachmentDraft, type AttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { restoreUnsent } from "@/frontend/components/lesson/chat-helpers";
import { lastLearnerText, lessonError, retryAction } from "@/frontend/components/lesson/lesson-error-model";
import { MessageAttachments } from "@/frontend/components/lesson/message-attachments";
import { SendButton } from "@/frontend/components/lesson/panel-parts";
import { MathBox } from "@/frontend/components/math-box";
import { useLessonDrafts } from "@/frontend/components/lesson/use-lesson-drafts";
import { useServerEvent } from "@/frontend/components/server-events";
import { useChatSession } from "@/frontend/components/session";
import { actionFor, appRequestText, draftWithAsk, speakerOf, startsTurn, talkRows } from "./talk-model";
import { pastLabel } from "./tour";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";
import { cn } from "@/frontend/lib/utils";

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
			<p data-testid="talk-error" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-5 text-[13.5px] text-ink-2">
				Couldn&apos;t open the chat.
				<button type="button" className="lh-press lh-btn" onClick={() => setEpoch((e) => e + 1)}>
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
	// Unsent text is saved like the lesson box's; waiting files stay in
	// memory while the tab or the panel is closed.
	const drafts = useLessonDrafts(chat.id, session.nativeMessages);
	const { saveComposer } = drafts;
	const draftsLoaded = drafts.draft !== null;
	const draftRef = useRef(drafts.draft);
	draftRef.current = drafts.draft;
	const [text, setText] = useState("");
	const textRef = useRef("");
	const editText = useCallback(
		(v: string) => {
			textRef.current = v;
			setText(v);
			saveComposer(v);
		},
		[saveComposer],
	);
	useEffect(() => {
		const saved = draftRef.current?.composer;
		if (draftsLoaded && saved) {
			textRef.current = saved;
			setText(saved);
		}
	}, [draftsLoaded]);
	const attachments = useAttachmentDraft(chat.id);
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
	const { restore } = attachments;
	const sendText = useCallback(
		(message: string, drafts: AttachmentDraft["files"] = []) => {
			const files = drafts.map((f) => f.attachment);
			void sendMessage({ type: "text", text: message, ...(files.length > 0 ? { attachments: files } : {}) }).then((sent) => {
				if (sent) return;
				editText(restoreUnsent(message, textRef.current));
				restore(drafts);
			});
		},
		[sendMessage, restore, editText],
	);

	// A message asked from elsewhere: sent now, or left in the box after the
	// learner's own text while the teacher is still replying. Each ask is
	// handled once, after the saved draft is read.
	const handled = useRef<number | null>(null);
	useEffect(() => {
		if (!ask || !draftsLoaded || handled.current === ask.id) return;
		handled.current = ask.id;
		if (busy) editText(draftWithAsk(textRef.current, ask.text));
		else sendText(ask.text);
		onAsked?.(ask.id);
	}, [ask, busy, draftsLoaded, sendText, editText, onAsked]);

	const send = () => {
		const message = text.trim();
		const drafts = attachments.files;
		if ((!message && drafts.length === 0) || busy) return;
		editText("");
		attachments.clear();
		sendText(message, drafts);
	};

	// Try again, as in the lesson: send the box again, send the last message
	// again, run a failed reply again, or read the chat again.
	const retry = () => {
		if (!session.error) return;
		const action = retryAction(lessonError(session.error.message).kind, { boxHasText: textRef.current.trim().length > 0, lastText: lastLearnerText(session.nativeMessages) });
		if (action.type === "send-box") send();
		else if (action.type === "resend") sendText(action.text);
		else if (action.type === "continue") void sendMessage({ type: "continue" });
		else {
			session.clearError();
			resumeStream();
		}
	};

	// Stop (and Esc anywhere in Talk) ends the reply on the server too, as
	// in the lesson; the view alone would only stop watching it.
	const stopReply = () => {
		session.stop();
		void fetch("/api/activity/abort", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "turn", id: chat.id }),
		}).catch(() => {
			/* transient: the turn settles on its own */
		});
	};

	const clear = () => {
		setClearError(null);
		fetch("/api/talk", { method: "DELETE" })
			.then((r) => (r.ok ? onCleared() : setClearError("Couldn't clear the chat.")))
			.catch(() => setClearError("Couldn't clear the chat."));
	};

	const margin = cn("w-16 shrink-0 truncate", LABEL_TEXT);

	return (
		<div
			data-testid="talk"
			className="flex min-h-0 flex-1 flex-col"
			// Claimed before the panel's own Esc (which closes it) and the box's.
			onKeyDownCapture={(e) => {
				if (e.key !== "Escape" || !busy) return;
				e.preventDefault();
				e.stopPropagation();
				stopReply();
			}}
		>
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
							<>
								{row.text && (
									<p data-testid="talk-you" className="text-[14px] leading-5 whitespace-pre-wrap break-words text-ink">
										{row.text}
									</p>
								)}
								<MessageAttachments parts={row.files} />
							</>
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
					<p data-testid="talk-failed" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 pl-[76px] text-[13px] text-ink-2">
						{session.error.message}
						<button type="button" data-testid="talk-retry" className="lh-press lh-btn" onClick={retry}>
							Try again
						</button>
					</p>
				)}
				{clearError && (
					<p data-testid="talk-clear-failed" className="mt-4 pl-[76px] text-[13px] text-ink-2">
						{clearError}
					</p>
				)}
				<div ref={endRef} />
			</div>
			<div data-testid="talk-box" className="shrink-0 border-t border-tone-2" {...attachmentInputProps(attachments)}>
				<NoAgentLine className="px-6 pt-3.5" />
				<div className="px-6">
					<AttachmentTray draft={attachments} />
				</div>
				<div className="m-4 border border-tone-2 bg-background has-[.cm-focused]:border-ink-2">
					<div className="flex min-h-[52px]">
						<MathBox
							compact
							value={text}
							onChange={editText}
							onEnter={send}
							placeholder={`Tell ${name} what to set up, or ask about your classes`}
							ariaLabel={`Message ${name}`}
						/>
					</div>
					<div className="flex items-center gap-2 p-2">
						<AttachButton draft={attachments} />
						{rows.length > 0 && (
							<button
								type="button"
								data-testid="talk-clear"
								disabled={busy}
								onClick={clear}
								className="lh-press lh-btn"
							>
								Clear chat
							</button>
						)}
						{busy ? (
							<SendButton
								testId="talk-stop"
								waiting
								onClick={stopReply}
								label={
									<>
										<SquareIcon aria-hidden className="size-3.5" />
										Stop
									</>
								}
							/>
						) : (
							<SendButton testId="talk-send" onClick={send} disabled={!text.trim() && attachments.files.length === 0} label="Send" />
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
