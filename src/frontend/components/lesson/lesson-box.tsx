import { useState } from "react";
import { MathBox } from "@/frontend/components/math-box";
import { usePresence } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import { AttachButton, AttachmentTray, attachmentInputProps, type AttachmentDraft } from "./attachment-tray";
import type { BoxAction, BoxButton, BoxView } from "./lesson-box-model";

const BUTTON_ID: Record<BoxButton["action"], string> = {
	send: "composer-send",
	submit: "question-submit",
	skip: "words-skip",
	save: "words-save",
	leave: "words-leave",
};

/**
 * The lesson's writing row: an answer in words, reasoning, a problem's work
 * and a question for the teacher are typed here. Its size, its keys and what
 * Enter does come from lessonBox; this only draws them: the field, as tall
 * as its text up to five lines, then its keys, then `end` (the key that goes
 * on). Keys that do not fit beside the field drop under it.
 */
export function LessonBox({
	view,
	value,
	onChange,
	onAct,
	onFocus,
	attachments,
	boxRef,
	end,
}: {
	view: BoxView;
	value: string;
	onChange: (v: string) => void;
	onAct: (action: BoxAction) => void;
	onFocus?: () => void;
	attachments: AttachmentDraft;
	boxRef: React.Ref<{ focus(): void }>;
	end?: React.ReactNode;
}) {
	// A box whose answer carries no files takes none by paste or drop either.
	const taken: AttachmentDraft = view.attach ? attachments : { ...attachments, add: () => {} };
	// The attach key fades out while the teacher works and back in after; at first drawing it is simply there.
	const attach = usePresence(view.attach);
	const [attachFirst] = useState(view.attach);
	const [attachMoved, setAttachMoved] = useState(false);
	if (!attachMoved && view.attach !== attachFirst) setAttachMoved(true);
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
	return (
		<div data-testid="composer" data-size={view.size} className="flex shrink-0 flex-col gap-2" {...attachmentInputProps(taken)}>
			<AttachmentTray draft={attachments} />
			<div className="flex flex-wrap items-end justify-end gap-x-3 gap-y-2">
				<div className={cn(view.size === "line" ? "lh-answer-line" : "lh-answer-lines", "flex min-w-[min(100%,15rem)] flex-1 items-end lh-well")}>
					{attach.mounted && (
						<span data-state={attach.state} className={cn("flex shrink-0 py-1 pl-1", attachMoved && "lh-fade")}>
							<AttachButton draft={attachments} glyph />
						</span>
					)}
					{box}
				</div>
				<div data-testid="composer-keys" className="flex min-h-10 shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2">
					{view.keys.map((b) => (
						<button key={b.action} type="button" data-testid={BUTTON_ID[b.action]} disabled={b.disabled} onClick={() => onAct(b.action)} className={cn("lh-btn shrink-0", b.filled ? "lh-btn-main" : "lh-btn-quiet")}>
							{b.label}
						</button>
					))}
					{end}
				</div>
			</div>
		</div>
	);
}
