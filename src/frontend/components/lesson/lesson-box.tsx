import { MathBox } from "@/frontend/components/math-box";
import { cn } from "@/frontend/lib/utils";
import { AttachmentTray, attachmentInputProps, type AttachmentDraft } from "./attachment-tray";
import type { BoxAction, BoxButton, BoxView } from "./lesson-box-model";

const BUTTON_ID: Record<BoxButton["action"], string> = {
	send: "composer-send",
	submit: "question-submit",
	reveal: "teach-check-reveal",
};

/**
 * The lesson's answer box, at the foot of "Your turn": an answer in words,
 * reasoning and a problem's work are typed here. Its button and what Enter
 * does come from lessonBox; this only draws them.
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
	return (
		<div data-testid="composer" className="flex min-h-[112px] flex-1 flex-col gap-2" {...attachmentInputProps(attachments)}>
			<AttachmentTray draft={attachments} />
			<div className="flex min-h-0 flex-1 flex-col lh-well rounded-[2px]">
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
				<div className="flex shrink-0 justify-end pr-2.5 pb-2.5 pl-3.5">
					<button type="button" data-testid={BUTTON_ID[b.action]} disabled={b.disabled} onClick={() => onAct(b.action)} className={cn("lh-btn shrink-0", b.filled && "lh-btn-main")}>
						{b.label}
					</button>
				</div>
			</div>
		</div>
	);
}
