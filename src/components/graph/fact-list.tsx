/**
 * A topic's facts in the topic panel: a square for the latest answer
 * (empty when never asked), the fact's name, and a chevron that opens its
 * statement. The first FACTS_SHOWN show until "Show all N". Right-click
 * (or the keyboard's context-menu key) opens a menu whose one action,
 * Delete, opens the shared DeleteNodeDialog; a delete announces
 * lh:graph-revision (the page refreshes on it, as for the chain table).
 */
import { memo, useCallback, useRef, useState, type MouseEvent } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { FactProgress } from "@/core";
import { MenuShell } from "@/components/menu-shell";
import { useMenuDismiss } from "@/components/use-menu-dismiss";
import { DeleteNodeDialog } from "@/components/delete-node-dialog";
import { InlineMath } from "@/components/overview/inline-math";
import { factMark, PANEL_ANSWER_COLOR } from "./derive.ts";
import { MENU_CLASS, MENU_ITEM_CLASS } from "./menu.tsx";

const FACTS_SHOWN = 4;

export function FactList({
	facts,
}: {
	/** Already in display order (derive.ts topicFacts). */
	facts: readonly FactProgress[];
}) {
	const [showAll, setShowAll] = useState(false);
	const [openId, setOpenId] = useState<string | null>(null);
	const [menu, setMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
	const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
	const anchorRef = useRef<HTMLDivElement>(null);
	const closeMenu = useCallback(() => setMenu(null), []);
	useMenuDismiss(menu !== null, closeMenu, anchorRef);

	const shown = showAll ? facts : facts.slice(0, FACTS_SHOWN);
	const onToggle = useCallback((id: string) => setOpenId((cur) => (cur === id ? null : id)), []);
	const onMenu = useCallback((fact: FactProgress, e: MouseEvent<HTMLElement>) => {
		e.preventDefault();
		let { clientX: x, clientY: y } = e;
		// The keyboard's context-menu key reports 0,0: open at the row.
		if (x === 0 && y === 0) {
			const r = e.currentTarget.getBoundingClientRect();
			x = r.left + 24;
			y = r.bottom;
		}
		setMenu({ id: fact.id, name: fact.name, x, y });
	}, []);

	return (
		<>
			<ul className="flex w-full flex-col" data-testid="fact-list">
				{shown.map((f) => (
					<FactRow key={f.id} fact={f} open={openId === f.id} onToggle={onToggle} onMenu={onMenu} />
				))}
			</ul>
			{!showAll && facts.length > FACTS_SHOWN && (
				<button
					type="button"
					data-testid="facts-show-all"
					onClick={() => setShowAll(true)}
					className="lh-press mt-2 text-[13px] font-bold text-ink-2 hover:text-ink"
				>
					Show all {facts.length}
				</button>
			)}
			{menu && <div ref={anchorRef} className="pointer-events-none fixed size-0" style={{ left: menu.x, top: menu.y }} />}
			<MenuShell open={menu !== null} anchorRef={anchorRef} testid="fact-context-menu" preferredSide="down" align="left" menuClass={MENU_CLASS}>
				<button
					type="button"
					data-testid="ctx-fact-delete"
					onClick={() => {
						if (!menu) return;
						setDeleting({ id: menu.id, name: menu.name });
						setMenu(null);
					}}
					className={MENU_ITEM_CLASS}
				>
					Delete
				</button>
			</MenuShell>
			<DeleteNodeDialog
				nodes={deleting ? [deleting] : null}
				onClose={() => setDeleting(null)}
				onDeleted={(_ids, graphRevision) => {
					setDeleting(null);
					window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { graphRevision } }));
				}}
			/>
		</>
	);
}

const FactRow = memo(function FactRow({
	fact,
	open,
	onToggle,
	onMenu,
}: {
	fact: FactProgress;
	open: boolean;
	onToggle: (id: string) => void;
	onMenu: (fact: FactProgress, e: MouseEvent<HTMLElement>) => void;
}) {
	const mark = factMark(fact);
	return (
		<li className="border-b border-tone">
			<button
				type="button"
				data-testid="fact-row"
				aria-expanded={open}
				onClick={() => onToggle(fact.id)}
				onContextMenu={(e) => onMenu(fact, e)}
				className="lh-press flex w-full items-center gap-2 py-[9px] text-left text-sm text-ink hover:text-ink-max"
			>
				<span
					aria-label={mark === null ? "Not asked yet" : mark === "right" ? "Last answer right" : mark === "wrong" ? "Last answer wrong" : "Last answer: I don't know"}
					className={`size-2 shrink-0 ${mark === null ? "outline outline-[1.5px] -outline-offset-[0.75px] outline-ink-3" : ""}`}
					style={mark ? { background: PANEL_ANSWER_COLOR[mark] } : undefined}
				/>
				<span className="min-w-0 flex-1 truncate">
					<InlineMath text={fact.name} />
				</span>
				<ChevronRightIcon
					aria-hidden
					className="size-3.5 shrink-0 text-ink-3 transition-transform duration-[var(--lh-dur)]"
					style={open ? { transform: "rotate(90deg)" } : undefined}
				/>
			</button>
			{open && (
				<p data-testid="fact-statement" className="lh-rise pb-2.5 pl-4 text-[13.5px] leading-5 text-ink-2">
					<InlineMath text={fact.statement} />
				</p>
			)}
		</li>
	);
});
