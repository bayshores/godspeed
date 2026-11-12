"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { CheatSheetView, SheetAbout, SheetMessage, SheetRegion, SheetRule } from "@/shared/core";
import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { NoAgentLine } from "@/frontend/components/agent-folder/no-agent-line";
import { AttachButton, AttachmentTray, attachmentInputProps, useAttachmentDraft, type AttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { SendButton } from "@/frontend/components/ui/send-button";
import { MathBox } from "@/frontend/components/math-box";
import { savedDay } from "@/frontend/components/rule-chips";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import type { Pointed } from "./canvas-model";
import { sheetFilePath } from "./use-cheat-sheet";
import { LABEL_TEXT } from "@/frontend/components/ui/label-text";

/** "the back of version 3", "page 1 of version 2". */
export function pointedLabel(region: SheetRegion, pages: number): string {
	const page = pages === 2 ? (region.page === 1 ? "the front" : "the back") : `page ${region.page}`;
	return `${page} of version ${region.n}`;
}

/** What's typed in a sheet's box, kept in this browser so leaving the
 *  studio, closing the sheet beside a session or a reload never loses it. */
function useSheetDraft(deadlineId: string): [string, (text: string) => void] {
	const key = `lh:sheet-draft:${deadlineId}`;
	const [text, setText] = useState("");
	useEffect(() => {
		try {
			setText(localStorage.getItem(key) ?? "");
		} catch {
			/* no storage: start empty */
		}
	}, [key]);
	const save = useCallback(
		(next: string) => {
			setText(next);
			try {
				if (next) localStorage.setItem(key, next);
				else localStorage.removeItem(key);
			} catch {
				/* no storage or full: the draft stays in memory */
			}
		},
		[key],
	);
	return [text, save];
}

/** A small boxed note in the chat (a version made, a part pointed at). */
const NOTE = "flex items-center gap-2.5 self-start rounded border border-border bg-background px-2.5 py-1.5 text-base text-ink";

/**
 * THE SHEET'S CHAT: the sheet's rules (each with a remove ✕), then the
 * conversation, each speaker named above their words: the learner's
 * messages with the part they pointed at, their pictures and the problem
 * they were on, the agent's answers (markdown and math) with a "Made
 * version N" note that shows that version on the canvas and the rules it
 * saved. The one box takes words, math, pictures and PDFs, and the part of
 * the sheet pointed at; Stop while the agent works, Try again when it
 * failed. The studio and the sheet beside a session both show it.
 */
export function SheetChat({
	view,
	classId,
	deadlineId,
	act,
	agentName,
	agentGone,
	pointed,
	onClearPointed,
	about,
	onShowVersion,
	empty,
	className,
}: {
	view: CheatSheetView;
	classId: string;
	deadlineId: string;
	/** Posts one action; resolves to the error line, or null. */
	act: (body: Record<string, unknown>) => Promise<string | null>;
	agentName: string;
	/** No agent connected: a request waits for one. */
	agentGone: boolean;
	pointed: Pointed | null;
	onClearPointed: () => void;
	/** The problem or question the learner is on, sent with each message
	 *  (the sheet beside a session). */
	about?: SheetAbout | null;
	/** Shows a version on the canvas; absent when that version isn't there. */
	onShowVersion?: (n: number) => void;
	/** The line an empty chat shows; absent when the page says it elsewhere. */
	empty?: string;
	className?: string;
}) {
	const [text, setText] = useSheetDraft(deadlineId);
	const attachments = useAttachmentDraft(`cheat-sheet:${deadlineId}`);
	const [sending, setSending] = useState(false);
	const [failed, setFailed] = useState<string | null>(null);
	const busy = view.running !== null;
	const messages = view.sheet.messages;
	const endRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [messages.length, busy, view.error]);

	const post = (body: Record<string, unknown>) => void act(body).then(setFailed);
	const nothing = !text.trim() && attachments.files.length === 0 && !pointed;
	const send = async () => {
		if (nothing || busy || sending || view.newer) return;
		const files = attachments.files;
		const sent = text;
		setSending(true);
		setText("");
		attachments.clear();
		const all = [...(pointed ? [pointed.picture] : []), ...files.map((f) => f.attachment)];
		const error = await act({
			action: "ask",
			text: sent.trim(),
			...(all.length > 0 ? { attachments: all } : {}),
			...(pointed ? { region: pointed.region } : {}),
			...(about ? { about } : {}),
		});
		setSending(false);
		setFailed(error);
		if (error) {
			setText(sent);
			attachments.restore(files);
		} else onClearPointed();
	};

	const pagesOf = (n: number) => view.sheet.versions.find((v) => v.n === n)?.pages.length ?? 1;

	return (
		<div data-testid="sheet-chat" className={cn("flex min-h-0 flex-1 flex-col", className)}>
			<div data-testid="sheet-thread" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-[22px] pt-[18px]">
				<SheetRules rules={view.sheet.rules} agentName={agentName} onRemove={(rule) => post({ action: "remove-rule", text: rule })} />
				{empty && messages.length === 0 && (
					<p data-testid="sheet-chat-empty" className="text-[15px] leading-snug text-ink-2">
						{empty}
					</p>
				)}
				{messages.map((m, i) => {
					const first = i === 0 || messages[i - 1]!.role !== m.role;
					return (
						<Fragment key={m.id}>
							<div data-testid="sheet-row" className="flex min-w-0 flex-col gap-1">
								{first && <span className={cn("truncate", LABEL_TEXT)}>{m.role === "you" ? "You" : agentName}</span>}
								{m.role === "you" ? (
									<YouBody message={m} classId={classId} deadlineId={deadlineId} pages={pagesOf} />
								) : (
									<AgentBody message={m} current={view.sheet.versions.at(-1)?.n ?? null} onShowVersion={onShowVersion} />
								)}
							</div>
							{view.running?.messageId === m.id && (
								<p data-testid="sheet-working" className="text-[15px] text-ink-2">
									{agentGone ? "Waiting for an agent" : `${agentName} is on it`}
								</p>
							)}
							{!busy && view.error?.messageId === m.id && (
								<p data-testid="sheet-failed" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[15px] text-ink-2">
									<span>
										<span className="text-ans-wrong">{agentName} couldn&apos;t finish that.</span> {view.error.text}
									</span>
									<button type="button" data-testid="sheet-retry" onClick={() => post({ action: "retry" })} className="lh-btn text-[15px]">
										Try again
									</button>
								</p>
							)}
						</Fragment>
					);
				})}
				<div ref={endRef} />
			</div>
			<div data-testid="sheet-box" className="flex shrink-0 flex-col gap-2.5 px-[22px] pb-[22px]" {...attachmentInputProps(attachments)}>
				<NoAgentLine />
				{(failed || view.newer) && (
					<p role="alert" className="text-[15px] text-ans-wrong">
						{view.newer ? "A newer godspeed saved this cheat sheet. Update godspeed to change it." : failed}
					</p>
				)}
				{pointed && <PointedChip pointed={pointed} pages={pagesOf(pointed.region.n)} onClear={onClearPointed} />}
				<AttachmentTray draft={attachments} />
				<div className="flex min-h-[130px] flex-col rounded border-[1.5px] border-ink bg-background">
					<div className="flex max-h-32 min-h-0 flex-1">
						<MathBox
							value={text}
							onChange={setText}
							onEnter={() => {
								void send();
								return true;
							}}
							placeholder={view.sheet.versions.length > 0 ? "Ask about the sheet, or say what to change" : "What do you want on your cheat sheet?"}
							ariaLabel={`Message ${agentName} about the cheat sheet`}
						/>
					</div>
					<ComposerBar attachments={attachments} busy={busy} disabled={nothing || sending || !!view.newer} onSend={() => void send()} onStop={() => post({ action: "stop" })} />
				</div>
			</div>
		</div>
	);
}

function ComposerBar({ attachments, busy, disabled, onSend, onStop }: { attachments: AttachmentDraft; busy: boolean; disabled: boolean; onSend: () => void; onStop: () => void }) {
	return (
		<div className="flex items-center gap-2 pr-2.5 pb-2.5 pl-2">
			<AttachButton draft={attachments} />
			{busy ? <SendButton testId="sheet-stop" onClick={onStop} label="Stop" /> : <SendButton testId="sheet-send" onClick={onSend} disabled={disabled} label="Send" />}
		</div>
	);
}

function YouBody({ message, classId, deadlineId, pages }: { message: Extract<SheetMessage, { role: "you" }>; classId: string; deadlineId: string; pages: (n: number) => number }) {
	const files = message.files ?? [];
	return (
		<>
			{message.region && (
				<p data-testid="sheet-pointed" className={NOTE}>
					Pointed at {pointedLabel(message.region, pages(message.region.n))}
				</p>
			)}
			{message.text && (
				<p data-testid="sheet-you" className="font-prose text-lg leading-normal whitespace-pre-wrap break-words text-ink">
					{message.text}
				</p>
			)}
			{message.about && (
				<p data-testid="sheet-you-about" className="truncate text-base text-ink-2" title={message.about.text}>
					About the {message.about.kind} in {message.about.session}
				</p>
			)}
			{files.length > 0 && (
				<div className="flex flex-wrap items-start gap-2">
					{files.map((f, i) =>
						f.file && !/\.pdf$/i.test(f.file) ? (
							// eslint-disable-next-line @next/next/no-img-element -- the learner's picture, kept beside the sheet
							<img key={i} data-testid="sheet-picture" src={sheetFilePath(classId, deadlineId, f.file)} alt={f.name} className="block max-h-[160px] w-auto max-w-full rounded border border-border" />
						) : (
							<span key={i} data-testid="sheet-file" className="flex h-8 max-w-56 items-center rounded border border-border bg-background px-3 text-base text-ink">
								<span className="truncate" title={f.name}>
									{f.name}
								</span>
							</span>
						),
					)}
				</div>
			)}
		</>
	);
}

function AgentBody({ message, current, onShowVersion }: { message: Extract<SheetMessage, { role: "agent" }>; current: number | null; onShowVersion?: (n: number) => void }) {
	const n = message.version;
	return (
		<>
			{message.text && (
				<div data-testid="sheet-agent" className="min-w-0 font-prose break-words text-ink" style={{ "--lh-prose-size": "16px", "--lh-prose-leading": "1.5" } as React.CSSProperties}>
					<MessageResponse>{message.text}</MessageResponse>
				</div>
			)}
			{n !== undefined && (
				<button type="button" data-testid="sheet-made" disabled={!onShowVersion} onClick={() => onShowVersion?.(n)} className={cn(NOTE, "lh-press max-w-full text-left enabled:hover:bg-tone disabled:cursor-default")}>
					<span className="min-w-0 truncate">
						Made version {n}
						{n === current ? ", the sheet now" : ""}
					</span>
					{onShowVersion && <span className="shrink-0 px-1 text-[15px] font-medium text-ink-2">Show</span>}
				</button>
			)}
			{(message.rules ?? []).map((rule) => (
				<p key={rule} data-testid="sheet-rule-saved" className="min-w-0 text-base text-ink-2">
					Saved a rule for this sheet: {rule}
				</p>
			))}
		</>
	);
}

/** The sheet's rules above the chat, what every change keeps to: a
 *  toggle, the rules as chips, then a dotted rule. Every one was saved by
 *  the agent (the learner removes them, never adds). */
function SheetRules({ rules, agentName, onRemove }: { rules: readonly SheetRule[]; agentName: string; onRemove: (rule: string) => void }) {
	const [open, setOpen] = useState(true);
	if (rules.length === 0) return null;
	return (
		<div data-testid="sheet-rules" className="flex shrink-0 flex-col gap-3.5">
			<button type="button" data-testid="sheet-rules-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="lh-btn lh-btn-quiet self-start px-1 text-[15px]">
				<PixelIcon name="chevron" className={open ? "rotate-90" : undefined} />
				This sheet&apos;s rules ({rules.length})
			</button>
			{open && (
				<ul className="flex flex-col items-start gap-1.5">
					{rules.map((rule) => (
						<li key={rule.text} data-testid="sheet-rule" className="flex max-w-full items-center gap-2.5 rounded border border-border bg-background py-1.5 pr-2 pl-3 text-base text-ink">
							<span className="min-w-0 break-words">{rule.text}</span>
							<span title={savedDay(rule.at)} className="shrink-0 text-sm whitespace-nowrap text-ink-2">
								Saved by {agentName}
							</span>
							<button type="button" aria-label={`Remove rule: ${rule.text}`} onClick={() => onRemove(rule.text)} className="lh-press shrink-0 p-0.5 text-ink-2 hover:text-ink">
								<PixelIcon name="close" className="h-[10.5px]" />
							</button>
						</li>
					))}
				</ul>
			)}
			<span aria-hidden className="h-0 w-full border-t-2 border-dotted border-edge" />
		</div>
	);
}

/** The part of the sheet pointed at, waiting to go with the next message. */
function PointedChip({ pointed, pages, onClear }: { pointed: Pointed; pages: number; onClear: () => void }) {
	return (
		<div data-testid="sheet-pointed-chip" className="flex max-w-full items-center gap-2.5 self-start rounded border border-border bg-background py-1.5 pr-2 pl-1.5">
			{/* eslint-disable-next-line @next/next/no-img-element -- the part of the sheet, drawn in this window */}
			<img src={`data:${pointed.picture.mimeType};base64,${pointed.picture.data}`} alt="" className="block h-6 w-auto max-w-12 border border-border bg-white object-contain" />
			<span className="min-w-0 truncate text-base text-ink">Pointing at {pointedLabel(pointed.region, pages)}</span>
			<button type="button" aria-label="Don't send the part you pointed at" onClick={onClear} className="lh-press shrink-0 p-0.5 text-ink-2 hover:text-ink">
				<PixelIcon name="close" className="h-[10.5px]" />
			</button>
		</div>
	);
}
