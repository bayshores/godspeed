import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import { cn } from "@/frontend/lib/utils";
import type { ArtifactPartProps } from "@/shared/core";
import { keyTops, labelPieces, lineEnd, linePath, liveText, readPlot, scale, sliderText, sliderTicks, ticks, formatNumber, type Plot } from "./plot-part-model";

// The figure under the title, in px: the y axis's labels take the gutter,
// the plot area is 240 tall, and the slider row sits under the x title.
const GUTTER = 44;
const KEY_WIDTH = 136;
const PLOT_TOP = 31;
const PLOT_BOTTOM = 271;
const AXIS_HEIGHT = 296;
const X_TITLE_TOP = 294;
const LOCKED_HEIGHT = 311;
const TRACK_Y = 340;
const OPEN_HEIGHT = 363;
/** A key's label sits level with its line; the formula under it. */
const KEY_LIFT = 8;
const KEY_GAP = 40;
const DASH = "6 4";
/** The live line waits this long after the slider's last move. */
const LIVE_WAIT_MS = 300;

/** Math in a label or a formula, typeset by KaTeX with its sizes capped. */
function Tex({ tex, className }: { tex: string; className?: string }) {
	const html = useMemo(() => katex.renderToString(tex, { throwOnError: false, strict: "ignore", output: "html", maxSize: 1, maxExpand: 20 }), [tex]);
	// renderToString is KaTeX's own escaped output.
	return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A label's words, with its $math$ typeset. */
function Label({ text }: { text: string }) {
	return (
		<>
			{labelPieces(text).map((p, i) => (p.math ? <Tex key={i} tex={p.text} /> : <span key={i}>{p.text}</span>))}
		</>
	);
}

/** KaTeX caps only positive sizes, so a negative kern or raise in a label
 *  could reach past the box; the box cuts it off. */
function PlotBox({ title, state, children }: { title: string; state: string; children: React.ReactNode }) {
	return (
		<figure data-testid="plot-part" data-state={state} className="m-0 flex w-full flex-col overflow-hidden rounded-[2px] border border-border px-5 pt-4 pb-3.5">
			<figcaption className="font-ui text-[16px] leading-[22px] text-ink">
				<Label text={title} />
			</figcaption>
			{children}
		</figure>
	);
}

/**
 * A teacher's plot with one slider. It arrives locked with its guess: only
 * the shown lines, no slider. Once the guess is answered the held-back lines
 * and the slider draw in. While the call is checked the box says so; a
 * refused plot never reaches here (the view drops it).
 */
export function PlotPart({ part }: ArtifactPartProps) {
	const title = typeof (part.input as { title?: unknown } | undefined)?.title === "string" ? (part.input as { title: string }).title : "";
	if (part.state === "input-streaming") {
		return (
			<PlotBox title={title} state="drawing">
				<p className="mt-2 font-ui text-[14px] text-ink-2">Drawing the plot</p>
			</PlotBox>
		);
	}
	if (part.state !== "output-available") return null;
	return <StoredPlot input={part.input} output={part.output} open={part.guessOpen === true} />;
}

function StoredPlot({ input, output, open }: { input: unknown; output: unknown; open: boolean }) {
	const read = useMemo(() => readPlot(input, output), [input, output]);
	if (!("plot" in read)) {
		return (
			<PlotBox title={read.title} state="failed">
				<p className="mt-2 font-ui text-[14px] text-ink-2">This plot could not be drawn.</p>
			</PlotBox>
		);
	}
	return <PlotFigure plot={read.plot} open={open} />;
}

/** The left column's width, followed as the pane resizes. */
function useWidth(initial: number): [number, React.RefObject<HTMLDivElement | null>] {
	const ref = useRef<HTMLDivElement | null>(null);
	const [width, setWidth] = useState(initial);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		setWidth(el.clientWidth);
		const observer = new ResizeObserver(() => setWidth(el.clientWidth));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return [width, ref];
}

function PlotFigure({ plot, open }: { plot: Plot; open: boolean }) {
	const [slider, setSlider] = useState(plot.slider.start);
	// A drag would queue a sentence a step; the line speaks where it stops.
	const [heard, setHeard] = useState(plot.slider.start);
	useEffect(() => {
		const wait = setTimeout(() => setHeard(slider), LIVE_WAIT_MS);
		return () => clearTimeout(wait);
	}, [slider]);
	const [width, ref] = useWidth(GUTTER + 510);
	// Opened before it was on screen: drawn at once. Opened while watched:
	// the held-back parts draw in (globals.css .lh-draw-in).
	const [openAtMount] = useState(open);
	const drawIn = open && !openAtMount ? "lh-draw-in" : undefined;
	const clip = `plot-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;

	const frame = { left: GUTTER, right: Math.max(GUTTER + 1, width), top: PLOT_TOP, bottom: PLOT_BOTTOM };
	const px = scale(plot.x.min, plot.x.max, frame.left, frame.right);
	const py = scale(plot.y.min, plot.y.max, frame.bottom, frame.top);
	const shown = plot.lines.map((l) => open || !l.hidden);
	const keyed = shown.flatMap((on, i) => (on ? [i] : []));
	const placed = keyTops(
		keyed.map((i) => py(lineEnd(plot, plot.lines[i]!, slider) ?? plot.y.max)),
		PLOT_TOP - KEY_LIFT,
		PLOT_BOTTOM,
		KEY_GAP,
		KEY_LIFT,
	);
	const tops = new Map(keyed.map((i, k) => [i, placed[k]!]));
	const live = liveText(plot, heard, open);

	const lines = (hidden: boolean) =>
		plot.lines.map((l, i) =>
			l.hidden === hidden && shown[i] ? (
				<path key={i} d={linePath(plot, l, slider, frame)} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray={l.dashed ? DASH : undefined} />
			) : null,
		);

	return (
		<PlotBox title={plot.title} state={open ? "open" : "locked"}>
			<div className="grid gap-x-[25px]" style={{ gridTemplateColumns: `minmax(0,1fr) ${KEY_WIDTH}px` }}>
				<div ref={ref} className="relative" style={{ height: open ? OPEN_HEIGHT : LOCKED_HEIGHT }}>
					<div className="absolute top-[11px] text-[13px] leading-none whitespace-nowrap text-ink-2" style={{ left: GUTTER, right: 0 }}>
						<Label text={plot.y.label} />
					</div>
					<svg role="img" aria-label={labelPieces(plot.title).map((p) => p.text).join("")} width={width} height={AXIS_HEIGHT} className="absolute top-0 left-0 overflow-visible">
						<defs>
							<clipPath id={clip}>
								<rect x={frame.left} y={frame.top - 2} width={frame.right - frame.left + 2} height={frame.bottom - frame.top + 4} />
							</clipPath>
						</defs>
						<g className="text-ink-2" fill="currentColor" stroke="currentColor" fontSize={13}>
							<line x1={GUTTER + 0.5} y1={PLOT_TOP} x2={GUTTER + 0.5} y2={PLOT_BOTTOM + 0.5} strokeWidth={1} />
							<line x1={GUTTER} y1={PLOT_BOTTOM + 0.5} x2={frame.right} y2={PLOT_BOTTOM + 0.5} strokeWidth={1} />
							{ticks(plot.x.min, plot.x.max).map((v) => (
								<g key={`x${v}`}>
									<line x1={Math.round(px(v)) + 0.5} y1={PLOT_BOTTOM} x2={Math.round(px(v)) + 0.5} y2={PLOT_BOTTOM + 4} strokeWidth={1} />
									<text x={px(v)} y={PLOT_BOTTOM + 19} textAnchor="middle" stroke="none" className="font-ui">
										{formatNumber(v)}
									</text>
								</g>
							))}
							{ticks(plot.y.min, plot.y.max).map((v) => (
								<g key={`y${v}`}>
									<line x1={GUTTER - 4} y1={Math.round(py(v)) + 0.5} x2={GUTTER} y2={Math.round(py(v)) + 0.5} strokeWidth={1} />
									<text x={GUTTER - 8} y={py(v)} dy="0.35em" textAnchor="end" stroke="none" className="font-ui">
										{formatNumber(v)}
									</text>
								</g>
							))}
						</g>
						<g className="text-ink" clipPath={`url(#${clip})`}>
							{lines(false)}
						</g>
					</svg>
					{open && plot.lines.some((l) => l.hidden) && (
						<svg aria-hidden width={width} height={AXIS_HEIGHT} className={cn("pointer-events-none absolute top-0 left-0", drawIn)}>
							<g className="text-ink" clipPath={`url(#${clip})`}>
								{lines(true)}
							</g>
						</svg>
					)}
					<div className="absolute text-center font-ui text-[13px] leading-[17px] text-ink-2" style={{ top: X_TITLE_TOP, left: GUTTER, right: 0 }}>
						<Label text={plot.x.label} />
					</div>
					{open && <SliderRow plot={plot} value={slider} onChange={setSlider} width={width} className={drawIn} />}
					<p className="sr-only" aria-live="polite">
						{live}
					</p>
				</div>
				<div className="relative">
					{plot.lines.map((l, i) =>
						shown[i] ? (
							<div key={i} data-testid="plot-key" className={cn("absolute right-0 left-0", l.hidden && drawIn)} style={{ top: tops.get(i) }}>
								<div className="flex items-center gap-1.5 font-ui text-[13px] leading-[16px] text-ink-2">
									<svg aria-hidden width={16} height={2} className="shrink-0 text-ink">
										<line x1={0} y1={1} x2={16} y2={1} stroke="currentColor" strokeWidth={2} strokeDasharray={l.dashed ? "4 2" : undefined} />
									</svg>
									<span className="min-w-0 truncate">
										<Label text={l.label} />
									</span>
								</div>
								<div data-testid="plot-formula" className="-mr-5 -mb-1 overflow-x-auto overflow-y-hidden pt-0.5 pb-1 pl-[22px] text-[13px] whitespace-nowrap text-ink-2">
									<Tex tex={l.latex} />
								</div>
							</div>
						) : null,
					)}
				</div>
			</div>
		</PlotBox>
	);
}

/** The slider under the plot: its name, a 2px track as wide as the plot
 *  area, round ticks with the two ends, a square thumb. No readout: the
 *  lines are the readout. */
function SliderRow({ plot, value, onChange, width, className }: { plot: Plot; value: number; onChange: (v: number) => void; width: number; className?: string }) {
	const { min, max } = plot.slider;
	const trackWidth = Math.max(1, width - GUTTER);
	const at = scale(min, max, GUTTER, GUTTER + trackWidth);
	const thumb = 14;
	return (
		<div className={cn("pointer-events-none absolute top-0 left-0", className)} style={{ width, height: OPEN_HEIGHT }}>
			<div aria-hidden className="absolute text-right text-[17px] leading-none whitespace-nowrap text-ink" style={{ top: TRACK_Y - 8, left: 0, width: GUTTER - 8 }}>
				<Tex tex={plot.slider.latex} />
			</div>
			<div aria-hidden className="absolute h-0.5 bg-ink" style={{ top: TRACK_Y - 1, left: GUTTER, width: trackWidth }} />
			<svg aria-hidden width={width} height={OPEN_HEIGHT} className="pointer-events-none absolute top-0 left-0 overflow-visible text-ink-2" fontSize={13}>
				{sliderTicks(min, max, trackWidth).map((v) => (
					<g key={v}>
						<line x1={Math.round(at(v)) + 0.5} y1={TRACK_Y + 1} x2={Math.round(at(v)) + 0.5} y2={TRACK_Y + 5} stroke="currentColor" strokeWidth={1} />
						<text x={at(v)} y={TRACK_Y + 20} textAnchor="middle" fill="currentColor" className="font-ui">
							{formatNumber(v)}
						</text>
					</g>
				))}
			</svg>
			{/* The input reaches half a thumb past each end, so the thumb's
			    centre travels exactly along the drawn track. */}
			<input
				type="range"
				data-testid="plot-slider"
				min={min}
				max={max}
				step="any"
				value={value}
				aria-label={plot.slider.name}
				aria-valuetext={sliderText(plot, value)}
				onChange={(e) => onChange(Number(e.target.value))}
				className="pointer-events-auto absolute h-6 cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-6 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[5px] [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-ink"
				style={{ top: TRACK_Y - 12, left: GUTTER - thumb / 2, width: trackWidth + thumb }}
			/>
		</div>
	);
}
