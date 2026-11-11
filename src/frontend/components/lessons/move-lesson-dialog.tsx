import { Fragment, useState } from "react";
import { createPortal } from "react-dom";
import { useClasses } from "@/frontend/components/class-context";
import { CheckRow } from "@/frontend/components/ui/check-row";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";

type Lesson = { id: string; title: string; classId?: string };

/** "Move lesson to another class": the lesson's facts leave the old class's
 *  graph and are rebuilt in the new one. */
export function MoveLessonDialog({ lesson, onClose, onMoved }: { lesson: Lesson | null; onClose: () => void; onMoved: (id: string, classId: string | null) => void }) {
	const { mounted, state, shown } = useLastWhileClosing(lesson);
	if (!mounted || !shown) return null;
	return createPortal(<MoveLessonInner lesson={shown} onClose={onClose} onMoved={onMoved} state={state} />, document.body);
}

function MoveLessonInner({ lesson, onClose, onMoved, state }: { lesson: Lesson; onClose: () => void; onMoved: (id: string, classId: string | null) => void; state: "open" | "closed" }) {
	const { classes } = useClasses();
	const from = lesson.classId ?? null;
	const [target, setTarget] = useState<string | null>(from);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const close = () => {
		if (!busy) onClose();
	};
	const move = async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/chats/${lesson.id}/class`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ classId: target ?? "none" }),
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				setError(body.error ?? `Move failed (${res.status})`);
				return;
			}
			onMoved(lesson.id, target);
		} catch {
			setError("Network error. Try again.");
		} finally {
			setBusy(false);
		}
	};
	const options: { id: string | null; name: string }[] = [
		...classes.filter((c) => !c.archived || c.id === from).map((c) => ({ id: c.id as string | null, name: c.name })),
		{ id: null, name: "No class" },
	];
	return (
		<DialogSheet
			title="Move lesson to another class"
			state={state}
			testid="move-lesson-dialog"
			busy={busy}
			onClose={close}
			foot={
				<>
					<span className="flex-1" />
					<button type="button" disabled={busy} onClick={onClose} className="lh-btn text-[15px]">
						Cancel
					</button>
					<button type="button" data-testid="move-lesson-confirm" disabled={busy || target === from} onClick={() => void move()} className="lh-btn lh-btn-main text-[15px]">
						Move
					</button>
				</>
			}
		>
			<p title={lesson.title} className="truncate text-lg text-ink">
				{lesson.title}
			</p>
			<div role="radiogroup" aria-label="Class" className="flex flex-col border-y-[1.5px] border-ink">
				{options.map((o, i) => (
					<Fragment key={o.id ?? "none"}>
						{i > 0 && <span aria-hidden className="border-t-2 border-dotted border-ink-3" />}
						<CheckRow radio="move-target" label={o.name} note={o.id === from ? "current" : undefined} checked={target === o.id} disabled={busy} onToggle={() => setTarget(o.id)} />
					</Fragment>
				))}
			</div>
			<p className="text-[15px] text-ink-2">
				Its facts leave the current class&apos;s graph (facts another lesson or file also taught stay) and are rebuilt in the new class&apos;s graph. Rebuilding is done by your agent.
			</p>
			{error && (
				<p role="alert" className="text-[15px] text-ans-wrong">
					{error}
				</p>
			)}
		</DialogSheet>
	);
}
