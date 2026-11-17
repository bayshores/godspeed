import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { FactProgress, ProgressPayload } from "@/shared/core";
import { Constellation } from "./constellation.tsx";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { FactPane, type FactSources } from "./fact-pane.tsx";
import { GraphEmpty } from "./graph-empty.tsx";
import { TopicPane } from "./topic-pane.tsx";
import { REVEAL_MS, type Reveal } from "./constellation-reveal.ts";
import { FOOT } from "./graph-foot.tsx";

/** The docked panel's width, and the gap between it and the picture. */
const PANEL = 340;
const GAP = 16;
/** With less room than this, the panel takes the picture's place. */
const NARROW = 1000;
/** The room before it is measured: the page's widest column, less its sides. */
const WIDEST = 1192;
const TALLEST = 600;
/** The least height the picture gets, however short the window. */
const MIN_HEIGHT = 120;
const PICTURE = "[data-testid=graph-picture]";
const PANEL_BOX = "[data-testid=graph-panel]";
const PANEL_CLOSE = "[data-testid=topic-pane-close], [data-testid=fact-pane-close]";
const topicButton = (id: string) => `[data-testid=graph-topic][data-topic-id=${JSON.stringify(id)}]`;

/** The picture over one progress payload (loaded lazily by graph-screen.tsx).
 *  A picked topic or fact docks its panel at the right and the picture
 *  re-fits beside it; with too little room the panel shows alone. */
export function GraphBody({
	data,
	matches,
	sources,
	studying,
	studyError,
	onStudy,
	onStudyFact,
	initialSelected = null,
}: {
	data: ProgressPayload;
	/** Find's lit topics and facts; null with nothing typed. */
	matches: { topics: ReadonlySet<string>; facts: ReadonlySet<string> } | null;
	/** Where facts came from and how they link; null while it loads. */
	sources: FactSources | null;
	studying: boolean;
	studyError: string | null;
	onStudy: (topicIds: string[]) => void;
	onStudyFact: (fact: FactProgress) => void;
	initialSelected?: string | null;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(initialSelected);
	const [factId, setFactId] = useState<string | null>(null);
	const room = useRoom();
	// The picture inks in once per opening of the tab; a re-fit, Find, pick or refresh never replays it.
	const [reveal, setReveal] = useState<Reveal | null>(() => (prefersReducedMotion() ? null : { start: performance.now(), at: null }));
	useEffect(() => {
		const timer = window.setTimeout(() => setReveal(null), REVEAL_MS);
		return () => window.clearTimeout(timer);
	}, []);
	// A graph change keeps the pick; a topic or fact that is gone closes its panel.
	const selected = selectedId ? data.topics.find((t) => t.id === selectedId) : undefined;
	const fact = factId ? data.facts.find((f) => f.id === factId) : undefined;
	const factTopic = fact ? data.topics.find((t) => t.id === fact.topicId) : undefined;

	const narrow = room.width < NARROW;

	// Keyboard focus follows the panel: a pick that hides the picture, or a
	// change inside the panel, lands on the panel's Close; closing from inside
	// the panel lands back on the topic's button. Applied after the render.
	const focusNext = useRef<string | null>(null);
	useLayoutEffect(() => {
		const target = focusNext.current;
		focusNext.current = null;
		if (target) room.ref.current?.querySelector<HTMLElement>(target)?.focus();
	});
	const focusIn = (box: string) => !!room.ref.current?.querySelector(box)?.contains(document.activeElement);
	const opening = () => {
		if (focusIn(PANEL_BOX) || (narrow && focusIn(PICTURE))) focusNext.current = PANEL_CLOSE;
	};
	const closing = () => {
		if (selectedId && focusIn(PANEL_BOX)) focusNext.current = topicButton(selectedId);
	};

	// A click on the picked topic, or on empty picture (null), closes it.
	const pick = (id: string | null) => {
		if (id === null || id === selectedId) closing();
		else opening();
		setFactId(null);
		setSelectedId(id === selectedId ? null : id);
	};
	// A fact opens with its topic picked, so the picture shows where it sits.
	const openFact = (id: string) => {
		opening();
		const topicId = data.facts.find((f) => f.id === id)?.topicId;
		if (topicId) setSelectedId(topicId);
		setFactId(id);
	};
	const backToTopic = () => {
		opening();
		setFactId(null);
	};
	const close = () => pick(null);

	// Escape closes the fact, then the topic (menus, dialogs and Find's typing line claim theirs first).
	const onEscape = useRef(() => {});
	onEscape.current = () => (fact ? backToTopic() : close());
	useEffect(() => {
		if (!selected && !fact) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) onEscape.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selected, fact]);

	// The picture re-fits beside a panel that opens or closes with one short fade, kept in place so focus stays on its topic.
	const pictureRef = useRef<HTMLDivElement>(null);
	const beside = !!(selected || fact) && !narrow;
	const shown = useRef(beside);
	useLayoutEffect(() => {
		if (shown.current === beside) return;
		shown.current = beside;
		if (!prefersReducedMotion()) pictureRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" });
	}, [beside]);

	if (data.topics.length === 0) return <GraphEmpty inSpace={data.spaceId !== null} />;

	// The picked topic never dims under Find.
	const focus = matches && selected ? new Set([...matches.topics, selected.id]) : (matches?.topics ?? null);
	const panel =
		fact && factTopic ? (
			<FactPane
				key={fact.id}
				fact={fact}
				topicName={factTopic.name}
				facts={data.facts}
				sources={sources}
				onBack={backToTopic}
				onClose={close}
				onOpenFact={openFact}
				onStudy={onStudyFact}
				studying={studying}
				studyError={studyError}
			/>
		) : selected ? (
			<TopicPane
				key={selected.id}
				topic={selected}
				topics={data.topics}
				links={data.topicLinks}
				facts={data.facts}
				onClose={close}
				onSelectTopic={pick}
				onOpenFact={openFact}
				onStudy={onStudy}
				studying={studying}
				studyError={studyError}
			/>
		) : null;
	const width = panel ? room.width - PANEL - GAP : room.width;
	return (
		<div ref={room.ref} className="w-full">
			{panel && narrow ? (
				<Dock className="mx-auto w-full max-w-[560px]" height={room.height}>
					{panel}
				</Dock>
			) : (
				<div className="flex items-start" style={{ gap: GAP }}>
					<div ref={pictureRef} className="min-w-0 shrink-0" style={{ width }}>
						<Constellation
							topics={data.topics}
							links={data.topicLinks}
							facts={data.facts}
							chains={sources?.chains ?? null}
							width={width}
							height={room.height}
							reveal={reveal}
							pickedId={selected?.id ?? null}
							pickedFactId={fact?.id ?? null}
							focus={focus}
							factMatches={matches?.facts ?? null}
							onPick={pick}
							onPickFact={openFact}
						/>
					</div>
					{panel && (
						<Dock className="shrink-0" width={PANEL} height={room.height}>
							{panel}
						</Dock>
					)}
				</div>
			)}
		</div>
	);
}

/** The room the page gives the picture and panel, kept current: its width,
 *  and the height from its top to 16 px above the foot line. The page never scrolls. */
function useRoom() {
	const ref = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: WIDEST, height: TALLEST });
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const page = el.closest("[data-testid=graph-page]") ?? document.documentElement;
			const height = Math.max(MIN_HEIGHT, Math.floor(page.getBoundingClientRect().bottom - el.getBoundingClientRect().top - 16 - FOOT));
			if (el.clientWidth > 0) setSize((o) => (o.width === el.clientWidth && o.height === height ? o : { width: el.clientWidth, height }));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		if (el.parentElement) ro.observe(el.parentElement);
		window.addEventListener("resize", measure);
		return () => {
			ro.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	return { ref, ...size };
}

/** The docked panel: as tall as the picture's room at most, so its Study key stays in view and its middle scrolls. */
function Dock({ className, width, height, children }: { className: string; width?: number; height: number; children: ReactNode }) {
	return (
		<aside data-testid="graph-panel" className={`lh-fade flex flex-col ${className}`} style={{ width, maxHeight: height }}>
			{children}
		</aside>
	);
}
