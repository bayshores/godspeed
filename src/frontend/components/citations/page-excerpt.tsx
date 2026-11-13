import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { HighlightOptions, HighlightResult } from "@streamdown/code";
import { lazyCodePlugin } from "@/frontend/components/lazy-code-plugin";
import { codeLanguage, codeRows, linesLabel, markRuns, pageBand, pageLabel, passageQuote, type CitedPassage, type FileCite } from "./page-excerpt-model";
import { useCited } from "./use-cited";

type Marks = NonNullable<CitedPassage["marks"]>;
type CodeMarks = Extract<Marks, { kind: "lines" }>;

// The frame is 220 tall with a 1px outline; the page fills its inside.
const FRAME_H = 220;
const INSIDE_H = FRAME_H - 2;
const MARK = "bg-highlight text-inherit";

/** A topic's page under the paragraph that quotes it: his PDF page with the
 *  words on the highlighter, his code lines with the expression marked, or
 *  the passage as a quote block. Clicking it opens the page dialog. Nothing
 *  shows while it loads, when the place is gone, or when the picture fails. */
export function PageExcerpt({ cite, onOpen }: { cite: FileCite; onOpen: () => void }) {
	const found = useCited(cite);
	if (found === null || found === "gone") return null;
	const marks = found.marks ?? null;
	if (found.page !== null) return <PdfExcerpt cite={cite} page={found.page} boxes={marks?.kind === "page" ? marks.boxes : []} onOpen={onOpen} />;
	if (marks?.kind === "lines")
		return (
			<button type="button" data-testid="page-excerpt" aria-label={linesLabel(cite.name, marks)} onClick={onOpen} className="block w-full text-left">
				<CodeLines name={cite.name} marks={marks} />
			</button>
		);
	if (marks?.kind === "passage") {
		const quote = passageQuote(found.text, marks.start, marks.end);
		return (
			<button
				type="button"
				data-testid="page-excerpt"
				onClick={onOpen}
				className="block w-full border-l-2 border-tone-2 pl-4 text-left font-prose text-[length:var(--lh-prose-size)] leading-[var(--lh-prose-leading)] whitespace-pre-wrap text-ink-2"
			>
				{quote.before}
				<mark className={MARK}>{quote.marked}</mark>
				{quote.after}
			</button>
		);
	}
	return null;
}

function PdfExcerpt({ cite, page, boxes, onOpen }: { cite: FileCite; page: number; boxes: readonly PageMarkBox[]; onOpen: () => void }) {
	const [size, setSize] = useState<{ w: number; h: number } | null>(null);
	const [broken, setBroken] = useState(false);
	if (broken) return null;
	const band = pageBand(size, boxes);
	return (
		<button
			type="button"
			data-testid="page-excerpt"
			onClick={onOpen}
			className="relative block max-w-full overflow-hidden border border-border"
			style={{ height: FRAME_H, width: band.landscape ? INSIDE_H * band.aspect + 2 : "100%" }}
		>
			{/* The page is drawn onto the pane's paper; the transform makes the span the blended group. */}
			<span className="absolute inset-x-0 top-0 block mix-blend-multiply dark:mix-blend-normal" style={{ transform: `translateY(calc(${-band.at} * (100% - ${INSIDE_H}px)))` }}>
				<img
					src={`/api/cited/${cite.fileId}/page/${page}`}
					alt={pageLabel(cite.name, page, cite.quote, boxes.length > 0)}
					onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
					onError={() => setBroken(true)}
					className="block w-full"
				/>
				<PageMarks boxes={boxes} />
			</span>
		</button>
	);
}

type PageMarkBox = Extract<Marks, { kind: "page" }>["boxes"][number];

const pct = (n: number) => `${n * 100}%`;

/** The quoted words on the highlighter, over a page image that fills its
 *  parent (which is positioned). */
export function PageMarks({ boxes }: { boxes: readonly PageMarkBox[] }) {
	return boxes.map((b, i) => (
		<span
			key={i}
			data-testid="page-mark"
			className="absolute bg-highlight/55 mix-blend-multiply"
			style={{ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) }}
		/>
	));
}

const THEMES = lazyCodePlugin.getThemes();

/** The code's coloured tokens per line, once the highlighter has loaded. */
function useCodeTokens(code: string, language: string): HighlightResult["tokens"] | null {
	const [got, setGot] = useState<{ code: string; tokens: HighlightResult["tokens"] } | null>(null);
	useEffect(() => {
		let live = true;
		const take = (result: HighlightResult) => {
			if (live) setGot({ code, tokens: result.tokens });
		};
		const ready = lazyCodePlugin.highlight({ code, language: language as HighlightOptions["language"], themes: THEMES }, take);
		if (ready) take(ready);
		return () => {
			live = false;
		};
	}, [code, language]);
	return got && got.code === code ? got.tokens : null;
}

/** Code lines read from his file, numbered as in the file, coloured like a
 *  code block, the quoted expression on the highlighter. */
export function CodeLines({ name, marks }: { name: string; marks: CodeMarks }) {
	const rows = useMemo(() => codeRows(marks), [marks]);
	const tokens = useCodeTokens(rows.map((r) => r.text).join("\n"), codeLanguage(name));
	return (
		<span data-streamdown="code-block" className="block">
			<span data-streamdown="code-block-body" className="block overflow-x-auto font-mono text-sm">
				{rows.map((row, i) => (
					<span key={row.n} data-testid="code-line" className="block whitespace-pre">
						<span className="mr-4 inline-block w-6 text-right text-ink-3 select-none">{row.n}</span>
						{markRuns(lineRuns(tokens?.[i], row.text), row.marks).map((stretch, k) => {
							const pieces = stretch.pieces.map((piece, j) => <Token key={j} run={piece.run} text={piece.text} />);
							return stretch.marked ? (
								<mark key={k} className={MARK}>
									{pieces}
								</mark>
							) : (
								<span key={k}>{pieces}</span>
							);
						})}
					</span>
				))}
			</span>
		</span>
	);
}

type Run = { content: string; color?: string; htmlStyle?: Record<string, string> };

/** A line's coloured tokens, or the line as one plain run before they load. */
const lineRuns = (tokens: readonly Run[] | undefined, text: string): readonly Run[] => tokens ?? [{ content: text }];

/** A coloured token, as the shipped code block colours it. */
function Token({ run, text }: { run: Run; text: string }) {
	const style = tokenStyle(run);
	if (!style) return text;
	return (
		<span className="text-[var(--sdm-c,inherit)] dark:text-[var(--shiki-dark,var(--sdm-c,inherit))]" style={style}>
			{text}
		</span>
	);
}

function tokenStyle(run: Run): CSSProperties | undefined {
	const style: Record<string, string> = {};
	if (run.color) style["--sdm-c"] = run.color;
	for (const [key, value] of Object.entries(run.htmlStyle ?? {})) style[key === "color" ? "--sdm-c" : key] = value;
	return Object.keys(style).length > 0 ? (style as CSSProperties) : undefined;
}
