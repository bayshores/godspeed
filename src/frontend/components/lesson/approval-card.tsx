import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WorkApproval } from "@/shared/core";
import { DUR_MS, useLeavingList } from "@/frontend/components/presence";
import { useFold } from "@/frontend/components/use-fold";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { cn } from "@/frontend/lib/utils";
import type { Arrive } from "./arrivals";

/** What the lesson page does when a card comes while the desk is up: glides it into view once. */
export const AskShownContext = createContext<((card: HTMLElement) => void) | null>(null);

/** Sends the learner's answer to one card: the error line, or null. */
type AnswerApproval = (id: string, allow: boolean) => Promise<string | null>;

/**
 * What the teacher waits for the learner to allow, under the desk's steps or a cheat sheet's
 * request: a card each, oldest first, with the server's sentence, what it is about on a slip of the desk's paper (a command in
 * the agent's own type), and Deny and Allow. A card opens its room under the rows as it fades in, and when it is
 * answered, or denied by Stop or the turn's end, it folds shut as it fades out. One there when the
 * desk first shows is simply there.
 */
export function ApprovalCards({ approvals, slot, arrive, answer, className }: { approvals: readonly WorkApproval[]; slot: string; arrive: Arrive; answer: AnswerApproval; className?: string }) {
	const items = useMemo(() => approvals.map((approval) => ({ key: approval.id, approval })), [approvals]);
	const shown = useLeavingList(items, DUR_MS);
	if (shown.length === 0) return null;
	return (
		<div data-testid="desk-approvals" className={cn("flex flex-col", className)}>
			{shown.map(({ item, leaving }) => (
				<ApprovalCard key={item.key} approval={item.approval} leaving={leaving} live={!!arrive(`${slot}:ask:${item.key}`)} answer={answer} />
			))}
		</div>
	);
}

function ApprovalCard({ approval, leaving, live, answer: send }: { approval: WorkApproval; leaving: boolean; live: boolean; answer: AnswerApproval }) {
	// Decided when the card first shows: one that came while the desk was up opens its room.
	const [arrived] = useState(live);
	const [ready, setReady] = useState(!arrived);
	useEffect(() => setReady(true), []);
	const fold = useFold(ready && !leaving);
	const shown = useContext(AskShownContext);
	const box = useRef<HTMLDivElement>(null);
	const told = useRef(false);
	useLayoutEffect(() => {
		if (!arrived || told.current || !box.current) return;
		told.current = true;
		shown?.(box.current);
	});
	const answer = useGuardedAction();
	const { subject } = approval;
	const reply = (allow: boolean) => void answer.run(() => send(approval.id, allow));
	if (!fold.mounted) return null;
	return (
		<div className="lh-collapse" data-state={fold.state}>
			<div>
				<div
					ref={box}
					data-testid="approval-card"
					data-state={leaving ? "closed" : "open"}
					inert={leaving}
					className={cn("lh-sheet mt-3 flex flex-col gap-3 px-3 py-2.5", (arrived || leaving) && "lh-fade")}
				>
					<p className="text-ui leading-5 text-ink">{approval.text}</p>
					{subject && (
						<p data-testid="approval-subject" data-kind={subject.kind} className={cn("lh-paper lh-sheet line-clamp-4 px-3 py-2 text-ui leading-5 break-words whitespace-pre-wrap", subject.kind === "command" && "font-mono")}>
							{subject.text}
						</p>
					)}
					<div className="flex flex-wrap items-center justify-end gap-3">
						{answer.error && (
							<p role="alert" className="min-w-0 flex-1 text-ui leading-5 text-ans-wrong">
								{answer.error}
							</p>
						)}
						<button type="button" data-testid="approval-deny" disabled={answer.busy} onClick={() => reply(false)} className="lh-btn lh-btn-small lh-btn-quiet">
							Deny
						</button>
						<button type="button" data-testid="approval-allow" disabled={answer.busy} onClick={() => reply(true)} className="lh-btn lh-btn-main lh-btn-small">
							Allow
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
