/**
 * A panel's list of what it opens (the topics a topic needs and leads
 * to, the facts a fact builds on and leads to): one row each, its square
 * in its color and its name, like the topic's own facts. Rows, not keys,
 * so a long list reads as a list.
 */
import type { ReactNode } from "react";
import { GROUP_LABEL, PANE_ROW } from "./styles.ts";

interface LinkRow {
	id: string;
	/** Full name, for the row's tooltip. */
	name: string;
	/** What the row shows; the name when left out. */
	shown?: ReactNode;
	color: string;
}

export function LinkRows({
	label,
	rows,
	empty,
	onOpen,
	testid,
	rowTestid,
}: {
	label: string;
	rows: readonly LinkRow[];
	/** Shown when there are no rows; with none, the group is left out. */
	empty?: string;
	onOpen: (id: string) => void;
	testid: string;
	rowTestid: string;
}) {
	if (rows.length === 0 && !empty) return null;
	return (
		<div className="flex flex-col gap-1" data-testid={testid}>
			<span className={GROUP_LABEL}>{label}</span>
			{rows.length === 0 ? (
				<span className="text-base text-ink-2">{empty}</span>
			) : (
				<ul className="flex w-full flex-col">
					{rows.map((row) => (
						<li key={row.id}>
							<button type="button" data-testid={rowTestid} onClick={() => onOpen(row.id)} title={row.name} className={PANE_ROW}>
								<span aria-hidden className="size-[9px] shrink-0" style={{ background: row.color }} />
								<span className="min-w-0">{row.shown ?? row.name}</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
