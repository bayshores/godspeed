/**
 * The rules behind the writing boxes' math: where the math is in a text
 * ($...$ LaTeX), what a finished piece like 1/2 or x^2 turns into, the
 * typed symbol swaps (>= → ≥), and the word suggestions (sqrt → √□).
 * The text stays a plain string: the teacher reads the LaTeX as written.
 */

/** A $...$ piece of a text: from/to include the dollar signs. */
interface MathSpan {
	from: number;
	to: number;
	latex: string;
}

/** A text replacement: [from, to) becomes insert. */
interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

/** The $...$ pieces, left to right. A piece stays on one line, never starts
 *  or ends with a space, and its closing $ isn't followed by a digit, so
 *  prices like "$5 or $6" stay text. \$ is a literal dollar. */
export function mathSpans(text: string): MathSpan[] {
	const spans: MathSpan[] = [];
	let open = -1;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\n") open = -1;
		if (ch !== "$" || text[i - 1] === "\\") continue;
		if (open === -1) {
			if (text[i + 1] !== undefined && !/\s|\$/.test(text[i + 1]!)) open = i;
			continue;
		}
		const latex = text.slice(open + 1, i);
		if (/\s$/.test(latex) || /\d/.test(text[i + 1] ?? "")) {
			open = text[i + 1] !== undefined && !/\s|\$/.test(text[i + 1]!) ? i : -1;
			continue;
		}
		spans.push({ from: open, to: i + 1, latex });
		open = -1;
	}
	return spans;
}

function insideMath(text: string, from: number, to: number): boolean {
	return mathSpans(text).some((s) => s.from < to && s.to > from);
}

/** Typing one of these after a finished piece formats it. */
export function isMathBreak(ch: string): boolean {
	return /^[ ,.;:?]$/.test(ch);
}

/** A number, one letter, or a balanced (group). */
const ATOM = String.raw`(\d+(?:\.\d+)?|[A-Za-z]|\((?:[^()]|\([^()]*\))+\))`;
const FRACTION = new RegExp(`^${ATOM}/${ATOM}$`);
const SCRIPTS = new RegExp(`^${ATOM}(?:_${ATOM})?(?:\\^${ATOM})?$`);

/** A group's inside (the parentheses only grouped it). */
function unwrap(atom: string): string {
	return atom.startsWith("(") ? atom.slice(1, -1) : atom;
}

/** What a finished piece becomes: 1/2 → $\frac{1}{2}$, x^2 → $x^{2}$,
 *  x_1 → $x_{1}$. Null when the piece isn't math. */
export function formatPiece(piece: string): string | null {
	const frac = FRACTION.exec(piece);
	if (frac) return `$\\frac{${unwrap(frac[1]!)}}{${unwrap(frac[2]!)}}$`;
	const scripts = SCRIPTS.exec(piece);
	if (scripts && (scripts[2] || scripts[3])) {
		const sub = scripts[2] ? `_{${unwrap(scripts[2])}}` : "";
		const sup = scripts[3] ? `^{${unwrap(scripts[3])}}` : "";
		return `$${scripts[1]}${sub}${sup}$`;
	}
	return null;
}

/** The edit that formats the piece just before pos (a break was typed
 *  there). Null when there's nothing to format. */
export function formatBeforeBreak(text: string, pos: number): TextEdit | null {
	let from = pos;
	while (from > 0 && !/\s/.test(text[from - 1]!)) from--;
	if (from === pos || insideMath(text, from, pos)) return null;
	const insert = formatPiece(text.slice(from, pos));
	return insert === null ? null : { from, to: pos, insert };
}

const SYMBOLS: Record<string, string> = { ">": "≥", "<": "≤", "!": "≠" };

/** Typing "=" right after >, < or ! swaps the pair for ≥, ≤ or ≠. */
export function symbolSwap(text: string, pos: number, typed: string): TextEdit | null {
	if (typed !== "=" || pos === 0) return null;
	const symbol = SYMBOLS[text[pos - 1]!];
	if (symbol === undefined || insideMath(text, pos - 1, pos)) return null;
	return { from: pos - 1, to: pos, insert: symbol };
}

/** A word that suggests a piece of math. latex may hold \placeholder{}
 *  slots for the learner to fill. */
interface MathWord {
	word: string;
	aliases: readonly string[];
	/** How it looks in the list (□ marks a slot). */
	shown: string;
	name: string;
	latex: string;
}

const SLOT = String.raw`\placeholder{}`;

const MATH_WORDS: readonly MathWord[] = [
	{ word: "sqrt", aliases: ["square"], shown: "√□", name: "square root", latex: String.raw`\sqrt{${SLOT}}` },
	{ word: "root", aliases: ["sqrt", "nthroot"], shown: "ⁿ√□", name: "nth root", latex: String.raw`\sqrt[${SLOT}]{${SLOT}}` },
	{ word: "choose", aliases: ["binom"], shown: "(ⁿₖ)", name: "choose", latex: String.raw`\binom{${SLOT}}{${SLOT}}` },
	{ word: "pi", aliases: [], shown: "π", name: "pi", latex: String.raw`\pi` },
	{ word: "sum", aliases: [], shown: "Σ", name: "sum", latex: String.raw`\sum_{${SLOT}}^{${SLOT}}` },
	{ word: "integral", aliases: ["int"], shown: "∫", name: "integral", latex: String.raw`\int_{${SLOT}}^{${SLOT}}` },
	{ word: "infinity", aliases: ["inf"], shown: "∞", name: "infinity", latex: String.raw`\infty` },
	{ word: "limit", aliases: ["lim"], shown: "lim", name: "limit", latex: String.raw`\lim_{${SLOT}}` },
	{ word: "log", aliases: [], shown: "log", name: "log", latex: String.raw`\log` },
	{ word: "theta", aliases: [], shown: "θ", name: "theta", latex: String.raw`\theta` },
	{ word: "alpha", aliases: [], shown: "α", name: "alpha", latex: String.raw`\alpha` },
	{ word: "beta", aliases: [], shown: "β", name: "beta", latex: String.raw`\beta` },
	{ word: "delta", aliases: [], shown: "δ", name: "delta", latex: String.raw`\delta` },
	{ word: "lambda", aliases: [], shown: "λ", name: "lambda", latex: String.raw`\lambda` },
	{ word: "sigma", aliases: [], shown: "σ", name: "sigma", latex: String.raw`\sigma` },
];

/** The words a typed word suggests. A short start ("the") suggests
 *  nothing, so everyday words don't pop a list; a whole word or alias
 *  ("pi", "inf") or four letters ("thet") do. */
export function suggestMath(typed: string): MathWord[] {
	const w = typed.toLowerCase();
	if (w.length < 2) return [];
	return MATH_WORDS.filter((m) =>
		[m.word, ...m.aliases].some((name) => name === w || (w.length >= 4 && name.startsWith(w))),
	);
}

/** Whether a piece of LaTeX still has slots to fill. */
export function hasSlots(latex: string): boolean {
	return latex.includes(SLOT);
}
