import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { FactProgress, ProgressPayload } from "@/shared/core";
import { Constellation } from "./constellation.tsx";
import type { Aim, CameraMemory, Flight } from "./constellation-camera.ts";
import type { InView } from "./use-in-view.ts";
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
const FOOT_LINE = "[data-testid=graph-foot]";
const topicButton = (id: string) => `[data-testid=graph-topic][data-topic-id=${JSON.stringify(id)}]`;

/** The picture over one progress payload (loaded lazily by graph-screen.tsx).
 *  A picked topic or fact docks its panel at the right and the picture
 *  re-fits beside it; with too little room the panel shows alone. A pick
 *  flies the camera into its topic, and closing it flies back. */
export function GraphBody({
	data,
	matches,
	sources,
	studying,
	studyError,
	onStudy,
	onStudyFact,
	initialSelected = null,
	onInView,
	aim,
	onFly,
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
	/** What is in view while the picture is zoomed in; null at the whole space. */
	onInView: (v: InView | null) => void;
	/** The camera's latest flight, asked for here or by the foot line. */
	aim: Aim | null;
	onFly: (to: Flight) => void;
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

	// The camera outlives the picture, which a narrow window unmounts while a panel shows.
	const camera = useRef<CameraMemory>({ shot: null, back: null, done: 0 });
	// A picked topic gone in a graph change closes with no flight back, so its saved view goes with it.
	const gone = selectedId !== null && !selected;
	useEffect(() => {
		if (gone) camera.current.back = null;
	}, [gone]);
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

	// A pick flies into its topic; a click on the picked topic, or on empty picture (null), closes it and flies back.
	const pick = (id: string | null) => {
		const closes = id === null || id === selectedId;
		if (closes) closing();
		else opening();
		setFactId(null);
		setSelectedId(closes ? null : id);
		if (!closes) onFly({ to: "topic", id, fact: null });
		else if (selectedId) onFly({ to: "back" });
	};
	// A fact opens with its topic picked, so the picture shows where it sits, flying in unless it is already near.
	const openFact = (id: string) => {
		opening();
		const topicId = data.facts.find((f) => f.id === id)?.topicId;
		if (topicId) {
			setSelectedId(topicId);
			onFly({ to: "topic", id: topicId, fact: id });
		}
		setFactId(id);
	};
	const backToTopic = () => {
		opening();
		setFactId(null);
	};
	const close = () => pick(null);

	// Escape closes the fact, then the topic, then flies to the whole space (menus, dialogs and Find's typing line claim theirs first).
	// The last only from the picture, the foot line or nowhere, so Escape elsewhere on the page never moves the camera; at the whole space it changes nothing.
	const onEscape = useRef(() => {});
	onEscape.current = () => {
		const at = document.activeElement;
		if (fact) backToTopic();
		else if (selected) close();
		else if (!at || at === document.body || at.closest(`${PICTURE}, ${FOOT_LINE}`)) onFly({ to: "whole" });
	};
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) onEscape.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

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
							onInView={onInView}
							camera={camera}
							aim={aim}
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
