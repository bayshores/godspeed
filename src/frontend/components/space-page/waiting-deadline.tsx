import { useMemo, useState } from "react";
import type { SpaceRecord } from "@/shared/core";
import { Pane } from "@/frontend/components/ui/pane";
import { DeadlineDialog } from "./deadline-dialog";

/**
 * An interview still waiting for its date (a space set up before it had
 * one): its name, that it has no date yet, and "Add the date", which opens
 * Add a deadline already filled in. Nothing shows once it has its date.
 */
export function WaitingDeadline({ record }: { record: SpaceRecord | null }) {
	const [adding, setAdding] = useState(false);
	const waiting = record?.waitingDeadline;
	// The dialog compares its mode by identity: one object per open.
	const mode = useMemo(() => (adding && record && waiting ? { spaceId: record.id, deadline: null, waiting, files: record.files } : null), [adding, record, waiting]);
	return (
		<>
			{waiting && (
				<Pane data-testid="waiting-deadline" className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
					<span className="flex min-w-0 flex-1 basis-[220px] flex-col gap-1">
						<span title={waiting.name} className="truncate text-xl leading-tight text-ink">
							{waiting.name}
						</span>
						<span className="text-[17px] text-ink-2">The interview has no date yet.</span>
					</span>
					<button type="button" data-testid="waiting-deadline-add" onClick={() => setAdding(true)} className="lh-btn lh-btn-main h-[38px] shrink-0 px-[18px] text-[15px]">
						Add the date
					</button>
				</Pane>
			)}
			<DeadlineDialog mode={mode} onClose={() => setAdding(false)} />
		</>
	);
}
