/**
 * The writing boxes' calculator: the calculation just typed (an
 * expression ending in "=", or "solve" and an equation), letters given a
 * value on the lines above, plain typing turned into the LaTeX the math
 * engine reads, and what keeping an answer adds to the text. Pure: the
 * engine runs in a worker (src/frontend/lib/calculate.ts).
 */
import { mathSpans } from "./math-typing.ts";

/** A letter given a value on a line above ("x = 3"). */
interface CalcDefinition {
	name: string;
	latex: string;
}

/** A calculation to work out. */
export interface Calculation {
	/** value: an expression ending in "="; solve: an equation to solve. */
	kind: "value" | "solve";
	/** The expression, or the equation, as LaTeX. */
	latex: string;
	/** The letter to solve for, when the line names it ("for x"). */
	variable: string | null;
	/** Values given on the lines above, in order. */
	defs: CalcDefinition[];
	/** Where a kept answer goes. */
	at: number;
	/** The "=" is inside a $...$ piece, so the answer joins that piece. */
	inPiece: boolean;
}

/** A worked-out answer. */
export interface CalcAnswer {
	/** As LaTeX: shown in grey, and kept as math. */
	latex: string;
	/** A plain number ("42"), kept as text outside math. */
	plain: string | null;
}

type Token =
	| { t: "num"; v: string }
	| { t: "word"; v: string }
	| { t: "op"; v: string }
	| { t: "space" }
	| { t: "math"; latex: string }
	| { t: "other" };

const FUNCTIONS: Record<string, string> = {
	sin: "\\sin",
	cos: "\\cos",
	tan: "\\tan",
	sec: "\\sec",
	csc: "\\csc",
	cot: "\\cot",
	arcsin: "\\arcsin",
	arccos: "\\arccos",
	arctan: "\\arctan",
	asin: "\\arcsin",
	acos: "\\arccos",
	atan: "\\arctan",
	sinh: "\\sinh",
	cosh: "\\cosh",
	tanh: "\\tanh",
	ln: "\\ln",
	log: "\\log",
	exp: "\\exp",
};

const CONSTANTS: Record<string, string> = { pi: "\\pi", inf: "\\infty", infinity: "\\infty" };

/** Words that wrap their argument, or start an integral. */
const SPECIAL = new Set(["sqrt", "abs", "int"]);

const OPS = "+-−*×·⋅/÷^_()|!%°²³√π∞=";

/** A number, with an optional exponent (1e3, 2.5E-4). */
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+(?![A-Za-z]))?/;

function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i]!;
		const num = NUMBER.exec(text.slice(i));
		if (num) {
			tokens.push({ t: "num", v: num[0] });
			i += num[0].length;
		} else if (/[A-Za-z]/.test(ch)) {
			const word = /^[A-Za-z]+/.exec(text.slice(i))![0];
			tokens.push({ t: "word", v: word });
			i += word.length;
		} else if (/\s/.test(ch)) {
			if (tokens.at(-1)?.t !== "space") tokens.push({ t: "space" });
			i++;
		} else {
			tokens.push(OPS.includes(ch) ? { t: "op", v: ch } : { t: "other" });
			i++;
		}
	}
	return tokens;
}

/** A line's tokens: its text tokenized, each $...$ piece one math token. */
function lineTokens(line: string): Token[] {
	const tokens: Token[] = [];
	let last = 0;
	for (const s of mathSpans(line)) {
		tokens.push(...tokenize(line.slice(last, s.from)), { t: "math", latex: s.latex });
		last = s.to;
	}
	tokens.push(...tokenize(line.slice(last)));
	return tokens;
}

/** A word that can be part of a calculation. "do" in "how do" isn't, but
 *  a d+letter word may close an integral ("int x dx"). */
function mathWord(word: string): boolean {
	return word.length === 1 || word in FUNCTIONS || word in CONSTANTS || SPECIAL.has(word) || /^d[A-Za-z]$/.test(word);
}

function isCalcToken(tok: Token): boolean {
	if (tok.t === "other") return false;
	if (tok.t === "op") return tok.v !== "=";
	if (tok.t === "word") return mathWord(tok.v);
	if (tok.t === "math") return !tok.latex.includes("=");
	return true;
}

/** Turns plain typing into LaTeX: 2^10 → 2^{10}, sqrt(2) → \sqrt{2},
 *  sin(30°) → \sin(30^{\circ}), d/dx → \frac{d}{dx}, int x dx → \int x\,dx.
 *  Null when it isn't a calculation (an unknown word, unbalanced brackets). */
export function plainToLatex(text: string): string | null {
	return convert(tokenize(text), true);
}

function convert(tokens: Token[], allowEquals: boolean): string | null {
	const out: string[] = [];
	let depth = 0;
	let bars = 0;
	let integral = false;
	let i = 0;
	const skipSpaces = () => {
		while (tokens[i]?.t === "space") i++;
	};
	/** The group starting at "(", converted, without its brackets. */
	const group = (): string | null => {
		let level = 0;
		for (let j = i; j < tokens.length; j++) {
			const tok = tokens[j]!;
			if (tok.t === "op" && tok.v === "(") level++;
			if (tok.t === "op" && tok.v === ")" && --level === 0) {
				const inner = convert(tokens.slice(i + 1, j), false);
				i = j + 1;
				return inner;
			}
		}
		return null;
	};
	/** One argument: a (group) or a single number, letter, constant or piece. */
	const argument = (): string | null => {
		skipSpaces();
		const tok = tokens[i];
		if (!tok) return null;
		if (tok.t === "op" && tok.v === "(") return group();
		if (tok.t === "op" && (tok.v === "-" || tok.v === "−" || tok.v === "+")) {
			i++;
			const rest = argument();
			return rest === null ? null : `${tok.v === "+" ? "" : "-"}${rest}`;
		}
		i++;
		if (tok.t === "num") return numberLatex(tok.v);
		if (tok.t === "math") return tok.latex;
		if (tok.t === "op" && tok.v === "π") return "\\pi";
		if (tok.t === "word" && tok.v in CONSTANTS) return CONSTANTS[tok.v]!;
		if (tok.t === "word" && tok.v.length === 1) return tok.v;
		return null;
	};
	while (i < tokens.length) {
		const tok = tokens[i]!;
		if (tok.t === "other") return null;
		if (tok.t === "space") {
			out.push(" ");
			i++;
			continue;
		}
		if (tok.t === "num") {
			out.push(numberLatex(tok.v));
			i++;
			continue;
		}
		if (tok.t === "math") {
			out.push(`{${tok.latex}}`);
			i++;
			continue;
		}
		if (tok.t === "word") {
			const w = tok.v;
			const next = tokens[i + 1];
			const after = tokens[i + 2];
			if (w === "d" && next?.t === "op" && next.v === "/" && after?.t === "word" && /^d[A-Za-z]$/.test(after.v)) {
				out.push(`\\frac{d}{${after.v}}`);
				i += 3;
				continue;
			}
			i++;
			if (w in FUNCTIONS) out.push(`${FUNCTIONS[w]} `);
			else if (w in CONSTANTS) out.push(`${CONSTANTS[w]} `);
			else if (w === "sqrt") {
				const arg = argument();
				if (arg === null) return null;
				out.push(`\\sqrt{${arg}}`);
			} else if (w === "abs") {
				skipSpaces();
				if (tokens[i]?.t !== "op" || (tokens[i] as { v: string }).v !== "(") return null;
				const inner = group();
				if (inner === null) return null;
				out.push(`\\left|${inner}\\right|`);
			} else if (w === "int") {
				integral = true;
				// Limits: int_0^1.
				if (tokens[i]?.t === "op" && (tokens[i] as { v: string }).v === "_") {
					i++;
					const lower = argument();
					if (lower === null || tokens[i]?.t !== "op" || (tokens[i] as { v: string }).v !== "^") return null;
					i++;
					const upper = argument();
					if (upper === null) return null;
					out.push(`\\int_{${lower}}^{${upper}} `);
				} else out.push("\\int ");
			} else if (integral && /^d[A-Za-z]$/.test(w)) out.push(`\\,${w}`);
			else if (w.length === 1) out.push(w);
			else return null;
			continue;
		}
		// An operator.
		i++;
		switch (tok.v) {
			case "+":
			case "-":
			case "!":
				out.push(tok.v);
				break;
			case "−":
				out.push("-");
				break;
			case "*":
			case "×":
			case "·":
			case "⋅":
				out.push("\\cdot ");
				break;
			case "/":
			case "÷":
				out.push("/");
				break;
			case "(":
				depth++;
				out.push("(");
				break;
			case ")":
				if (--depth < 0) return null;
				out.push(")");
				break;
			case "|":
				bars++;
				out.push("|");
				break;
			case "%":
				out.push("\\%");
				break;
			case "°":
				out.push("^{\\circ}");
				break;
			case "²":
				out.push("^{2}");
				break;
			case "³":
				out.push("^{3}");
				break;
			case "π":
				out.push("\\pi ");
				break;
			case "∞":
				out.push("\\infty ");
				break;
			case "√": {
				const arg = argument();
				if (arg === null) return null;
				out.push(`\\sqrt{${arg}}`);
				break;
			}
			case "^": {
				const arg = argument();
				if (arg === null) return null;
				out.push(`^{${arg}}`);
				break;
			}
			case "=":
				if (!allowEquals) return null;
				out.push("=");
				break;
			default:
				return null;
		}
	}
	const latex = out.join("").trim();
	return depth === 0 && bars % 2 === 0 && latex ? latex : null;
}

function numberLatex(v: string): string {
	const sci = /^(.*?)[eE]([+-]?\d+)$/.exec(v);
	return sci ? `${sci[1]}\\times10^{${sci[2]}}` : v;
}

/** A token a calculation can't start with. */
function badStart(tok: Token): boolean {
	return tok.t === "space" || (tok.t === "op" && "*×·⋅/÷^)!%°²³".includes(tok.v));
}

function lineAt(text: string, pos: number): { start: number; end: number } {
	const start = text.lastIndexOf("\n", pos - 1) + 1;
	const next = text.indexOf("\n", pos);
	return { start, end: next === -1 ? text.length : next };
}

/** Letters given a value on whole lines ("x = 3", "$r = \frac{1}{2}$"),
 *  in order. e and i stay the constants. */
function definitions(text: string): CalcDefinition[] {
	const defs: CalcDefinition[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		const piece = /^\$([A-Za-z])\s*=\s*([^=]+)\$$/.exec(trimmed);
		const plain = piece ? null : /^([A-Za-z])\s*=\s*([^=]+)$/.exec(trimmed);
		const name = piece?.[1] ?? plain?.[1];
		if (!name || name === "e" || name === "i") continue;
		const latex = piece ? piece[2]!.trim() : convert(lineTokens(plain![2]!), false);
		if (latex) defs.push({ name, latex });
	}
	return defs;
}

/** The calculation at the caret: the caret ends its line, and the line
 *  ends in "=" after something to work out, or reads "solve <equation>". */
export function findCalculation(text: string, caret: number): Calculation | null {
	const { start, end } = lineAt(text, caret);
	if (text.slice(caret, end).trim() !== "") return null;
	const line = text.slice(start, caret);
	const defs = definitions(text.slice(0, start));
	return solveAt(line, caret, defs) ?? valueAt(line, caret, defs);
}

function valueAt(line: string, caret: number, defs: CalcDefinition[]): Calculation | null {
	const trimmed = line.trimEnd();
	// "$3+4=$": the answer joins the piece.
	const last = mathSpans(line).at(-1);
	if (last && last.to === trimmed.length && /=\s*$/.test(last.latex)) {
		const latex = last.latex.replace(/=\s*$/, "").split("=").at(-1)!.trim();
		if (!latex) return null;
		return { kind: "value", latex, variable: null, defs, at: caret - line.length + last.to - 1, inPiece: true };
	}
	// "<=", "!=" and "==" aren't a calculation; "5! =" is.
	if (!trimmed.endsWith("=") || /[<>!=]$/.test(trimmed.slice(0, -1))) return null;
	const tokens = lineTokens(trimmed.slice(0, -1));
	// The run of calculation tokens before the "=", then the longest tail of
	// it that reads as one ("how do 2+2 =" → 2+2).
	let from = tokens.length;
	while (from > 0 && isCalcToken(tokens[from - 1]!)) from--;
	for (let s = from; s < tokens.length; s++) {
		const tok = tokens[s]!;
		if (badStart(tok)) continue;
		const latex = convert(tokens.slice(s), false);
		if (latex) return { kind: "value", latex, variable: null, defs, at: caret, inPiece: false };
		// Past an opening bracket the rest means something else ("(1+2 =").
		if (tok.t === "op" && (tok.v === "(" || tok.v === "|")) return null;
	}
	return null;
}

function solveAt(line: string, caret: number, defs: CalcDefinition[]): Calculation | null {
	const tokens = lineTokens(line.trimEnd());
	const at = tokens.findIndex((tok) => tok.t === "word" && tok.v.toLowerCase() === "solve");
	if (at === -1) return null;
	let rest = tokens.slice(at + 1);
	let variable: string | null = null;
	const n = rest.length;
	if (n >= 4 && rest[n - 1]!.t === "word" && rest[n - 2]!.t === "space" && rest[n - 3]!.t === "word" && (rest[n - 3] as { v: string }).v === "for") {
		const v = (rest[n - 1] as { v: string }).v;
		if (v.length !== 1) return null;
		variable = v;
		rest = rest.slice(0, n - 3);
	}
	const equals = rest.reduce((count, tok) => count + (tok.t === "op" && tok.v === "=" ? 1 : tok.t === "math" ? (tok.latex.match(/=/g)?.length ?? 0) : 0), 0);
	const lastTok = rest.filter((tok) => tok.t !== "space").at(-1);
	if (equals !== 1 || !lastTok || (lastTok.t === "op" && lastTok.v === "=")) return null;
	const latex = convert(rest, true);
	if (!latex || /^=|=$/.test(latex)) return null;
	return { kind: "solve", latex, variable, defs, at: caret, inPiece: false };
}

/** The calculation in a math piece being edited: its LaTeX ends in "="
 *  (the answer goes into the piece). pieceFrom places it in the text, for
 *  the values set on the lines above. */
export function pieceCalculation(text: string, pieceFrom: number, latex: string): Calculation | null {
	if (!/=\s*$/.test(latex)) return null;
	const body = latex.replace(/=\s*$/, "").split("=").at(-1)!.trim();
	if (!body) return null;
	const defs = definitions(text.slice(0, lineAt(text, pieceFrom).start));
	return { kind: "value", latex: body, variable: null, defs, at: pieceFrom, inPiece: true };
}

/** The text a kept answer adds: inside the piece, or after the "=" (a
 *  plain number as text, anything else as a math piece). */
export function answerEdit(text: string, calc: Calculation, answer: CalcAnswer): { from: number; insert: string } {
	if (calc.inPiece) return { from: calc.at, insert: answer.latex };
	const space = /\S/.test(text[calc.at - 1] ?? "") ? " " : "";
	if (calc.kind === "solve") return { from: calc.at, insert: `${space}→ $${answer.latex}$` };
	return { from: calc.at, insert: space + (answer.plain ?? `$${answer.latex}$`) };
}
