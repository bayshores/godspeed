import { useMemo, useState } from "react";
import type { SpaceRecord } from "@/shared/core";
import { seedFromWaiting } from "@/frontend/components/space-deadlines-model";
import { DeadlineDialog } from "./deadline-dialog";
import { OutlineRow } from "./outline-row";

/**
 * An interview still waiting for its date (a space set up before it had
 * one), drawn in outline: its name, that it has no date yet, and "Add the
 * date", which opens Add a deadline already filled in. Nothing shows once
 * it has its date.
 */
export function WaitingDeadline({ record }: { record: SpaceRecord | null }) {
	const [adding, setAdding] = useState(false);
	const waiting = record?.waitingDeadline;
	// The dialog compares its mode by identity: one object per open.
	const mode = useMemo(() => (adding && record && waiting ? { spaceId: record.id, deadline: null, seed: seedFromWaiting(waiting), files: record.files } : null), [adding, record, waiting]);
	return (
		<>
			{record && waiting && (
				<OutlineRow
					testid="waiting-deadline"
					color={record.color}
					name={waiting.name}
					line="The interview has no date yet."
					keys={
						<button type="button" data-testid="waiting-deadline-add" onClick={() => setAdding(true)} className="lh-btn lh-btn-main">
							Add the date
						</button>
					}
				/>
			)}
			<DeadlineDialog mode={mode} onClose={() => setAdding(false)} />
		</>
	);
}
