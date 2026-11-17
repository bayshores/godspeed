import { MathBox } from "@/frontend/components/math-box";
import { cn } from "@/frontend/lib/utils";
import { AttachButton, AttachmentTray, attachmentInputProps, type AttachmentDraft } from "./attachment-tray";
import type { BoxAction, BoxButton, BoxView } from "./lesson-box-model";

const BUTTON_ID: Record<BoxButton["action"], string> = {
	send: "composer-send",
	submit: "question-submit",
	reveal: "teach-check-reveal",
};

/**
 * The lesson's answer box, near the foot of "Your turn": an answer in words,
 * reasoning and a problem's work are typed here. Its size, its button and
 * what Enter does come from lessonBox; this only draws them. The box is as
 * tall as its text, up to five lines, then scrolls.
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
	onFocus: () => void;
	attachments: AttachmentDraft;
	boxRef: React.Ref<{ focus(): void }>;
}) {
	const b = view.button;
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
			<button type="button" data-testid={BUTTON_ID[b.action]} disabled={b.disabled} onClick={() => onAct(b.action)} className={cn("lh-btn shrink-0", b.filled && "lh-btn-main")}>
				{b.label}
			</button>
		</>
	);
	return (
		<div data-testid="composer" data-size={view.size} className="flex shrink-0 flex-col gap-2" {...attachmentInputProps(taken)}>
			<AttachmentTray draft={attachments} />
			{view.size === "line" ? (
				// The keys go under the box when the row is too narrow for both.
				<div className="flex flex-wrap items-end gap-x-3 gap-y-2.5">
					<div className="lh-answer-line flex min-w-0 flex-[1_1_240px] flex-col lh-well rounded-[2px]">{box}</div>
					<div className="ml-auto flex shrink-0 items-center gap-3">{keys}</div>
				</div>
			) : (
				<div className="lh-answer-lines flex flex-col lh-well rounded-[2px]">
					{box}
					<div className={cn("flex shrink-0 items-center gap-3 pr-2.5 pb-2.5 pl-2", view.attach ? "justify-between" : "justify-end")}>{keys}</div>
				</div>
			)}
		</div>
	);
}
