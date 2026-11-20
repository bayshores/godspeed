import { MathBox } from "@/frontend/components/math-box";
import { cn } from "@/frontend/lib/utils";
import { AttachButton, AttachmentTray, attachmentInputProps, type AttachmentDraft } from "./attachment-tray";
import type { BoxAction, BoxButton, BoxView } from "./lesson-box-model";

const BUTTON_ID: Record<BoxButton["action"], string> = {
	send: "composer-send",
	submit: "question-submit",
};

/**
 * The lesson's box, at the foot of "Your turn": an answer in words,
 * reasoning, a problem's work and a question for the teacher are typed
 * here. Its size, its keys and what Enter does come from lessonBox; this
 * only draws them. The box is as tall as its text, up to five lines, then
 * scrolls.
 */
export function LessonBox({
	view,
	value,
	onChange,
	onAct,
	onFocus,
	attachments,
	boxRef,
}: {
	view: BoxView;
	value: string;
	onChange: (v: string) => void;
	onAct: (action: BoxAction) => void;
	onFocus?: () => void;
	attachments: AttachmentDraft;
	boxRef: React.Ref<{ focus(): void }>;
}) {
	// A box whose answer carries no files takes none by paste or drop either.
	const taken: AttachmentDraft = view.attach ? attachments : { ...attachments, add: () => {} };
	const box = (
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
	);
	const keys = (
		<>
			{view.attach && <AttachButton draft={attachments} />}
			{/* Attach keeps the row's start; the keys that send keep its end, on a row of their own in a narrow column. */}
			<div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
				{view.keys.map((b) => (
					<button key={b.action} type="button" data-testid={BUTTON_ID[b.action]} disabled={b.disabled} onClick={() => onAct(b.action)} className={cn("lh-btn shrink-0", b.filled && "lh-btn-main")}>
						{b.label}
					</button>
				))}
			</div>
		</>
	);
	return (
		<div data-testid="composer" data-size={view.size} className="flex shrink-0 flex-col gap-2" {...attachmentInputProps(taken)}>
			<AttachmentTray draft={attachments} />
			{/* One shape whatever waits above it: the keys sit inside the box, under the text. */}
			<div className={cn(view.size === "line" ? "lh-answer-line" : "lh-answer-lines", "flex flex-col lh-well rounded-[2px]")}>
				{box}
				<div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 pr-2.5 pb-2.5 pl-2">{keys}</div>
			</div>
		</div>
	);
}
