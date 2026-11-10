import { useCallback, useEffect, useRef, useState } from "react";
import { BookmarkCheckIcon, CrosshairIcon, FileTextIcon, SquareIcon, XIcon } from "lucide-react";
import type { CheatSheetView, SheetAbout, SheetMessage, SheetRegion } from "@/shared/core";
import { MessageResponse } from "@/frontend/components/ai-elements/message";
import { NoAgentLine } from "@/frontend/components/agent-folder/no-agent-line";
import { BrailleSpinner } from "@/frontend/components/braille-spinner";
import { AttachButton, AttachmentTray, attachmentInputProps, useAttachmentDraft, type AttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { SendButton } from "@/frontend/components/lesson/panel-parts";
import { MathBox } from "@/frontend/components/math-box";
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

/**
 * THE SHEET'S CHAT: the sheet's rules (each with a remove ✕), then the
 * conversation laid out like Talk, the speaker in the margin: the
 * learner's messages with their pictures, the part they pointed at and
 * the problem they were on, the agent's answers (markdown and math) with a
 * "Made version N" row that shows that version on the canvas and the rules
 * it saved. The box takes words, math, pictures and PDFs, and the part of
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
	/** The line an empty chat shows. */
	empty: string;
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

	const margin = cn("w-20 shrink-0 truncate", LABEL_TEXT);
	const pagesOf = (n: number) => view.sheet.versions.find((v) => v.n === n)?.pages.length ?? 1;

	return (
		<div data-testid="sheet-chat" className={cn("flex min-h-0 flex-1 flex-col", className)}>
			<SheetRules rules={view.sheet.rules.map((r) => r.text)} agentName={agentName} onRemove={(rule) => post({ action: "remove-rule", text: rule })} />
			<div data-testid="sheet-thread" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
				{messages.length === 0 && (
					<p data-testid="sheet-chat-empty" className="text-[14px] leading-5 text-ink-2">
						{empty}
					</p>
				)}
				{messages.map((m, i) => {
					const first = i === 0 || messages[i - 1]!.role !== m.role;
					return (
						<div key={m.id} data-testid="sheet-row" className={cn("flex gap-3", i > 0 && (first ? "mt-4" : "mt-2"))}>
							<span className={margin}>{first ? (m.role === "you" ? "You" : agentName) : ""}</span>
							<div className="flex min-w-0 flex-1 flex-col gap-1.5">
								{m.role === "you" ? (
									<YouBody message={m} classId={classId} deadlineId={deadlineId} pages={pagesOf} />
								) : (
									<AgentBody message={m} current={view.sheet.versions.at(-1)?.n ?? null} onShowVersion={onShowVersion} />
								)}
								{view.running?.messageId === m.id && (
									<p data-testid="sheet-working" className="flex items-center gap-2 text-[13px] text-ink-3">
										<BrailleSpinner className="h-3 text-ink-3" />
										{agentGone ? "Waiting for an agent" : `${agentName} is on it`}
									</p>
								)}
								{!busy && view.error?.messageId === m.id && (
									<p data-testid="sheet-failed" className="text-[13px] text-ink-2">
										<span className="text-ans-wrong">{agentName} couldn&apos;t finish that.</span> {view.error.text}{" "}
										<button type="button" data-testid="sheet-retry" onClick={() => post({ action: "retry" })} className="lh-press font-bold text-ink underline underline-offset-2">
											Try again
										</button>
									</p>
								)}
							</div>
						</div>
					);
				})}
				<div ref={endRef} />
			</div>
			<div data-testid="sheet-box" className="shrink-0 border-t border-tone-2" {...attachmentInputProps(attachments)}>
				<div className="flex flex-col gap-2 px-5 empty:hidden">
					<NoAgentLine className="pt-3" />
					{(failed || view.newer) && (
						<p role="alert" className="pt-3 text-[13px] text-ans-wrong">
							{view.newer ? "A newer godspeed saved this cheat sheet. Update godspeed to change it." : failed}
						</p>
					)}
					{pointed && <PointedChip pointed={pointed} pages={pagesOf(pointed.region.n)} onClear={onClearPointed} />}
					<AttachmentTray draft={attachments} />
				</div>
				<div className="m-4 border border-tone-2 bg-background has-[.cm-focused]:border-ink-2">
					<MathBox
						compact
						value={text}
						onChange={setText}
						onEnter={() => void send()}
						placeholder={view.sheet.versions.length > 0 ? "Ask about the sheet, or say what to change" : "What do you want on your cheat sheet?"}
						ariaLabel={`Message ${agentName} about the cheat sheet`}
					/>
					<ComposerBar attachments={attachments} busy={busy} disabled={nothing || sending || !!view.newer} onSend={() => void send()} onStop={() => post({ action: "stop" })} />
				</div>
			</div>
		</div>
	);
}

function ComposerBar({ attachments, busy, disabled, onSend, onStop }: { attachments: AttachmentDraft; busy: boolean; disabled: boolean; onSend: () => void; onStop: () => void }) {
	return (
		<div className="flex items-center gap-2 p-2">
			<AttachButton draft={attachments} />
			{busy ? (
				<SendButton
					testId="sheet-stop"
					waiting
					onClick={onStop}
					label={
						<>
							<SquareIcon aria-hidden className="size-3.5" />
							Stop
						</>
					}
				/>
			) : (
				<SendButton testId="sheet-send" onClick={onSend} disabled={disabled} label="Send" />
			)}
		</div>
	);
}

function YouBody({ message, classId, deadlineId, pages }: { message: Extract<SheetMessage, { role: "you" }>; classId: string; deadlineId: string; pages: (n: number) => number }) {
	const files = message.files ?? [];
	return (
		<>
			{message.text && (
				<p data-testid="sheet-you" className="text-[14px] leading-5 whitespace-pre-wrap break-words text-ink">
					{message.text}
				</p>
			)}
			{message.region && (
				<p data-testid="sheet-pointed" className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
					<CrosshairIcon aria-hidden className="size-3.5 shrink-0" />
					Pointed at {pointedLabel(message.region, pages(message.region.n))}
				</p>
			)}
			{message.about && (
				<p data-testid="sheet-you-about" className="truncate text-[12.5px] text-ink-3" title={message.about.text}>
					About the {message.about.kind} in {message.about.session}
				</p>
			)}
			{files.length > 0 && (
				<div className="flex flex-wrap items-start gap-2">
					{files.map((f, i) =>
						f.file && !/\.pdf$/i.test(f.file) ? (
							<img key={i} data-testid="sheet-picture" src={sheetFilePath(classId, deadlineId, f.file)} alt={f.name} className="block max-h-[160px] w-auto max-w-full border border-tone-2" />
						) : (
							<span key={i} data-testid="sheet-file" className="flex h-9 max-w-56 items-center gap-2 border border-tone-2 bg-tone px-3 text-[13px] text-ink">
								<FileTextIcon aria-hidden className="size-4 shrink-0 text-ink-2" />
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
				<div data-testid="sheet-agent" className="min-w-0 break-words text-ink" style={{ "--lh-prose-size": "14px", "--lh-prose-leading": `${20 / 14}` } as React.CSSProperties}>
					<MessageResponse>{message.text}</MessageResponse>
				</div>
			)}
			{n !== undefined && (
				<button
					type="button"
					data-testid="sheet-made"
					disabled={!onShowVersion}
					onClick={() => onShowVersion?.(n)}
					className="lh-press flex w-full items-center gap-2 bg-tone px-3 py-2 text-left text-[13px] text-ink-2 enabled:hover:text-ink disabled:cursor-default"
				>
					<span className="min-w-0 flex-1 truncate">
						Made version {n}
						{n === current ? ", the sheet now" : ""}
					</span>
					{onShowVersion && <span className="shrink-0 font-bold text-ink-3">Show</span>}
				</button>
			)}
			{(message.rules ?? []).map((rule) => (
				<p key={rule} data-testid="sheet-rule-saved" className="flex min-w-0 items-start gap-2 text-[13px] text-ink-2">
					<BookmarkCheckIcon className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
					<span className="min-w-0">
						Saved a rule for this sheet: <span className="text-ink">{rule}</span>
					</span>
				</p>
			))}
		</>
	);
}

/** The sheet's rules above the chat: what every change keeps to. */
function SheetRules({ rules, agentName, onRemove }: { rules: readonly string[]; agentName: string; onRemove: (rule: string) => void }) {
	const [open, setOpen] = useState(true);
	if (rules.length === 0) return null;
	return (
		<div data-testid="sheet-rules" className="shrink-0 border-b border-tone-2 px-5 py-3">
			<button type="button" data-testid="sheet-rules-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="lh-press text-[13px] font-bold text-ink-2 hover:text-ink">
				This sheet&apos;s rules ({rules.length})
			</button>
			{open && (
				<>
					<p className="mt-0.5 text-[12.5px] text-ink-3">{agentName} keeps to these every time it changes the sheet.</p>
					<ul className="mt-2 flex flex-wrap gap-1.5">
						{rules.map((rule) => (
							<li key={rule} data-testid="sheet-rule" className="flex max-w-full items-center gap-2 bg-tone-2 py-[5px] pr-[9px] pl-[11px] text-[13px] text-ink">
								<span className="min-w-0 break-words">{rule}</span>
								<button type="button" aria-label={`Remove rule: ${rule}`} onClick={() => onRemove(rule)} className="lh-press shrink-0 text-ink-2 hover:text-ink">
									<XIcon className="size-3" aria-hidden />
								</button>
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	);
}

/** The part of the sheet pointed at, waiting to go with the next message. */
function PointedChip({ pointed, pages, onClear }: { pointed: Pointed; pages: number; onClear: () => void }) {
	return (
		<div data-testid="sheet-pointed-chip" className="flex items-center gap-2.5 pt-3">
			<img src={`data:${pointed.picture.mimeType};base64,${pointed.picture.data}`} alt="" className="block h-10 w-auto max-w-24 border border-tone-2 bg-white object-contain" />
			<span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">Pointing at {pointedLabel(pointed.region, pages)}</span>
			<button type="button" aria-label="Don't send the part you pointed at" onClick={onClear} className="lh-press flex size-7 shrink-0 items-center justify-center text-ink-3 hover:bg-tone hover:text-ink">
				<XIcon className="size-3.5" aria-hidden />
			</button>
		</div>
	);
}
