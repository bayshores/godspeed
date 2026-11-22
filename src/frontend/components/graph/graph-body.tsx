import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FactProgress, ProgressPayload } from "@/shared/core";
import { Constellation } from "./constellation.tsx";
import type { Aim, CameraMemory, Flight } from "./constellation-camera.ts";
import type { InView } from "./use-in-view.ts";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { FactPane, type FactSources } from "./fact-pane.tsx";
import { GraphEmpty } from "./graph-empty.tsx";
import { GraphLayout } from "./graph-layout.tsx";
import { panelAlone } from "./graph-layout-model.ts";
import { TopicPane } from "./topic-pane.tsx";
import type { PanelRoom } from "./use-link-fit.ts";
import { REVEAL_MS, type Reveal } from "./constellation-reveal.ts";
import { nothingGrouped } from "./derive.ts";
import { useRoom } from "./use-room.ts";

const PICTURE = "[data-testid=graph-picture]";
const PANEL_BOX = "[data-testid=graph-panel]";
const PANEL_CLOSE = "[data-testid=topic-pane-close], [data-testid=fact-pane-close]";
const FOOT_LINE = "[data-testid=graph-foot]";
const topicButton = (id: string) => `[data-testid=graph-topic][data-topic-id=${JSON.stringify(id)}]`;

/** The picture over one progress payload (loaded lazily by graph-screen.tsx).
 *  A picked topic or fact opens its panel as a slip under the picture
 *  (graph-layout.tsx); with too little room the panel shows alone. A pick
 *  flies the camera into its topic, and closing it flies back. Before any
 *  topic, a fact opens alone, where it is. */
export function GraphBody({
	data,
	matches,
	sources,
	note,
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
	/** The line under facts no topic holds yet; null while it is not said. */
	note: string | null;
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
	// The picture inks in once per opening of the tab, and once more when the first topics arrive; a re-fit, Find, pick or refresh never replays it.
	const [reveal, setReveal] = useState<Reveal | null>(() => (prefersReducedMotion() ? null : { start: performance.now(), at: null }));
	const waiting = nothingGrouped(data.topics);
	const [wasWaiting, setWasWaiting] = useState(waiting);
	if (wasWaiting !== waiting) {
		setWasWaiting(waiting);
		if (!waiting && data.topics.length > 0 && !prefersReducedMotion()) setReveal({ start: performance.now(), at: null });
	}
	useEffect(() => {
		if (!reveal) return;
		const timer = window.setTimeout(() => setReveal(null), REVEAL_MS);
		return () => window.clearTimeout(timer);
	}, [reveal]);
	// A graph change keeps the pick; a topic or fact that is gone closes its panel.
	const selected = selectedId ? data.topics.find((t) => t.id === selectedId) : undefined;
	const fact = factId ? data.facts.find((f) => f.id === factId) : undefined;

	const alone = panelAlone(room);

	// The camera outlives the picture, which a small room unmounts while a panel shows.
	const camera = useRef<CameraMemory>({ shot: null, back: null, done: 0 });
	// A picked topic gone in a graph change closes with no flight back, so its saved view goes with it.
	const gone = selectedId !== null && !selected;
	useEffect(() => {
		if (gone) camera.current.back = null;
	}, [gone]);
	// Keyboard focus follows the panel: a pick that hides the picture, or a
	// change inside the panel, lands on the panel's Close; closing from inside
	// the panel lands back on the topic's button. Applied after the render,
	// or once a panel shown alone has left and the picture is back.
	const focusNext = useRef<string | null>(null);
	const moveFocus = () => {
		const target = focusNext.current && room.ref.current?.querySelector<HTMLElement>(focusNext.current);
		if (!target) return;
		focusNext.current = null;
		target.focus();
	};
	useLayoutEffect(moveFocus);
	const focusIn = (box: string) => !!room.ref.current?.querySelector(box)?.contains(document.activeElement);
	const opening = () => {
		if (focusIn(PANEL_BOX) || (alone && focusIn(PICTURE))) focusNext.current = PANEL_CLOSE;
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
	// Before any topic it opens alone and the picture stays where it is.
	const openFact = (id: string) => {
		opening();
		const topicId = data.facts.find((f) => f.id === id)?.topicId;
		if (topicId && !waiting) {
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
		if (fact && selected) backToTopic();
		else if (fact || selected) close();
		else if (!at || at === document.body || at.closest(`${PICTURE}, ${FOOT_LINE}`)) onFly({ to: "whole" });
	};
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) onEscape.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	if (data.topics.length === 0) return <GraphEmpty inSpace={data.spaceId !== null} />;

	// The picked topic never dims under Find.
	const focus = matches && selected ? new Set([...matches.topics, selected.id]) : (matches?.topics ?? null);
	const panel =
		fact ? (fits: PanelRoom) => (
			<FactPane
				key={fact.id}
				fact={fact}
				topic={selected ?? null}
				facts={data.facts}
				sources={sources}
				room={fits}
				onBack={backToTopic}
				onClose={close}
				onOpenFact={openFact}
				onStudy={onStudyFact}
				studying={studying}
				studyError={studyError}
			/>
		) : selected ? (fits: PanelRoom) => (
			<TopicPane
				key={selected.id}
				topic={selected}
				topics={data.topics}
				links={data.topicLinks}
				facts={data.facts}
				room={fits}
				onClose={close}
				onSelectTopic={pick}
				onOpenFact={openFact}
				onStudy={onStudy}
				studying={studying}
				studyError={studyError}
			/>
		) : null;
	return (
		<GraphLayout
			room={room}
			panelKey={fact?.id ?? selected?.id ?? null}
			panel={panel}
			onRefit={() => selected && onFly({ to: "topic", id: selected.id, fact: null })}
			onGone={() => {
				moveFocus();
				focusNext.current = null;
			}}
			picture={({ width, height, bleed }) => (
				<Constellation
					topics={data.topics}
					links={data.topicLinks}
					facts={data.facts}
					chains={sources?.chains ?? null}
					width={width}
					height={height}
					bleed={bleed}
					reveal={reveal}
					note={note}
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
			)}
		/>
	);
}
