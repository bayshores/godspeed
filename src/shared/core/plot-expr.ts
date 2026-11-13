/**
 * Plot formulas: the one plain-math grammar a teacher writes plot lines in.
 * Numbers, the x and slider names, pi, e, + - * / ^, brackets, sin cos tan exp
 * ln log10 sqrt abs (one argument), min max (two). No implicit multiplication.
 * Nothing the agent writes ever runs as code: names are looked up in fixed
 * maps (so toString or __proto__ are plain unknown names), and length and
 * nesting are capped. The server keeps a Rust copy
 * (crates/core/src/session/plot_expr.rs); both replay
 * crates/core/tests/golden/plot_expr.json. Pure and browser-safe.
 */

const MAX_LENGTH = 200;
const MAX_DEPTH = 32;

type Operator = "+" | "-" | "*" | "/" | "^";

/** A parsed formula. `group` keeps the brackets the agent wrote, for the
 *  typeset form. */
type Expr =
	| { kind: "num"; value: number; text: string }
	| { kind: "name"; name: string }
	| { kind: "neg"; arg: Expr }
	| { kind: "group"; arg: Expr }
	| { kind: "op"; op: Operator; left: Expr; right: Expr }
	| { kind: "call"; fn: string; args: Expr[] };

interface PlotFunction {
	arity: 1 | 2;
	run: (a: number, b: number) => number;
	latex: string;
}

const FUNCTIONS: ReadonlyMap<string, PlotFunction> = new Map<string, PlotFunction>([
	["sin", { arity: 1, run: Math.sin, latex: "\\sin" }],
	["cos", { arity: 1, run: Math.cos, latex: "\\cos" }],
	["tan", { arity: 1, run: Math.tan, latex: "\\tan" }],
	["exp", { arity: 1, run: Math.exp, latex: "\\exp" }],
	["ln", { arity: 1, run: Math.log, latex: "\\ln" }],
	["log10", { arity: 1, run: Math.log10, latex: "\\log_{10}" }],
	["sqrt", { arity: 1, run: Math.sqrt, latex: "\\sqrt" }],
	["abs", { arity: 1, run: Math.abs, latex: "" }],
	["min", { arity: 2, run: Math.min, latex: "\\min" }],
	["max", { arity: 2, run: Math.max, latex: "\\max" }],
]);

const CONSTANTS: ReadonlyMap<string, number> = new Map([
	["pi", Math.PI],
	["e", Math.E],
]);

interface Token {
	kind: "num" | "name" | "op";
	text: string;
}

const OPERATORS = new Set(["+", "-", "*", "/", "^", "(", ")", ","]);

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
const isNameStart = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isNamePart = (c: string | undefined): boolean => c !== undefined && (isNameStart(c) || isDigit(c));

/** The formula's tokens, or the error for a character the grammar has no
 *  use for. */
function lex(src: string): Token[] | string {
	const chars = Array.from(src);
	const out: Token[] = [];
	let i = 0;
	while (i < chars.length) {
		const c = chars[i] ?? "";
		if (c === " " || c === "\t" || c === "\n" || c === "\r") {
			i++;
			continue;
		}
		let j = i;
		if (isDigit(c) || (c === "." && isDigit(chars[i + 1]))) {
			while (isDigit(chars[j])) j++;
			if (chars[j] === "." && isDigit(chars[j + 1])) {
				j++;
				while (isDigit(chars[j])) j++;
			}
			out.push({ kind: "num", text: chars.slice(i, j).join("") });
		} else if (isNameStart(c)) {
			while (isNamePart(chars[j])) j++;
			out.push({ kind: "name", text: chars.slice(i, j).join("") });
		} else if (OPERATORS.has(c)) {
			j++;
			out.push({ kind: "op", text: c });
		} else {
			return `"${c}" is not allowed. Use numbers, names, + - * / ^ and brackets.`;
		}
		i = j;
	}
	return out;
}

class ExprError extends Error {}

/** Parses one formula whose variables are `names` (the x name, then the
 *  slider's). The error is one line without its path, like
 *  `unknown name "lamda". Use only a, lambda, pi, e.` */
export function parseExpr(src: string, names: readonly string[]): { expr: Expr } | { error: string } {
	if (src.length > MAX_LENGTH) return { error: `longer than ${MAX_LENGTH} characters.` };
	const lexed = lex(src);
	if (typeof lexed === "string") return { error: lexed };
	const tokens: Token[] = lexed;
	if (tokens.length === 0) return { error: "is empty. Write the line's formula." };
	let pos = 0;
	const fail = (message: string): never => {
		throw new ExprError(message);
	};
	const isOp = (t: Token | undefined, ...ops: string[]): t is Token => t?.kind === "op" && ops.includes(t.text);
	const unexpected = ({ text }: Token): string => (text === ")" || text === "," ? `unexpected "${text}". Check the brackets.` : `unexpected "${text}". Put a number or name before it.`);
	const deep = (depth: number): void => {
		if (depth > MAX_DEPTH) fail(`nested more than ${MAX_DEPTH} deep. Write it more simply.`);
	};
	const close = (): void => {
		const t = tokens[pos];
		if (!t) fail("ends too early. Check the brackets.");
		else if (!isOp(t, ")")) fail(unexpected(t));
		pos++;
	};

	function sum(depth: number): Expr {
		deep(depth);
		let left = product(depth);
		for (let t = tokens[pos]; isOp(t, "+", "-"); t = tokens[pos]) {
			pos++;
			left = { kind: "op", op: t.text as Operator, left, right: product(depth) };
		}
		return left;
	}

	function product(depth: number): Expr {
		let left = operand(depth);
		for (let t = tokens[pos]; isOp(t, "*", "/"); t = tokens[pos]) {
			pos++;
			left = { kind: "op", op: t.text as Operator, left, right: operand(depth) };
		}
		return left;
	}

	/** One factor; a number, name or bracket right after it is a missing *. */
	function operand(depth: number): Expr {
		const value = unary(depth);
		const next = tokens[pos];
		if (next && (next.kind !== "op" || next.text === "(")) fail(`write * between "${tokens[pos - 1]?.text ?? ""}" and "${next.text}".`);
		return value;
	}

	/** A sign binds looser than ^, so -a^2 is -(a^2); ^ groups to the right. */
	function unary(depth: number): Expr {
		deep(depth);
		const t = tokens[pos];
		if (isOp(t, "-", "+")) {
			pos++;
			const arg = unary(depth + 1);
			return t.text === "-" ? { kind: "neg", arg } : arg;
		}
		const base = primary(depth);
		if (!isOp(tokens[pos], "^")) return base;
		pos++;
		return { kind: "op", op: "^", left: base, right: unary(depth + 1) };
	}

	function primary(depth: number): Expr {
		const t = tokens[pos];
		if (!t) return fail("ends too early. Check the brackets.");
		if (t.kind === "num") {
			pos++;
			return { kind: "num", value: Number(t.text), text: t.text };
		}
		if (t.kind === "name") {
			pos++;
			const fn = FUNCTIONS.get(t.text);
			if (fn) {
				if (!isOp(tokens[pos], "(")) fail(`${t.text} needs brackets around what it takes, like ${t.text}(${names[0] ?? "x"}).`);
				pos++;
				const args: Expr[] = [];
				if (!isOp(tokens[pos], ")")) {
					args.push(sum(depth + 1));
					while (isOp(tokens[pos], ",")) {
						pos++;
						args.push(sum(depth + 1));
					}
				}
				close();
				if (args.length !== fn.arity) fail(`${t.text} takes ${fn.arity} argument${fn.arity === 1 ? "" : "s"}, got ${args.length}.`);
				return { kind: "call", fn: t.text, args };
			}
			if (CONSTANTS.has(t.text) || names.includes(t.text)) return { kind: "name", name: t.text };
			return fail(`unknown name "${t.text}". Use only ${[...names, ...CONSTANTS.keys()].join(", ")}.`);
		}
		if (isOp(t, "(")) {
			pos++;
			const arg = sum(depth + 1);
			close();
			return { kind: "group", arg };
		}
		return fail(unexpected(t));
	}

	try {
		const expr = sum(0);
		const rest = tokens[pos];
		if (rest) fail(unexpected(rest));
		return { expr };
	} catch (err) {
		if (err instanceof ExprError) return { error: err.message };
		throw err;
	}
}

/** The formula's value with each variable name given in `values`; a name
 *  with no value is NaN. Not finite where the math is (1/0, ln(0), sqrt(-1)). */
export function evalExpr(expr: Expr, values: ReadonlyMap<string, number>): number {
	switch (expr.kind) {
		case "num":
			return expr.value;
		case "name":
			return CONSTANTS.get(expr.name) ?? values.get(expr.name) ?? Number.NaN;
		case "neg":
			return -evalExpr(expr.arg, values);
		case "group":
			return evalExpr(expr.arg, values);
		case "op": {
			const a = evalExpr(expr.left, values);
			const b = evalExpr(expr.right, values);
			if (expr.op === "+") return a + b;
			if (expr.op === "-") return a - b;
			if (expr.op === "*") return a * b;
			if (expr.op === "/") return a / b;
			return a ** b;
		}
		case "call": {
			const fn = FUNCTIONS.get(expr.fn);
			const [a, b] = expr.args.map((arg) => evalExpr(arg, values));
			return fn ? fn.run(a ?? Number.NaN, b ?? Number.NaN) : Number.NaN;
		}
	}
}

const GREEK = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega"]);

/** A name in math: a Greek letter name as its symbol, one letter as it is,
 *  a longer word upright-italic, and what follows an underscore as a
 *  subscript. Names are [A-Za-z0-9_] only, so nothing in them is LaTeX. */
function nameLatex(name: string): string {
	if (name === "pi") return "\\pi";
	const cut = name.indexOf("_");
	const base = cut < 0 ? name : name.slice(0, cut);
	const sub = cut < 0 ? "" : name.slice(cut + 1).replaceAll("_", "\\_");
	const head = GREEK.has(base) ? `\\${base}` : base.length <= 1 ? base : `\\mathit{${base}}`;
	return sub ? `${head}_{${sub}}` : head;
}

/** The formula typeset under its line's label: division stays inline
 *  (a/(1+\lambda)), brackets as written. */
export function exprToLatex(expr: Expr): string {
	switch (expr.kind) {
		case "num":
			return expr.text;
		case "name":
			return nameLatex(expr.name);
		case "neg":
			return `-${exprToLatex(expr.arg)}`;
		case "group":
			return `(${exprToLatex(expr.arg)})`;
		case "op": {
			const left = exprToLatex(expr.left);
			if (expr.op === "^") return `{${left}}^{${exprToLatex(expr.right.kind === "group" ? expr.right.arg : expr.right)}}`;
			const right = exprToLatex(expr.right);
			return expr.op === "*" ? `${left}\\cdot ${right}` : `${left}${expr.op}${right}`;
		}
		case "call": {
			const args = expr.args.map(exprToLatex);
			if (expr.fn === "sqrt") return `\\sqrt{${args[0]}}`;
			if (expr.fn === "abs") return `\\left|${args[0]}\\right|`;
			return `${FUNCTIONS.get(expr.fn)?.latex ?? ""}(${args.join(", ")})`;
		}
	}
}
