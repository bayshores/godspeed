import { MathBox } from "@/frontend/components/math-box";
import { QueuedSteersBody, type QueuedSteerLine } from "@/frontend/components/queued-steers";
import { cn } from "@/frontend/lib/utils";
import { AttachmentTray, attachmentInputProps, type AttachmentDraft } from "./attachment-tray";
import type { BoxAction, BoxButton, BoxView } from "./lesson-box-model";

const BUTTON_ID: Record<BoxButton["action"], string> = {
	send: "composer-send",
	submit: "question-submit",
	reveal: "teach-check-reveal",
	next: "next-problem-button",
};

/**
 * The lesson's one writing box, at the foot of the teacher column: every
 * message, answer in words, reasoning and piece of work is typed here.
 * Which buttons it shows and what Enter does come from lessonBox; this
 * only draws them.
 */
export function LessonBox({
	view,
	value,
	onChange,
	onAct,
	onFocus,
	queuedSteers,
	attachments,
	boxRef,
}: {
	view: BoxView;
	value: string;
	onChange: (v: string) => void;
	onAct: (action: BoxAction) => void;
	onFocus: () => void;
	queuedSteers: QueuedSteerLine[];
	attachments: AttachmentDraft;
	boxRef: React.Ref<{ focus(): void }>;
}) {
	const button = (b: BoxButton, className?: string) => (
		<button type="button" data-testid={BUTTON_ID[b.action]} disabled={b.disabled} onClick={() => onAct(b.action)} className={cn("lh-btn shrink-0", b.filled && "lh-btn-main", b.hidden && "invisible", className)}>
			{b.label}
		</button>
	);
	return (
		<div data-testid="composer" className="flex min-h-[112px] flex-1 flex-col gap-2" {...attachmentInputProps(attachments)}>
			{queuedSteers.length > 0 && <QueuedSteersBody steers={queuedSteers} />}
			<AttachmentTray draft={attachments} note={view.note ?? undefined} />
			<div className="flex min-h-0 flex-1 flex-col rounded-[2px] border-[1.5px] border-ink bg-background">
				<MathBox
					ref={boxRef}
					value={value}
					onChange={onChange}
					onEnter={() => {
						if (view.enter === null) return false;
						onAct(view.enter);
						return true;
					}}
					onFocus={onFocus}
					placeholder={view.placeholder}
					ariaLabel={view.placeholder}
				/>
				<div className="flex shrink-0 flex-wrap items-center gap-2 pr-2.5 pb-2.5 pl-3.5">
					{view.left && button(view.left)}
					{/* Stays at the right edge when a narrow column wraps the row. */}
					{button(view.right, "ml-auto")}
				</div>
			</div>
		</div>
	);
}
