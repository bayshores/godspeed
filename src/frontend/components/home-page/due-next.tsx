/**
 * DUE NEXT (Home's first pane): the soonest open deadline from any class,
 * "cse29 / PS3", its study button (Continue studying while its last
 * session is unfinished) and mark done, with the pixel countdown on the
 * right. With nothing due it says how deadlines get added; with no class
 * yet it offers to add one.
 */
import Link from "next/link";
import { deadlineStudyLabel, type DeadlineProgress } from "@/shared/core";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { deadlineHref } from "@/frontend/components/overview/runway-model";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { PixelCountdown } from "./pixel-countdown";

export function DueNext({
	deadline: d,
	progress,
	leaving,
	hasClasses,
	busy,
	error,
	fixedNow,
	onStudy,
	onDone,
	onNewClass,
}: {
	deadline: OpenDeadline | null;
	progress: DeadlineProgress | null;
	leaving: boolean;
	hasClasses: boolean;
	/** A study start is on its way. */
	busy: boolean;
	/** Why the last study start failed. */
	error: string | null;
	/** A fixed moment for the countdown (tests). */
	fixedNow?: number;
	onStudy: (d: OpenDeadline) => void;
	onDone: (d: OpenDeadline) => void;
	onNewClass: () => void;
}) {
	return (
		<Pane name="due next" active data-testid="due-next" className="px-7 pt-7 pb-6">
			{!d ? (
				<div className="flex flex-col items-start gap-3">
					<p data-testid="due-next-empty" className="text-base text-ink-2">
						{hasClasses ? "No deadlines yet. Your agent can add them from the syllabus." : "No classes yet. Add one, then add its deadlines in Edit class."}
					</p>
					{!hasClasses && (
						<button type="button" data-testid="due-next-new-class" onClick={onNewClass} className="lh-btn lh-btn-main">
							+ new class
						</button>
					)}
				</div>
			) : (
				<div
					data-halley-target={`deadline:${d.id}`}
					data-leaving={leaving || undefined}
					className={cn("flex flex-wrap items-center justify-between gap-x-8 gap-y-4 transition-opacity duration-[var(--lh-dur)]", leaving && "pointer-events-none opacity-0")}
				>
					<div className="flex min-w-0 flex-col gap-3">
						<h3 className="flex min-w-0 items-baseline gap-3 text-2xl font-bold">
							<span className="shrink-0 text-ink-3">{d.className.toLowerCase()} /</span>
							<Link href={deadlineHref(d.id)} prefetch={false} data-testid="due-next-open" title={d.name} className="truncate text-ink hover:underline">
								{d.name}
							</Link>
						</h3>
						<div className="flex flex-wrap gap-2.5">
							<button type="button" data-testid="due-next-study" disabled={busy} onClick={() => onStudy(d)} className="lh-btn lh-btn-main max-w-full">
								<span aria-hidden>▶</span>
								<span className="truncate">{deadlineStudyLabel(progress?.continueStudy, d.name).toLowerCase()}</span>
							</button>
							<button type="button" data-testid="due-next-done" disabled={leaving} onClick={() => onDone(d)} className="lh-btn">
								<span aria-hidden>✓</span>
								mark done
							</button>
						</div>
						{error && (
							<p role="alert" className="text-sm text-ans-wrong">
								{error}
							</p>
						)}
					</div>
					<PixelCountdown due={d} now={fixedNow} />
				</div>
			)}
		</Pane>
	);
}
