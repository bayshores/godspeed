import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toggleOption, type DockSelection, type ProblemChoices, type ProblemPieceText } from "@/shared/core";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { PagePiece } from "@/frontend/components/citations/page-piece";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { ChoiceRows, SelectAllHint } from "./choice-rows";
import { useChoiceKeys } from "./use-choice-keys";
import { partMarks, toggled, type PartMarks } from "./problem-parts";
import { proseVars } from "./question-parts";

/** Room kept above the part, so the fade at the top of the box does not cover its first line. */
const LEAD = 32;

/** Brings the start of the part the learner is on to the top of the box "Your turn" scrolls in:
 *  glided to when he moves on to it (`moved`), there at once when the problem is first drawn on it.
 *  Under the lesson text there is no such box, and the page itself rests on the part. */
function restAt(start: HTMLElement, moved: boolean) {
	const box = start.closest<HTMLElement>(".lh-turn-scroll");
	if (!box || box.scrollHeight <= box.clientHeight) return;
	box.scrollTo({ top: box.scrollTop + start.getBoundingClientRect().top - box.getBoundingClientRect().top - LEAD, behavior: moved && !prefersReducedMotion() ? "smooth" : "auto" });
}

const MARKED = "[data-part-current], [data-part-head], [data-part-fold]";
const NAMES = ["data-part-current", "data-part-head", "data-part-fold", "role", "tabindex", "aria-expanded"];

/** Puts `marks` on the statement's blocks and takes the old ones off, touching
 *  only what changes, so a focused part keeps its focus. */
function apply(root: HTMLElement, marks: PartMarks) {
	for (const el of root.querySelectorAll<HTMLElement>(MARKED)) {
		const keep = marks.get(el) ?? {};
		for (const name of NAMES) if (!(name in keep)) el.removeAttribute(name);
	}
	for (const [el, attrs] of marks) {
		for (const [name, value] of Object.entries(attrs)) if (el.getAttribute(name) !== value) el.setAttribute(name, value);
	}
}

/** What the learner picks among, for a problem that has choices. */
export interface ProblemPicks {
	choices: ProblemChoices;
	picked: DockSelection;
	onPick: (picked: DockSelection) => void;
	/** Tab from the rows goes to the writing box. */
	onLeaveRows: () => void;
	/** Enter on a walked row sends, or null while nothing can be sent. */
	onEnter: (() => void) | null;
}

/** The problem's choices as the quiz shows its own: lettered tick rows with their keys. */
function ProblemChoiceRows({ choices, picked, onPick, onLeaveRows, onEnter }: ProblemPicks) {
	const multi = choices.multiSelect;
	const toggle = (index: number) => onPick(toggleOption(multi ? "multi-select" : "single-select", picked, index));
	const { rootRef, walked } = useChoiceKeys({ count: choices.labels.length, toggle, onLeaveRows, onEnter });
	return (
		<div ref={rootRef} data-testid="problem-choices" className="flex flex-col gap-7">
			{multi && <SelectAllHint />}
			<ChoiceRows options={choices.labels.map((label) => ({ label }))} selected={picked.selected} multi={multi} walked={walked} onToggle={toggle} />
		</div>
	);
}

/**
 * The open problem under "Your turn": the whole problem, the part the teacher
 * marked open (data-part-current, where the page may rest) and every other
 * part folded to its first line, which opens it on a click and folds it on
 * the next. A problem printed in a file shows that piece of the page in its
 * place, in the theme's ink or as printed. A problem with choices shows them
 * under its statement. The learner works on it in the writing box under it.
 */
export function OpenProblemPane({
	statement,
	piece,
	printed = false,
	onPieceFail,
	part,
	picks,
}: {
	statement: string;
	/** Where the problem is printed in its file, and its words there. */
	piece?: ProblemPieceText | null;
	/** The piece on its white page, not in the theme's ink. */
	printed?: boolean;
	/** Told once the piece's words stand in for a picture that did not load. */
	onPieceFail?: () => void;
	/** The part the learner is on, as the problem labels it (homework only). */
	part: string | null;
	picks: ProblemPicks | null;
}) {
	const statementRef = useRef<HTMLDivElement>(null);
	// The other parts the learner opened; a newly marked part folds them again.
	const [opened, setOpened] = useState<readonly string[]>([]);
	const [openedFor, setOpenedFor] = useState(part);
	if (openedFor !== part) {
		setOpenedFor(part);
		setOpened([]);
	}

	// Clicks and keys on the other parts' first lines; the marks go with the part.
	useEffect(() => {
		const root = statementRef.current;
		if (!part || !root) return;
		const toggle = (e: Event) => {
			const target = e.target as Element;
			const head = target.closest("[data-part-head]");
			if (!head || target.closest("a")) return;
			e.preventDefault();
			setOpened((now) => toggled(now, head.getAttribute("data-part-head")!));
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") toggle(e);
		};
		root.addEventListener("click", toggle);
		root.addEventListener("keydown", onKey);
		return () => {
			root.removeEventListener("click", toggle);
			root.removeEventListener("keydown", onKey);
			apply(root, new Map());
		};
	}, [part]);
	// Before the problem is drawn, so no frame shows every part open.
	useLayoutEffect(() => {
		const root = statementRef.current;
		if (!part || !root) return;
		const mark = () => apply(root, partMarks(root, part, opened));
		mark();
		// Code and math finish drawing after this.
		const ro = new ResizeObserver(mark);
		ro.observe(root);
		return () => ro.disconnect();
	}, [part, opened]);

	return (
		<div data-testid="open-problem" className="flex flex-col gap-7">
			{/* Holds a last-line fraction's denominator, which hangs 6px below its line box. */}
			{piece ? (
				<div data-testid="problem-piece" style={proseVars(18, 28)}>
					<PagePiece piece={piece.piece} text={piece.text} part={part} printed={printed} onPlace={restAt} onFail={onPieceFail} />
				</div>
			) : (
				<div ref={statementRef} data-testid="problem-statement" className="pb-1.5" style={proseVars(18, 28)}>
					<ToolContentResponse>{statement}</ToolContentResponse>
				</div>
			)}
			{picks && <ProblemChoiceRows {...picks} />}
		</div>
	);
}
