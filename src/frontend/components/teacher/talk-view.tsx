import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentAction, LhMessage } from "@/shared/core";
import { CitedResponse } from "@/frontend/components/citations/cited-response";
import { agentWaiting, type AgentStatus } from "@/frontend/components/agent-status";
import { AttachButton, AttachmentTray, attachmentInputProps, useAttachmentDraft, type AttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { restoreUnsent } from "@/frontend/components/lesson/chat-helpers";
import { lastLearnerText, lessonError, retryAction } from "@/frontend/components/lesson/lesson-error-model";
import { MessageAttachments } from "@/frontend/components/lesson/message-attachments";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { SendButton } from "@/frontend/components/ui/send-button";
import { MathBox } from "@/frontend/components/math-box";
import { useLessonDrafts } from "@/frontend/components/lesson/use-lesson-drafts";
import { useServerEvent } from "@/frontend/components/server-events";
import { useChatSession } from "@/frontend/components/session";
import { useSpaces } from "@/frontend/components/space-context";
import { talkWorkLine } from "@/frontend/components/work/work-model";
import { actionFor, appRequestText, draftWithAsk, speakerOf, startsTurn, talkRows } from "./talk-model";
import { TalkNoAgent } from "./talk-no-agent";
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
 * spaces, files and deadlines, ask quick questions), laid out like a
 * script, the speaker's name above each turn. Clear chat sits on the
 * panel's tab row (clearSlot) and empties it.
 */
export function TalkView({
	name,
	agent,
	recent,
	onPick,
	ask,
	onAsked,
	clearSlot,
}: {
	name: string;
	agent: AgentStatus | null;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
	ask: TalkAsk | null;
	onAsked?: (id: number) => void;
	/** Where Clear chat is drawn (the panel's tab row). */
	clearSlot: HTMLElement | null;
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
			<p data-testid="talk-error" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-[18px] text-[15px] text-ink-2">
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
			clearSlot={clearSlot}
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
	clearSlot,
	onCleared,
}: {
	chat: TalkChat;
	name: string;
	agent: AgentStatus | null;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
	ask: TalkAsk | null;
	onAsked?: (id: number) => void;
	clearSlot: HTMLElement | null;
	onCleared: () => void;
}) {
	const session = useChatSession({ chatId: chat.id, initialMessages: chat.messages, initialError: chat.turnError, initiallyInFlight: chat.turnInFlight });
	const { spaces } = useSpaces();
	// Unsent text is saved like the lesson's writing box; waiting files stay in
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

	const noAgent = !!agent && !agent.connected && !agent.teaching;
	const turnGap = (first: boolean, i: number) => (i === 0 ? "" : first ? "mt-[18px]" : "mt-2");
	const lastSpeaker = rows.length > 0 ? speakerOf(rows[rows.length - 1]!) : null;

	return (
		<div
			data-testid="talk"
			className="flex min-h-0 flex-1 flex-col"
			// Claimed before the panel's own Esc (which closes it) and the box's.
			onKeyDownCapture={(e) => {
				// A key in a dialog opened from here (React passes it up through the portal) is the dialog's.
				if (e.key !== "Escape" || !busy || !e.currentTarget.contains(e.target as Node)) return;
				e.preventDefault();
				e.stopPropagation();
				stopReply();
			}}
		>
			<div data-testid="talk-thread" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-[18px]">
				{rows.length === 0 && noAgent && (
					<>
						<TalkNoAgent />
						<hr className="my-[18px] border-0 border-t-2 border-dotted border-edge" />
					</>
				)}
				{rows.length === 0 && (
					<p data-testid="talk-empty" className="text-[15px] leading-[22px] text-ink-2">
						Ask {name} to add a space, link a folder of files, add deadlines from a syllabus or a schedule, or anything about your spaces.
					</p>
				)}
				{rows.map((row, i) => {
					const first = startsTurn(rows, i);
					const speaker = speakerOf(row);
					const who = speaker === "you" ? "You" : speaker === "app" ? "godspeed" : name;
					let body: React.ReactNode;
					if (row.kind === "you")
						body = (
							<>
								{row.text && (
									<p data-testid="talk-you" className="text-[15px] leading-[22px] whitespace-pre-wrap break-words text-ink">
										{row.text}
									</p>
								)}
								<MessageAttachments parts={row.files} />
							</>
						);
					else if (row.kind === "app")
						body = (
							<p data-testid="talk-app" className="text-[15px] leading-[22px] text-ink-2">
								{appRequestText(name, row.deadlines)}
							</p>
						);
					else if (row.kind === "teacher")
						body = (
							<div
								data-testid="talk-teacher"
								className="min-w-0 break-words text-ink"
								style={{ "--lh-prose-size": "16px", "--lh-prose-leading": "1.5" } as React.CSSProperties}
							>
								<CitedResponse text={row.text} />
							</div>
						);
					else {
						const action = actionFor(row.change, recent);
						const work = talkWorkLine(action, spaces, !agent || agent.teaching || agent.helperHere);
						body = (
							<button
								type="button"
								data-testid="talk-change"
								disabled={!action}
								onClick={() => action && onPick(action)}
								className="lh-press flex w-full items-center gap-2 border border-edge bg-background px-2.5 py-2 text-left text-base text-ink enabled:hover:bg-tone disabled:cursor-default"
							>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate" title={pastLabel(row.change.label)}>
										{pastLabel(row.change.label)}
									</span>
									{work && (
										<span data-testid="talk-change-work" className="truncate text-[15px] text-ink-2">
											{work}
										</span>
									)}
								</span>
								{action && <PixelIcon name="chevron" className="text-ink-2" />}
							</button>
						);
					}
					return (
						<div key={row.id} data-testid="talk-row" className={cn("flex flex-col gap-1", turnGap(first, i))}>
							{first && (
								<span data-testid="talk-who" className={cn("truncate", LABEL_TEXT)}>
									{who}
								</span>
							)}
							{body}
						</div>
					);
				})}
				{/* While no agent has taken the message, the panel's head says so. */}
				{busy && !agentWaiting(agent) && (
					<div className={cn("flex flex-col gap-1", rows.length > 0 && (lastSpeaker === "teacher" ? "mt-2" : "mt-[18px]"))}>
						{lastSpeaker !== "teacher" && <span className={cn("truncate", LABEL_TEXT)}>{name}</span>}
						<p data-testid="talk-busy" className="text-[15px] text-ink-2">
							Writing…
						</p>
					</div>
				)}
				{rows.length > 0 && noAgent && (
					<div className="mt-[18px]">
						<TalkNoAgent />
					</div>
				)}
				{session.error && !busy && (
					<p data-testid="talk-failed" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] text-ink-2">
						{session.error.message}
						<button type="button" data-testid="talk-retry" className="lh-press lh-btn" onClick={retry}>
							Try again
						</button>
					</p>
				)}
				{clearError && (
					<p data-testid="talk-clear-failed" className="mt-4 text-[15px] text-ink-2">
						{clearError}
					</p>
				)}
				<div ref={endRef} />
			</div>
			<div data-testid="talk-box" className="flex shrink-0 flex-col gap-2 border-t border-edge px-3.5 pt-3 pb-3.5" {...attachmentInputProps(attachments)}>
				<AttachmentTray draft={attachments} />
				<div className="flex items-end gap-2.5 rounded-[2px] border-[1.5px] border-ink bg-background py-[9px] pr-[9px] pl-3.5">
					<div className="flex max-h-32 min-h-[34px] min-w-0 flex-1">
						<MathBox
							value={text}
							onChange={editText}
							onEnter={() => {
								send();
								return true;
							}}
							placeholder={`Tell ${name} what to set up, or ask about your spaces`}
							ariaLabel={`Message ${name}`}
						/>
					</div>
					{busy ? (
						<SendButton testId="talk-stop" onClick={stopReply} label="Stop" />
					) : (
						<SendButton testId="talk-send" onClick={send} disabled={!text.trim() && attachments.files.length === 0} label="Send" />
					)}
				</div>
				<div className="flex">
					<AttachButton draft={attachments} />
				</div>
			</div>
			{clearSlot &&
				rows.length > 0 &&
				createPortal(
					<button type="button" data-testid="talk-clear" disabled={busy} onClick={clear} className="lh-press lh-btn lh-btn-quiet text-[15px]">
						Clear chat
					</button>,
					clearSlot,
				)}
		</div>
	);
}
