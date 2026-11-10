/**
 * A topic's facts in the topic pane: a mark for the latest answer (a
 * check, a cross or a dash; an empty square when never asked) and the
 * fact's name; a click opens the fact. The first FACTS_SHOWN show until
 * "Show all N". Right-click
 * (or the keyboard's context-menu key) opens a menu whose one action,
 * Delete, opens the shared DeleteNodeDialog; a delete announces
 * lh:graph-revision (the page refreshes on it, as for the chain table).
 */
import { memo, useCallback, useRef, useState, type MouseEvent } from "react";
import { factMark, type AnswerOutcome, type FactProgress } from "@/shared/core";
import { MenuShell } from "@/frontend/components/menu-shell";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { DeleteNodeDialog } from "@/frontend/components/delete-node-dialog";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { MENU_CLASS, MENU_ITEM_CLASS } from "./menu.tsx";

const FACTS_SHOWN = 4;

export function FactList({
	facts,
	onOpen,
}: {
	/** Already in display order (core topicFacts). */
	facts: readonly FactProgress[];
	onOpen: (id: string) => void;
}) {
	const [showAll, setShowAll] = useState(false);
	const [menu, setMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
	const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
	const anchorRef = useRef<HTMLDivElement>(null);
	const closeMenu = useCallback(() => setMenu(null), []);
	useMenuDismiss(menu !== null, closeMenu, anchorRef);

	// One hidden fact isn't worth a button: show it.
	const folded = !showAll && facts.length > FACTS_SHOWN + 1;
	const shown = folded ? facts.slice(0, FACTS_SHOWN) : facts;
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
					<FactRow key={f.id} fact={f} onOpen={onOpen} onMenu={onMenu} />
				))}
			</ul>
			{folded && (
				<button
					type="button"
					data-testid="facts-show-all"
					onClick={() => setShowAll(true)}
					className="lh-btn self-start"
				>
					show all {facts.length}
				</button>
			)}
			{menu && <div ref={anchorRef} className="pointer-events-none fixed size-0" style={{ left: menu.x, top: menu.y }} />}
			<MenuShell open={menu !== null} anchorRef={anchorRef} testid="fact-context-menu" preferredSide="down" align="left" menuClass={MENU_CLASS}>
				<button
					role="menuitem"
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
	onOpen,
	onMenu,
}: {
	fact: FactProgress;
	onOpen: (id: string) => void;
	onMenu: (fact: FactProgress, e: MouseEvent<HTMLElement>) => void;
}) {
	return (
		<li className="border-b border-tone">
			<button
				type="button"
				data-testid="fact-row"
				onClick={() => onOpen(fact.id)}
				onContextMenu={(e) => onMenu(fact, e)}
				className="lh-press flex w-full items-center gap-2.5 py-2 text-left text-sm text-ink hover:text-ink-max"
			>
				<FactMark mark={factMark(fact)} />
				<span className="min-w-0 flex-1 truncate">
					<InlineMath text={fact.name} />
				</span>
				<span aria-hidden className="shrink-0 text-ink-3">
					›
				</span>
			</button>
		</li>
	);
});

/** The latest answer as a shape, not only a color: check, cross, dash;
 *  an empty square when never asked. */
const MARKS: Record<AnswerOutcome | "none", { glyph: string; className: string; label: string }> = {
	right: { glyph: "✓", className: "text-ans-right", label: "Last answer right" },
	wrong: { glyph: "✗", className: "text-ans-wrong", label: "Last answer wrong" },
	dontKnow: { glyph: "–", className: "text-ink-3", label: "Last answer: I don't know" },
	none: { glyph: "□", className: "text-ink-3", label: "Not tested" },
};

export function FactMark({ mark }: { mark: AnswerOutcome | null }) {
	const { glyph, className, label } = MARKS[mark ?? "none"];
	return (
		<span role="img" aria-label={label} className={`w-3 shrink-0 text-center text-[13px] font-bold ${className}`}>
			{glyph}
		</span>
	);
}
