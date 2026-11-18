/**
 * The Graph picture: every fact a small square star, every topic a cluster of
 * them with its name under it, faint lines between topics that build on each
 * other. Pointing at a topic inks in its lines with arrows and dims the rest;
 * pointing at a star inks in the facts it builds on and leads to. A picture
 * taller than its box is drawn smaller; names shrink with it until too small
 * to read, then show only when lit, at full size; hover boxes never shrink.
 * It inks in as the tab opens.
 *
 * A camera looks at the picture (use-camera.ts): zoomed in, stars stop
 * growing at 12 points and only the gaps grow, and once the picture is near
 * each topic shows as its figure (constellation-figure-layer.tsx).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { rampColor, type FactProgress, type GraphChain, type TopicLink, type TopicProgress } from "@/shared/core";
import { factCellLabel, factLinks, neighbors, topicCountLine } from "./derive.ts";
import { NAME_GAP, NAME_LINE, layoutSky, restLines, type Cluster, type Rect, type Seg, type Sky, type Star } from "./constellation-layout.ts";
import { makeRouter, toStars } from "./constellation-routes.ts";
import { NAME_PX, fitPicture, namesHidden } from "./constellation-fit.ts";
import { NAME_AFTER, RIM_AFTER, frozenDelays, lineDelay, type Reveal } from "./constellation-reveal.ts";
import { MOON_PITCH, STAR_CAP, camShowing, isNear, nearRamp, pitchOf, project, starPitch, toLayout, viewRect, type Aim, type CameraMemory, type Frame } from "./constellation-camera.ts";
import { FigureLayer, NameTag, TAG_H, TAG_PX, starHalf, tagLabel, useDrawIn } from "./constellation-figure-layer.tsx";
import { tagSpot, tipSpot } from "./constellation-tips.ts";
import { useCamera } from "./use-camera.ts";
import { useDrawnSky, useFigures } from "./use-figure.ts";
import { useInViewReport, type InView } from "./use-in-view.ts";
import { DIM, FADE, FAINT } from "./styles.ts";

const DIM_NAME = "color-mix(in srgb, var(--muted-foreground) 62%, var(--background))";
const ARROW = 7;
/** How near a star, and how far past a cluster's edge, the pointer reaches, in screen points. */
const HIT = 12;
const REACH = 8;
const TIP_W = 260;
/** Near, figures are drawn for what is in view and this much around it, in screen points. */
const MARGIN = 60;

const canvases = new Map<number, CanvasRenderingContext2D | null>();
/** Text widths in the page's font at `px` points. */
function measurer(px: number): (t: string) => number {
	if (!canvases.has(px)) canvases.set(px, document.createElement("canvas").getContext("2d"));
	const ctx = canvases.get(px);
	// A DOM with no canvas (tests) gets a rough width per letter.
	if (!ctx) return (t) => (t.length * 7 * px) / 13;
	ctx.font = `${px}px ${getComputedStyle(document.body).fontFamily}`;
	return (t) => ctx.measureText(t).width;
}

const fx = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

/** The lines as one path; `trim` stops each short of its end, where its arrowhead sits. */
function segPath(segs: readonly Seg[], trim = 0): string {
	return segs
		.map((g) => {
			const p = g.pts;
			const ex = p[p.length - 2]!;
			const ey = p[p.length - 1]!;
			let k = p.length - 2;
			while (k > 2 && Math.hypot(ex - p[k]!, ey - p[k + 1]!) < trim) k -= 2;
			let d = `M${fx(p[0]!)} ${fx(p[1]!)}`;
			for (let i = 2; i < k; i += 2) d += `L${fx(p[i]!)} ${fx(p[i + 1]!)}`;
			return `${d}L${fx(ex - g.ux * trim)} ${fx(ey - g.uy * trim)}`;
		})
		.join("");
}

/** A small solid arrowhead at each line's end, so "leads to" reads at a glance. */
function arrows(segs: readonly Seg[], len: number): string {
	return segs
		.map((g) => {
			const x2 = g.pts[g.pts.length - 2]!;
			const y2 = g.pts[g.pts.length - 1]!;
			const bx = x2 - g.ux * len;
			const by = y2 - g.uy * len;
			const w = len * 0.5;
			return `M${fx(x2)} ${fx(y2)}L${fx(bx - g.uy * w)} ${fx(by + g.ux * w)}L${fx(bx + g.uy * w)} ${fx(by - g.ux * w)}z`;
		})
		.join("");
}

type Squares = (stars: readonly Star[], grow?: number) => string;

/** One path per color, so a cluster is a handful of elements however many stars it has.
 *  In the reveal its core (the best known half) inks in first, then its rim. */
function ClusterStars({ k, sq, keep, at }: { k: Cluster; sq: Squares; keep: ReadonlySet<string> | null; at: number | null }) {
	const half = Math.ceil(k.stars.length / 2);
	const ring = (stars: readonly Star[], delay: number | null) => {
		const byColor = new Map<string, { full: Star[]; faint: Star[] }>();
		for (const st of stars) {
			const e = byColor.get(st.color) ?? byColor.set(st.color, { full: [], faint: [] }).get(st.color)!;
			(keep && !keep.has(st.id) ? e.faint : e.full).push(st);
		}
		const paths = [...byColor].map(([color, e]) => (
			<g key={color} fill={color}>
				{e.full.length > 0 && <path d={sq(e.full)} />}
				{e.faint.length > 0 && <path d={sq(e.faint)} opacity={FAINT} />}
			</g>
		));
		return delay === null ? paths : <g className="lh-reveal" style={{ ["--lh-at" as string]: `${delay}ms` }}>{paths}</g>;
	};
	if (at === null) return ring(k.stars, null);
	return (
		<>
			{ring(k.stars.slice(0, half), at)}
			{ring(k.stars.slice(half), at + RIM_AFTER)}
		</>
	);
}

/** `reach` is in layout points: HIT / scale keeps it the same on screen. */
function nearestStar(sky: Sky, x: number, y: number, reach: number): Star | null {
	let best: Star | null = null;
	let bd = reach * reach;
	for (const st of sky.stars) {
		const d = (st.cx - x) ** 2 + (st.cy - y) ** 2;
		if (d < bd) {
			bd = d;
			best = st;
		}
	}
	return best;
}

function clusterAt(sky: Sky, x: number, y: number, reach: number): Cluster | null {
	return sky.clusters.find((k) => Math.hypot(k.cx - x, k.cy - y) <= k.r + reach) ?? null;
}

/** The topic and every topic it links to, both ways. */
function neighbourhood(id: string, links: readonly TopicLink[]): Set<string> {
	const s = new Set([id]);
	for (const l of links) {
		if (l.from === id) s.add(l.to);
		if (l.to === id) s.add(l.from);
	}
	return s;
}

/** "A", "A and B", "A, B and C". */
function names(ts: readonly TopicProgress[]): string {
	const n = ts.map((t) => t.name);
	return n.length < 2 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** What a screen reader hears on a topic: "Pointers, shaky, 13 facts, 2 of 3 right, needs Arrays, leads to Structs". */
function topicLabel(t: TopicProgress, links: readonly TopicLink[], byId: ReadonlyMap<string, TopicProgress>): string {
	const { needs, leadsTo } = neighbors(t.id, links, byId);
	return [
		t.name,
		t.status === "untested" ? "" : t.status,
		topicCountLine(t.members.length, t),
		needs.length ? `needs ${names(needs)}` : "",
		leadsTo.length ? `leads to ${names(leadsTo)}` : "",
	]
		.filter(Boolean)
		.join(", ");
}

const KEY_DIR: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** The nearest topic from `k` in a direction, favouring ones straight ahead. */
function nextTopic(sky: Sky, k: Cluster, [dx, dy]: [number, number]): Cluster | null {
	let best: Cluster | null = null;
	let bs = Infinity;
	for (const o of sky.clusters) {
		const along = (o.cx - k.cx) * dx + (o.cy - k.cy) * dy;
		if (o === k || along <= 0) continue;
		const score = along + 2 * Math.abs((o.cx - k.cx) * dy - (o.cy - k.cy) * dx);
		if (score < bs) {
			bs = score;
			best = o;
		}
	}
	return best;
}

const discRect = (k: Cluster): Rect => ({ x0: k.cx - k.r, x1: k.cx + k.r, y0: k.cy - k.r, y1: k.cy + k.r });

export function Constellation({
	topics,
	links,
	facts,
	chains,
	width,
	height,
	reveal,
	pickedId,
	pickedFactId,
	focus,
	factMatches,
	onPick,
	onPickFact,
	onInView,
	camera,
	aim,
}: {
	topics: readonly TopicProgress[];
	links: readonly TopicLink[];
	facts: readonly FactProgress[];
	/** Fact chains; null while they load. */
	chains: readonly Pick<GraphChain, "premises" | "conclusion">[] | null;
	/** The room the picture gets. */
	width: number;
	/** The most height it may take: a taller picture scales down evenly to fit. */
	height: number;
	/** This opening's reveal while it runs; null once the picture is in. */
	reveal: Reveal | null;
	pickedId: string | null;
	pickedFactId: string | null;
	/** Topics Find keeps lit; null with nothing typed. */
	focus: ReadonlySet<string> | null;
	/** Facts Find matched; null with nothing typed. */
	factMatches: ReadonlySet<string> | null;
	/** A topic, or null for a click on empty picture. */
	onPick: (topicId: string | null) => void;
	onPickFact: (factId: string) => void;
	/** What is in view while zoomed in; null at the whole space. */
	onInView: (v: InView | null) => void;
	camera: RefObject<CameraMemory>;
	/** The latest flight asked for. */
	aim: Aim | null;
}) {
	// Names are measured in the loaded font, so lay out again once it is in.
	const [fontsIn, setFontsIn] = useState(false);
	useEffect(() => {
		let live = true;
		// A DOM without font loading (tests) keeps the first measure.
		void document.fonts?.ready.then(() => live && setFontsIn(true));
		return () => {
			live = false;
		};
	}, []);
	// fontsIn is here so the names are measured again once the font is in.
	const measure = useMemo(() => measurer(NAME_PX), [fontsIn]);
	const measureTag = useMemo(() => measurer(TAG_PX), [fontsIn]);
	const { sky, scale, router, rest, nn } = useMemo(() => {
		const { sky, scale } = fitPicture((w) => layoutSky(topics, links, facts, w, measure), { width, height });
		const router = makeRouter(sky);
		return {
			sky,
			scale,
			router,
			rest: restLines(sky, links, (a, z) => router.link(a, z, null, false)),
			nn: starPitch(sky),
		};
	}, [topics, links, facts, width, height, measure]);
	const shownW = sky.width * scale;
	const shownH = sky.height * scale;
	// Zoomed in, the view takes the whole room's height, not only the fitted picture's.
	const frame: Frame = useMemo(() => ({ w: shownW, h: Math.max(shownH, height), scale, skyW: sky.width, skyH: sky.height }), [shownW, shownH, height, scale, sky]);

	const boxRef = useRef<HTMLDivElement>(null);
	const { figures, placed } = useFigures(sky, chains, nn);
	const { cam, zoomed, zMax, flyTo, drag, dragging, landed } = useCamera({ sky, placed, frame, nn, memory: camera, aim, box: boxRef });
	const drawIn = useDrawIn(landed);
	const P = project(cam, frame);
	const { k: kk, tx, ty } = P;
	const pitch = pitchOf(cam, frame, nn);
	const view = viewRect(cam, frame);
	const around = viewRect(cam, frame, MARGIN);
	const nearView = (x: number, y: number) => x >= around.x0 && x <= around.x1 && y >= around.y0 && y <= around.y1;

	// Fixed for this mount: a re-fit never moves a running animation, and a
	// remount mid-reveal starts each one where it would be by now.
	const [opening] = useState(() => (reveal ? { at: frozenDelays(reveal, sky), elapsed: performance.now() - reveal.start } : null));
	const inAt = reveal ? opening : null;
	const startOf = (id: string) => {
		const at = inAt?.at.get(id);
		return at === undefined ? undefined : at - inAt!.elapsed;
	};
	// Work out every lit line and fact chain in the background so the first hover is instant too, in slices of about 8 ms so the page never stalls.
	useEffect(() => {
		const drawn = (id: string) => sky.byTopic.get(id)?.muted === false;
		const jobs: (() => void)[] = links
			.filter((l) => l.from !== l.to && drawn(l.from) && drawn(l.to))
			.flatMap((l) => [l.from, l.to].map((lead) => () => void router.link(l.from, l.to, lead, true)));
		for (const c of chains ?? []) for (const p of c.premises) if (p !== c.conclusion) jobs.push(() => void router.chain(p, c.conclusion));
		let i = 0;
		let timer = 0;
		const step = () => {
			const end = performance.now() + 8;
			do {
				const job = jobs[i++];
				if (!job) return;
				job();
			} while (performance.now() < end);
			timer = window.setTimeout(step, 0);
		};
		timer = window.setTimeout(step, 300);
		return () => window.clearTimeout(timer);
	}, [sky, router, links, chains]);
	const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
	const labels = useMemo(() => new Map(topics.map((t) => [t.id, topicLabel(t, links, topicById)])), [topics, links, topicById]);
	const factById = useMemo(() => new Map(facts.map((f) => [f.id, f])), [facts]);

	const [hoverId, setHoverId] = useState<string | null>(null);
	const [ptrStar, setPtrStar] = useState<string | null>(null);
	// The fact open in its panel stays marked with its chains inked; a pointed-at star takes over.
	const starId = ptrStar ?? pickedFactId;
	const star = starId ? (sky.starById.get(starId) ?? null) : null;

	const starLinks = useMemo(() => {
		if (!star) return null;
		const { buildsOn, leadsTo } = factLinks(star.id, chains ?? []);
		const ends: Star[] = [];
		const segs: Seg[] = [];
		const add = (a: string, z: string, other: string) => {
			const end = sky.starById.get(other);
			if (!end) return;
			ends.push(end);
			// A chain whose two stars nearly touch keeps its marked end star and needs no line.
			const g = router.chain(a, z);
			if (g) segs.push(g);
		};
		for (const id of buildsOn) add(id, star.id, id);
		for (const id of leadsTo) add(star.id, id, id);
		return { segs, ends, topics: new Set([star.topicId, ...ends.map((e) => e.topicId)]) };
	}, [star, chains, sky, router]);

	// One topic leads: the hovered one, else the picked one. Its lines ink in.
	const lead = star ? null : (hoverId ?? pickedId);
	const lit = useMemo(() => {
		const base = starLinks ? starLinks.topics : hoverId ? neighbourhood(hoverId, links) : (focus ?? (pickedId ? neighbourhood(pickedId, links) : null));
		// The picked topic never dims.
		return base && pickedId && !base.has(pickedId) ? new Set([...base, pickedId]) : base;
	}, [starLinks, hoverId, focus, pickedId, links]);
	const inked = useMemo(() => {
		if (!lead || sky.byTopic.get(lead)?.muted !== false) return [];
		const grouped = (id: string) => sky.byTopic.get(id)?.muted === false;
		return links
			.filter((l) => (l.from === lead || l.to === lead) && l.from !== l.to && grouped(l.from) && grouped(l.to))
			.map((l) => router.link(l.from, l.to, hoverId === lead ? lead : null, true))
			// A link listed twice gives the same remembered line; draw it once.
			.filter((g, i, all): g is Seg => !!g && all.indexOf(g) === i);
	}, [lead, links, sky, router, hoverId]);

	// Find: inside a topic found by its facts, only the matching stars stay full ink.
	const { keep, found } = useMemo(() => {
		if (!factMatches || !focus) return { keep: null, found: [] as Star[] };
		const keep = new Set<string>();
		const found: Star[] = [];
		for (const k of sky.clusters) {
			const hits = k.stars.filter((s) => factMatches.has(s.id));
			for (const s of hits.length ? hits : k.stars) keep.add(s.id);
			if (hits.length && hits.length < k.stars.length) found.push(...hits);
		}
		return { keep, found };
	}, [factMatches, focus, sky]);

	// Stars on screen: their drawn size grows with the zoom up to STAR_CAP, centred where they are.
	const d = zoomed ? Math.min(sky.s * kk, STAR_CAP) : sky.s * scale;
	const sx = (x: number) => x * kk + tx;
	const sy = (y: number) => y * kk + ty;
	const sq: Squares = (stars, grow = 0) => {
		const g = grow * Math.min(kk, 1);
		const w = f2(d + 2 * g);
		return stars.map((t) => `M${f2(sx(t.cx) - d / 2 - g)} ${f2(sy(t.cy) - d / 2 - g)}h${w}v${w}h-${w}z`).join("");
	};

	// Near, each topic shows as its figure, its facts gliding to their places, and topic names move down under them.
	const near = isNear(pitch, cam.z);
	const ramp = nearRamp(pitch, cam.z);
	const moons = pitch >= MOON_PITCH;
	const ext = near ? starHalf(moons) : d / 2;
	const { drawn: moved, t: glide } = useDrawnSky(sky, figures, near);
	// Topic names: at their laid-out size scaled with the picture, never above 13 points.
	const tiny = namesHidden(kk);
	const namePlace = (k: Cluster, shown: boolean) => {
		const f = tiny && shown ? 1 : Math.min(1, kk);
		const w = k.textW * f;
		const h = k.text.length * NAME_LINE * f;
		const cx = sx(k.cx);
		const left = zoomed ? cx - w / 2 : Math.max(0, Math.min(shownW - w, cx - w / 2));
		// Near, the name hangs from the figure's lowest star rather than the disc's edge.
		const fromDisc = (k.nameTop - NAME_GAP) * kk + ty + NAME_GAP * Math.min(1, kk);
		const lowest = Math.max(k.cy, ...(moved.byTopic.get(k.topic.id) ?? k).stars.map((st) => st.cy));
		const fromStar = sy(lowest) + Math.max(d / 2, ext) + NAME_GAP;
		const top = fromDisc + ramp * (fromStar - fromDisc);
		// Zoomed in, a name the view's edge would cut is not drawn: the foot line names the topic instead.
		const whole = !zoomed || (left >= 0 && top >= 0 && left + w <= shownW && top + h <= frame.h);
		return { left, top, w, h, f, whole };
	};
	const toLayoutRect = (r: { left: number; top: number; w: number; h: number }): Rect => ({ x0: (r.left - tx) / kk, x1: (r.left + r.w - tx) / kk, y0: (r.top - ty) / kk, y1: (r.top + r.h - ty) / kk });

	const nearClusters = moved.clusters.filter((k) => k.cx + k.r >= around.x0 && k.cx - k.r <= around.x1 && k.cy + k.r >= around.y0 && k.cy - k.r <= around.y1);

	// Roving focus: one Tab stop among the topics, arrow keys move between them.
	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const [tabId, setTabId] = useState<string | null>(null);
	// A topic picked anywhere, a chip in its panel too, becomes the Tab stop.
	useEffect(() => {
		if (pickedId) setTabId(pickedId);
	}, [pickedId]);
	const first = useMemo(() => [...sky.clusters].sort((a, b) => a.cx - b.cx || a.cy - b.cy)[0]?.topic.id ?? null, [sky]);
	const stop = [tabId, pickedId].find((id) => id && sky.byTopic.has(id)) ?? first;
	const onKey = (e: KeyboardEvent<HTMLButtonElement>, k: Cluster) => {
		const dir = KEY_DIR[e.key];
		if (!dir) return;
		e.preventDefault();
		const next = nextTopic(sky, k, dir);
		if (!next) return;
		setTabId(next.topic.id);
		buttons.current.get(next.topic.id)?.focus();
	};
	// Zoomed in, a topic that takes focus outside the view comes into it.
	const showTopic = (k: Cluster) => {
		if (!zoomed) return;
		const r = discRect(k);
		const n = toLayoutRect(namePlace(k, true));
		const next = camShowing(cam, frame, { x0: Math.min(r.x0, n.x0), x1: Math.max(r.x1, n.x1), y0: r.y0, y1: Math.max(r.y1, n.y1) }, 24, zMax);
		if (next !== cam) flyTo(next);
	};

	// The pointer in layout points, whatever the zoom.
	const local = (e: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		return toLayout(P, e.clientX - r.left, e.clientY - r.top);
	};
	const onMove = (e: PointerEvent<HTMLDivElement>) => {
		if (drag.move(e)) {
			setPtrStar(null);
			setHoverId(null);
			return;
		}
		// Over a name, its button sets the hover itself.
		if (e.target instanceof Element && e.target.closest("[data-topic-id]")) return setPtrStar(null);
		const { x, y } = local(e);
		const st = nearestStar(moved, x, y, HIT / kk);
		setPtrStar(st?.id ?? null);
		setHoverId(st ? null : (clusterAt(sky, x, y, REACH / kk)?.topic.id ?? null));
	};
	const onLeave = () => {
		setPtrStar(null);
		setHoverId(null);
	};
	// Names are buttons with their own click; this is stars, clusters and empty picture.
	// The second click of a double-click does nothing, so a double-click never opens and closes a topic.
	const onClick = (e: MouseEvent<HTMLDivElement>) => {
		if (drag.ended() || e.detail >= 2) return;
		const { x, y } = local(e);
		const st = nearestStar(moved, x, y, HIT / kk);
		if (st) onPickFact(st.id);
		else onPick(clusterAt(sky, x, y, REACH / kk)?.topic.id ?? null);
	};

	const pointed = star && ptrStar ? factById.get(star.id) : undefined;
	// Hover boxes sit where they cover neither the hovered thing nor what it lights.
	const starTip = (() => {
		if (near || !star || !pointed || !starLinks) return null;
		const nameW = measure(pointed.name);
		const w = Math.min(TIP_W, Math.max(nameW, (measure(factCellLabel(pointed)) * 12) / 13) + 34);
		const h = 30 + Math.ceil(nameW / (TIP_W - 34)) * 20 + 20;
		const half = (d / 2 + 3) / kk;
		const at: Rect = { x0: star.cx - half, y0: star.cy - half, x1: star.cx + half, y1: star.cy + half };
		const spot = tipSpot(sky, at, w / kk, h / kk, 8 / kk, starLinks.topics, starLinks.segs, view);
		return { w, left: sx(spot.left), top: sy(spot.top) };
	})();
	// Near, a pointed star's name on one line instead, never over the stars its lines join; none for the fact whose panel says it.
	const tag = (() => {
		if (!near || !star || !pointed || pointed.id === pickedFactId) return null;
		const { text, w } = tagLabel(pointed.name, measureTag);
		const onScreen = (s: Star) => ({ id: s.id, x: sx(s.cx), y: sy(s.cy) });
		const at = moved.starById.get(star.id) ?? star;
		const own = new Set([at.id, ...(starLinks?.ends.map((e) => e.id) ?? [])]);
		const topicTop = Math.min(...(moved.byTopic.get(at.topicId) ?? { stars: [at] }).stars.map((o) => sy(o.cy)));
		return { text, w, ...tagSpot({ at: onScreen(at), half: ext + 4, w, h: TAG_H, room: { w: shownW, h: frame.h }, stars: nearClusters.flatMap((k) => k.stars.map(onScreen)), topicTop, own, ext: ext + 3 }) };
	})();
	const hovered = hoverId && !star ? sky.byTopic.get(hoverId) : undefined;
	const topicTip = hovered ? tipSpot(sky, toLayoutRect(namePlace(hovered, true)), hovered.tipW / kk, 16 / kk, 6 / kk, lit ?? new Set([hovered.topic.id]), inked, view) : null;

	useInViewReport(moved, zoomed ? view : null, factById, onInView);

	const lineW = (w: number) => w / cam.z;
	const shownLinks = starLinks?.segs.map((g) => {
		const a = sky.starById.get(g.from);
		const z = sky.starById.get(g.to);
		// Zoomed in, a chain runs on to its stars, which no longer grow with it.
		return zoomed && a && z ? toStars(g, a, z, (d / 2 + 3) / kk) : g;
	});

	return (
		<div
			ref={boxRef}
			data-testid="graph-picture"
			data-zoom={zoomed ? cam.z.toFixed(2) : undefined}
			data-near={near || undefined}
			className="relative select-none"
			style={{
				width: shownW,
				height: zoomed ? frame.h : shownH,
				overflow: zoomed ? "hidden" : undefined,
				cursor: dragging ? "grabbing" : star || hoverId ? "pointer" : zoomed ? "grab" : "default",
				touchAction: "none",
			}}
			onPointerDown={drag.down}
			onPointerUp={drag.up}
			onPointerCancel={drag.up}
			onPointerMove={onMove}
			onPointerLeave={onLeave}
			onClick={onClick}
		>
			<svg aria-hidden width={shownW} height={frame.h} className="absolute inset-0 overflow-visible">
				{/* Lines are drawn in layout points under one transform, at the same weight on screen at any zoom. */}
				<g transform={`matrix(${kk} 0 0 ${kk} ${tx} ${ty})`}>
					{inAt ? (
						<g fill="none" stroke="var(--foreground)" strokeOpacity={lit ? 0.07 : 0.17} strokeWidth={lineW(1.25)}>
							{rest.map((g) => (
								<path key={`${g.from}>${g.to}`} d={segPath([g])} pathLength={1} className="lh-reveal-line" style={{ ["--lh-at" as string]: `${lineDelay(g, inAt.at) - inAt.elapsed}ms` }} />
							))}
						</g>
					) : (
						<path d={segPath(rest)} fill="none" stroke="var(--foreground)" strokeOpacity={lit ? 0.07 : 0.17} strokeWidth={lineW(1.25)} style={{ transition: `stroke-opacity ${FADE}` }} />
					)}
					{/* Near, a topic's lines would end at its disc's edge, far from its stars: its panel and hover box name its links instead. */}
					{inked.length > 0 && !near && (
						<g className="lh-fade">
							<path d={segPath(inked, (ARROW - 1) / cam.z)} fill="none" stroke="var(--foreground)" strokeOpacity={0.55} strokeWidth={lineW(1.5)} />
							<path d={arrows(inked, ARROW / cam.z)} fill="var(--foreground)" fillOpacity={0.8} />
						</g>
					)}
					{star && shownLinks && !near && (
						<g className="lh-fade">
							<path d={segPath(shownLinks, 4 / cam.z)} fill="none" stroke="var(--foreground)" strokeOpacity={0.75} strokeWidth={lineW(1)} />
							<path d={arrows(shownLinks, 5 / cam.z)} fill="var(--foreground)" fillOpacity={0.85} />
						</g>
					)}
				</g>
				{/* Near, the figures take the squares' place, fading with the glide; Ungrouped keeps its squares. */}
				{moved.clusters.filter((k) => k.muted || glide < 1).map((k) => (
					<g key={k.topic.id} shapeRendering="crispEdges" opacity={(k.muted ? 1 : 1 - glide) * (lit && !lit.has(k.topic.id) ? DIM : 1)} style={k.muted || glide === 0 ? { transition: `opacity ${FADE}` } : undefined}>
						<ClusterStars k={k} sq={sq} keep={keep} at={startOf(k.topic.id) ?? null} />
					</g>
				))}
				{near && <FigureLayer clusters={nearClusters.filter((k) => !k.muted)} figures={figures} factById={factById} at={(x, y) => [sx(x), sy(y)]} shown={nearView} moons={moons} lit={lit} keep={keep} drawIn={drawIn} pointId={star?.id ?? null} />}
				{found.length > 0 && !near && <path shapeRendering="crispEdges" d={sq(found.map((s) => moved.starById.get(s.id) ?? s))} fill="var(--foreground)" />}
				{star && starLinks && !near && (
					<g className="lh-fade" shapeRendering="crispEdges">
						{/* A chain's other ends grow in their own color; the star itself grows inside a solid 2-point ink frame. */}
						{starLinks.ends.map((e) => (
							<path key={e.id} d={sq([e], 2)} fill={e.color} />
						))}
						<path d={sq([star], 4)} fill="var(--foreground)" />
						<path d={sq([star], 2)} fill={star.color} />
					</g>
				)}
			</svg>
			{sky.clusters.map((k) => {
				const id = k.topic.id;
				const picked = id === pickedId;
				const dim = lit && !lit.has(id);
				// Too small to read at rest: not drawn until pointed at, picked, lit or found.
				const readable = !tiny || hoverId === id || picked || !!lit?.has(id);
				const np = namePlace(k, readable);
				const shown = readable && np.whole;
				const size = np.f;
				const at = startOf(id);
				// Near, the topic name is the strongest text on the picture.
				const strong = near && !k.muted;
				return (
					<button
						key={id}
						ref={(el) => {
							if (el) buttons.current.set(id, el);
							else buttons.current.delete(id);
						}}
						type="button"
						data-testid="graph-topic"
						data-topic-id={id}
						aria-label={labels.get(id)}
						aria-pressed={picked}
						data-dim={dim ? true : undefined}
						tabIndex={id === stop ? 0 : -1}
						onClick={(e) => {
							e.stopPropagation();
							// A drag that started on the name ends here without opening it.
							if (drag.ended() || e.detail >= 2) return;
							setTabId(id);
							onPick(id);
						}}
						onKeyDown={(e) => onKey(e, k)}
						onPointerEnter={() => setHoverId(id)}
						onFocus={() => {
							setHoverId(id);
							showTopic(k);
						}}
						onBlur={() => setHoverId(null)}
						className={at === undefined ? "absolute block text-center" : "lh-reveal absolute block text-center"}
						style={{
							left: np.left,
							top: np.top,
							width: np.w,
							fontSize: NAME_PX * size,
							lineHeight: `${NAME_LINE * size}px`,
							// Hidden, it lets the pointer through to the stars; it stays focusable.
							opacity: shown ? undefined : 0,
							pointerEvents: shown ? undefined : "none",
							zIndex: (tiny && shown) || zoomed ? 10 : undefined,
							transition: `color ${FADE}, opacity ${FADE}`,
							color: dim ? DIM_NAME : k.muted ? "var(--lh-ink-3)" : strong || hoverId === id || picked ? "var(--foreground)" : "var(--muted-foreground)",
							["--lh-at" as string]: at === undefined ? undefined : `${at + NAME_AFTER}ms`,
						}}
					>
						<span
							aria-hidden
							className="inline-block whitespace-nowrap align-top"
							style={picked ? { paddingBottom: 3 * size, borderBottom: "2px solid var(--foreground)" } : undefined}
						>
							{k.text.map((ln, i) => (
								<span key={i} className="block">
									{/* A tested topic's name starts with a square in its status color. */}
									{i === 0 && k.topic.status !== "untested" && !k.muted && (
										<span className="inline-block align-[0px]" style={{ width: 9 * size, height: 9 * size, marginRight: 5 * size, background: rampColor(k.topic.rate), opacity: dim ? 0.5 : 1, transition: `opacity ${FADE}` }} />
									)}
									{ln}
								</span>
							))}
						</span>
					</button>
				);
			})}
			{/* The score inks in near the name: no box over the picture. */}
			{hovered && topicTip && (
				<span
					key={hovered.topic.id}
					aria-hidden
					className="lh-fade pointer-events-none absolute whitespace-nowrap text-xs leading-4 text-muted-foreground"
					style={{ left: sx(topicTip.left), top: sy(topicTip.top) }}
				>
					{topicCountLine(hovered.topic.members.length, hovered.topic)}
				</span>
			)}
			{pointed && starTip && (
				<div aria-hidden className="lh-fade pointer-events-none absolute z-20 flex" style={{ left: starTip.left, top: starTip.top, width: starTip.w }}>
					<div className="lh-sheet flex w-full flex-col gap-1 px-3.5 pt-2.5 pb-3.5">
						<div className="text-sm text-foreground">{pointed.name}</div>
						<div className="text-xs text-muted-foreground">{factCellLabel(pointed)}</div>
					</div>
				</div>
			)}
			{tag && <NameTag key={star?.id} {...tag} />}
		</div>
	);
}
