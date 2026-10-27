import { memo, useMemo } from "react";
import katex from "katex";

/**
 * One line of question text with its math as real LaTeX (KaTeX), for the
 * Overview's compact rows. `$…$` and `\(…\)` spans render through KaTeX;
 * `**bold**` and `code` markers are dropped (a row is one plain line).
 */

type Piece = { math: false; text: string } | { math: true; tex: string };

const MATH = /\$([^$\n]+?)\$|\\\((.+?)\\\)/g;

/** Splits text into plain and math pieces (pure, for tests). */
export function splitInlineMath(text: string): Piece[] {
	const plain = (s: string) => s.replace(/\*\*|__|`/g, "");
	const out: Piece[] = [];
	let last = 0;
	for (const m of text.matchAll(MATH)) {
		if (m.index > last) out.push({ math: false, text: plain(text.slice(last, m.index)) });
		out.push({ math: true, tex: m[1] ?? m[2] ?? "" });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ math: false, text: plain(text.slice(last)) });
	return out;
}

export const InlineMath = memo(function InlineMath({ text }: { text: string }) {
	const pieces = useMemo(() => splitInlineMath(text), [text]);
	return (
		<>
			{pieces.map((p, i) =>
				p.math ? (
					<span
						key={i}
						// KaTeX output from the learner's own lesson text (throwOnError off).
						dangerouslySetInnerHTML={{ __html: katex.renderToString(p.tex, { throwOnError: false, output: "html" }) }}
					/>
				) : (
					<span key={i}>{p.text}</span>
				),
			)}
		</>
	);
});
