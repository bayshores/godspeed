import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChatAttachment, CheatSheetView, SheetMessage, SheetRegion, SheetRule } from "@/shared/core";
import { JobFailure } from "@/frontend/components/agent-setup/agent-card";
import { ApprovalCards } from "@/frontend/components/lesson/approval-card";
import { useArrivals } from "@/frontend/components/lesson/arrivals";
import { useAttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { restoreUnsent } from "@/frontend/components/lesson/chat-helpers";
import { LessonBox } from "@/frontend/components/lesson/lesson-box";
import { savedDay } from "@/frontend/components/rule-chips";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useFold } from "@/frontend/components/use-fold";
import { cn } from "@/frontend/lib/utils";
import type { Pointed } from "./canvas-model";
import { sheetBox } from "./sheet-box-model";
import { sheetFilePath } from "./use-cheat-sheet";
import { TeacherThread, type ThreadLine } from "@/frontend/components/teacher/teacher-thread";

/** "the back of version 3", "page 1 of version 2". */
export function pointedLabel(region: SheetRegion, pages: number): string {
	const page = pages === 2 ? (region.page === 1 ? "the front" : "the back") : `page ${region.page}`;
	return `${page} of version ${region.n}`;
}

/** A small boxed note in the chat (a version made). */
const NOTE = "flex items-center gap-2.5 lh-well self-start lh-notch px-2.5 py-1.5 text-base text-ink";

/**
 * THE SHEET'S CHAT: the sheet's rules (each with a remove ✕), then the
 * conversation as the teacher panel's chat draws it (TeacherThread): the
 * learner's messages on plates with the part they pointed at and their
 * pictures, the agent's answers (markdown and math) with a "Made version N"
 * note that shows that version on the canvas and the rules it saved. The learner writes in the box at its foot (the lesson's box, with
 * sheetBox's one key), and a line carries the part pointed at. Stop while
 * the agent works, Try again when it failed.
 */
export function SheetChat({
	view,
	spaceId,
	deadlineId,
	act,
	agentName,
	pointed,
	onClearPointed,
	onShowVersion,
	empty,
	bare,
	className,
}: {
	view: CheatSheetView;
	spaceId: string;
	deadlineId: string;
	/** Posts one action; resolves to the error line, or null. */
	act: (body: Record<string, unknown>) => Promise<string | null>;
	agentName: string;
	pointed: Pointed | null;
	onClearPointed: () => void;
	/** Shows a version on the canvas; absent when that version isn't there. */
	onShowVersion?: (n: number) => void;
	/** The line an empty chat shows; absent when the page says it elsewhere. */
	empty?: string;
	/** Nothing is said yet and the page has no place for a chat: only the box and what stands in the way of asking. */
	bare?: boolean;
	className?: string;
}) {
	const [failed, setFailed] = useState<string | null>(null);
	const [text, setText] = useState("");
	const attachments = useAttachmentDraft(`cheat-sheet:${deadlineId}`);
	const boxRef = useRef<{ focus(): void }>(null);
	const busy = view.running !== null;
	const messages = view.sheet.messages;
	const endRef = useRef<HTMLDivElement>(null);
	// Before the picture is drawn: a chat that opens long is never seen at its top first.
	useLayoutEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [messages.length, busy, view.error]);

	const post = (body: Record<string, unknown>) => void act(body).then(setFailed);
	const arrive = useArrivals();
	const slot = useId();
	const answer = (id: string, allow: boolean) => act({ action: "approval", id, allow });
	// False when the sheet can't take the line now: the box keeps it.
	const sendLine = async (line: string, files: ChatAttachment[]): Promise<boolean> => {
		if (busy || view.newer || (!line.trim() && files.length === 0 && !pointed)) return false;
		const all = [...(pointed ? [pointed.picture] : []), ...files];
		const error = await act({
			action: "ask",
			text: line.trim(),
			...(all.length > 0 ? { attachments: all } : {}),
			...(pointed ? { region: pointed.region } : {}),
		});
		setFailed(error);
		if (error) return false;
		onClearPointed();
		return true;
	};
	const sendBox = () => {
		const typed = text;
		const files = attachments.files;
		setText("");
		attachments.clear();
		void sendLine(typed, files.map((f) => f.attachment)).then((sent) => {
			if (sent) return;
			setText((draft) => restoreUnsent(typed, draft));
			attachments.restore(files);
		});
	};
	// The part pointed at goes with the next line, so the box is ready for it.
	useEffect(() => {
		if (pointed) boxRef.current?.focus();
	}, [pointed]);

	const pagesOf = (n: number) => view.sheet.versions.find((v) => v.n === n)?.pages.length ?? 1;
	const notes = (
		<>
			{(failed || view.newer) && (
				<p role="alert" className="text-ui text-ans-wrong">
					{view.newer ? "A newer godspeed saved this cheat sheet. Update godspeed to change it." : failed}
				</p>
			)}
			{pointed && <PointedChip pointed={pointed} pages={pagesOf(pointed.region.n)} onClear={onClearPointed} />}
		</>
	);
	const box = (
		<LessonBox
			view={sheetBox({ teacher: agentName, made: view.sheet.versions.length > 0, blocked: busy || !!view.newer, hasText: text.trim().length > 0, hasFiles: attachments.files.length > 0, pointed: !!pointed })}
			value={text}
			onChange={setText}
			onAct={sendBox}
			attachments={attachments}
			boxRef={boxRef}
		/>
	);
	if (bare)
		return (
			<div data-testid="sheet-box" className="flex w-full max-w-[520px] flex-col gap-2.5 text-left">
				{notes}
				{box}
			</div>
		);

	return (
		<div data-testid="sheet-chat" className={cn("flex min-h-0 flex-1 flex-col", className)}>
			<div data-testid="sheet-thread" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-[22px] pt-[18px] pb-[22px]">
				<SheetRules rules={view.sheet.rules} agentName={agentName} onRemove={(rule) => post({ action: "remove-rule", text: rule })} />
				{empty && messages.length === 0 && (
					<p data-testid="sheet-chat-empty" className="text-ui leading-snug text-ink-2">
						{empty}
					</p>
				)}
				<TeacherThread
					lines={messages.map((m): ThreadLine =>
						m.role === "you"
							? {
									key: m.id,
									who: "you",
									text: m.text ?? "",
									over: m.region && (
										<p data-testid="sheet-pointed" className="text-ui text-ink-2">
											Pointed at {pointedLabel(m.region, pagesOf(m.region.n))}
										</p>
									),
									under: <YouFiles message={m} spaceId={spaceId} deadlineId={deadlineId} />,
								}
							: { key: m.id, who: "teacher", text: m.text ?? "", under: <AgentNotes message={m} current={view.sheet.versions.at(-1)?.n ?? null} onShowVersion={onShowVersion} /> },
					)}
					arrive={arrive}
					live={
						<>
							{view.running && (
								<p data-testid="sheet-working" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-ui text-ink-2">
									<span>{agentName} is on it</span>
									<button type="button" data-testid="sheet-stop" onClick={() => post({ action: "stop" })} className="lh-btn lh-btn-quiet">
										Stop
									</button>
								</p>
							)}
							{view.running && <ApprovalCards approvals={view.approvals} slot={slot} arrive={arrive} answer={answer} />}
							{!busy && view.error && (
								<JobFailure>
									<p data-testid="sheet-failed" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-ui text-ink-2">
										<span>
											<span className="text-ans-wrong">{agentName} couldn&apos;t finish that.</span> {view.error.text}
										</span>
										<button type="button" data-testid="sheet-retry" onClick={() => post({ action: "retry" })} className="lh-btn">
											Try again
										</button>
									</p>
								</JobFailure>
							)}
						</>
					}
				/>
				<div ref={endRef} />
			</div>
			<div data-testid="sheet-box" className="flex shrink-0 flex-col gap-2.5 px-[22px] pt-2.5 pb-[22px]">
				{notes}
				{box}
			</div>
		</div>
	);
}

/** The learner's files under their words: pictures, and other files as chips. */
function YouFiles({ message, spaceId, deadlineId }: { message: Extract<SheetMessage, { role: "you" }>; spaceId: string; deadlineId: string }) {
	const files = message.files ?? [];
	if (files.length === 0) return null;
	return (
		<div className="flex flex-wrap items-start gap-2">
			{files.map((f, i) =>
				f.file && !/\.pdf$/i.test(f.file) ? (
					<img key={i} data-testid="sheet-picture" src={sheetFilePath(spaceId, deadlineId, f.file)} alt={f.name} className="block max-h-[160px] w-auto max-w-full lh-notch lh-well p-1" />
				) : (
					<span key={i} data-testid="sheet-file" className="flex h-8 max-w-56 lh-well items-center lh-notch px-3 text-base text-ink">
						<span className="truncate" title={f.name}>
							{f.name}
						</span>
					</span>
				),
			)}
		</div>
	);
}

/** Under the agent's words: the version it made, which shows on the canvas, and the rules it saved. */
function AgentNotes({ message, current, onShowVersion }: { message: Extract<SheetMessage, { role: "agent" }>; current: number | null; onShowVersion?: (n: number) => void }) {
	const n = message.version;
	return (
		<>
			{n !== undefined && (
				<button type="button" data-testid="sheet-made" disabled={!onShowVersion} onClick={() => onShowVersion?.(n)} className={cn(NOTE, "lh-press max-w-full text-left enabled:hover:bg-tone disabled:cursor-default")}>
					<span className="min-w-0 truncate">
						Made version {n}
						{n === current ? ", the sheet now" : ""}
					</span>
					{onShowVersion && <span className="shrink-0 px-1 text-ui font-medium text-ink-2">Show</span>}
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
 *  toggle, then the rules as chips. Every one was saved by
 *  the agent (the learner removes them, never adds). */
function SheetRules({ rules, agentName, onRemove }: { rules: readonly SheetRule[]; agentName: string; onRemove: (rule: string) => void }) {
	const [open, setOpen] = useState(true);
	const fold = useFold(open);
	if (rules.length === 0) return null;
	return (
		<div data-testid="sheet-rules" className="flex shrink-0 flex-col gap-3.5">
			<button type="button" data-testid="sheet-rules-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="lh-btn lh-btn-quiet lh-btn-small lh-btn-flush self-start">
				<PixelIcon name="chevron" className={cn("transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", open && "rotate-90")} />
				This sheet&apos;s rules ({rules.length})
			</button>
			{fold.mounted && (
				<div className="lh-collapse" data-state={fold.state}>
					<div>
						<ul className="flex flex-col items-start gap-1.5">
							{rules.map((rule) => (
								<li key={rule.text} data-testid="sheet-rule" className="flex max-w-full items-center lh-well gap-2.5 lh-notch py-1.5 pr-2 pl-3 text-base text-ink">
									<span className="min-w-0 break-words">{rule.text}</span>
									<span title={savedDay(rule.at)} className="shrink-0 text-sm whitespace-nowrap text-ink-2">
										Saved by {agentName}
									</span>
									<button type="button" aria-label={`Remove rule: ${rule.text}`} onClick={() => onRemove(rule.text)} className="lh-press shrink-0 p-0.5 text-ink-2 hover:text-ink">
										<PixelIcon name="close" />
									</button>
								</li>
							))}
						</ul>
					</div>
				</div>
			)}
		</div>
	);
}

/** The part of the sheet pointed at, waiting to go with the next line. */
function PointedChip({ pointed, pages, onClear }: { pointed: Pointed; pages: number; onClear: () => void }) {
	return (
		<div data-testid="sheet-pointed-chip" className="flex max-w-full items-center gap-2.5 lh-well self-start lh-notch py-1.5 pr-2 pl-1.5">
			<img src={`data:${pointed.picture.mimeType};base64,${pointed.picture.data}`} alt="" className="block h-6 w-auto max-w-12 bg-white object-contain" />
			<span className="min-w-0 truncate text-base text-ink">Pointing at {pointedLabel(pointed.region, pages)}</span>
			<button type="button" aria-label="Don't send the part you pointed at" onClick={onClear} className="lh-press shrink-0 p-0.5 text-ink-2 hover:text-ink">
				<PixelIcon name="close" />
			</button>
		</div>
	);
}
