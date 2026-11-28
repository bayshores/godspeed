/**
 * A helper, constant or type is written once. This finds copies across the files of src/ and the app
 * code of crates/ (tests left out), each language on its own:
 * - Functions whose bodies are the same once names are set aside: the function's own name is dropped,
 *   and its parameters and locals are renamed by where they first appear, so renaming a copy hides
 *   nothing. A body under 40 characters of code repeats by chance (`{}`, `self.reader.alive()`), so it
 *   counts only for two helpers of the same name at the top of their files. Methods in an
 *   `impl Trait for Type` block repeat by design and are left out.
 * - Constants of the same name and value. A number is compared by its value, so `86_400_000` and
 *   `24 * 60 * 60 * 1000` are the same. Plain values two limits share by chance are left out: nothing,
 *   a boolean, an empty value, a number under 100 (unless the name ends in a unit such as `_MS`),
 *   and a value that holds state (a lock, an atomic, an empty `new Set()`).
 * - Types of the same name and shape.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import { appSources, inTraitImpl, readAppCode, type RustToken, rustFunctions, rustTokens } from "./rust-source.ts";
import { parseTs, tsFiles, tsTokens } from "./ts-source.ts";

const root = path.resolve(import.meta.dirname, "../..");
const LIST = "tests/repo/exceptions/copies.json";
const SHORT = 40;

type Kind = "function" | "constant" | "type";

/** One function, constant or type, with the shape its copies share. */
type Piece = {
	kind: Kind;
	name: string;
	file: string;
	shape: string;
	/** A function at the top of its file: not a method, and not declared inside another function. */
	helper?: boolean;
};

const UNIT = /(?:_(?:MS|SECS|SECONDS|MINUTES|HOURS|DAYS|PX|BYTES|KB|MB|CHARS)|Ms|Secs|Seconds|Px|Bytes|Chars)$/;
const EMPTY = new Set(["null", "undefined", "None", "true", "false", '""', "''", "[ ]", "& [ ]", "{ }"]);

/** A constant whose value two files may well share by chance. */
function plain(name: string, value: string): boolean {
	if (EMPTY.has(value) || /^new \w+ (?:< .* > )?\( \)$/.test(value)) return true;
	if (/\b(?:Mutex|RwLock|Atomic\w*|OnceLock|OnceCell|RefCell|Cell)\b/.test(value)) return true;
	const number = Number(value);
	return value !== "" && Number.isFinite(number) && Math.abs(number) < 100 && !UNIT.test(name);
}

// TypeScript

const tsText = (node: ts.Node, source: ts.SourceFile) =>
	tsTokens(node, source)
		.map((token) => token.getText(source))
		.join(" ");

/** The names a function binds: its own, its parameters and every local, nested ones included. */
function boundNames(fn: ts.Node, name: string): Set<string> {
	const names = new Set([name]);
	const bind = (binding: ts.BindingName) => {
		if (ts.isIdentifier(binding)) names.add(binding.text);
		else for (const element of binding.elements) if (!ts.isOmittedExpression(element)) bind(element.name);
	};
	const visit = (node: ts.Node) => {
		if (ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isBindingElement(node)) bind(node.name);
		else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text);
		ts.forEachChild(node, visit);
	};
	visit(fn);
	return names;
}

/** A name that labels a property rather than standing for a value. */
function isKey(node: ts.Identifier): boolean {
	const parent = node.parent;
	if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
	if (ts.isQualifiedName(parent)) return parent.right === node;
	if (ts.isBindingElement(parent)) return parent.propertyName === node;
	const labelled = ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isJsxAttribute(parent) || ts.isEnumMember(parent);
	return labelled && parent.name === node;
}

/** A function body's tokens, with every name the function binds renamed by where it first appears. */
function tsBodyShape(fn: ts.FunctionLikeDeclaration, name: string, source: ts.SourceFile): string {
	const bound = boundNames(fn, name);
	const order = new Map<string, number>();
	return tsTokens(fn.body!, source)
		.map((token) => {
			const text = token.getText(source);
			if (!ts.isIdentifier(token) || !bound.has(text) || isKey(token)) return text;
			if (!order.has(text)) order.set(text, order.size);
			return `$${order.get(text)}`;
		})
		.join(" ");
}

/** The function a node declares with its name, and whether it is a helper at the top of its file. */
function tsFunction(node: ts.Node, source: ts.SourceFile): { fn: ts.FunctionLikeDeclaration; name: string; helper: boolean } | undefined {
	const isFunction = (value: ts.Node | undefined): value is ts.ArrowFunction | ts.FunctionExpression => !!value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value));
	if (ts.isFunctionDeclaration(node) && node.name) return { fn: node, name: node.name.text, helper: ts.isSourceFile(node.parent) };
	if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFunction(node.initializer)) return { fn: node.initializer, name: node.name.text, helper: ts.isSourceFile(node.parent.parent.parent) };
	if (ts.isMethodDeclaration(node)) return { fn: node, name: node.name.getText(source), helper: false };
	if (ts.isPropertyAssignment(node) && isFunction(node.initializer)) return { fn: node.initializer, name: node.name.getText(source), helper: false };
	return undefined;
}

/** A constant's number, where its value is arithmetic on numbers and the file's earlier constants. */
function tsNumber(node: ts.Expression, known: Map<string, number>): number | undefined {
	if (ts.isNumericLiteral(node)) return Number(node.getText().replaceAll("_", ""));
	if (ts.isIdentifier(node)) return known.get(node.text);
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return tsNumber(node.expression, known);
	if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
		const value = tsNumber(node.operand, known);
		return value === undefined ? undefined : -value;
	}
	if (!ts.isBinaryExpression(node)) return undefined;
	return arithmetic(tsNumber(node.left, known), node.operatorToken.getText(), tsNumber(node.right, known));
}

function arithmetic(left: number | undefined, mark: string, right: number | undefined): number | undefined {
	if (left === undefined || right === undefined) return undefined;
	if (mark === "+") return left + right;
	if (mark === "-") return left - right;
	if (mark === "*") return left * right;
	if (mark === "/") return left / right;
	if (mark === "**") return left ** right;
	return undefined;
}

/** The functions, constants and types of a TypeScript file. `text` stands in for the file's content. */
function tsPieces(file: string, text?: string): Piece[] {
	const source = parseTs(file, text);
	const pieces: Piece[] = [];
	const known = new Map<string, number>();
	const visit = (node: ts.Node) => {
		const found = tsFunction(node, source);
		if (found?.fn.body) pieces.push({ kind: "function", name: found.name, file, shape: tsBodyShape(found.fn, found.name, source), helper: found.helper });
		if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
			const body = ts.isTypeAliasDeclaration(node) ? tsText(node.type, source) : `{ ${node.members.map((member) => tsText(member, source)).join(" ")} }`;
			const extras = [...(node.typeParameters ?? []), ...((ts.isInterfaceDeclaration(node) && node.heritageClauses) || [])].map((extra) => tsText(extra, source));
			// Members may end in `;` or `,` or nothing, and the shape is the same.
			pieces.push({ kind: "type", name: node.name.text, file, shape: [body, ...extras].join(" ").replace(/ [;,](?= |$)/g, "") });
		}
		ts.forEachChild(node, visit);
	};
	for (const statement of source.statements) {
		if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
			for (const declaration of statement.declarationList.declarations) {
				const value = declaration.initializer;
				if (!ts.isIdentifier(declaration.name) || !value || ts.isArrowFunction(value) || ts.isFunctionExpression(value)) continue;
				const number = tsNumber(value, known);
				if (number !== undefined) known.set(declaration.name.text, number);
				const shape = number === undefined ? tsText(value, source) : String(number);
				if (!plain(declaration.name.text, shape)) pieces.push({ kind: "constant", name: declaration.name.text, file, shape });
			}
		}
		visit(statement);
	}
	return pieces;
}

// Rust

const RUST_WORDS = new Set(
	"as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while _ bool char str u8 u16 u32 u64 u128 usize i8 i16 i32 i64 i128 isize f32 f64".split(" "),
);

/**
 * A Rust body's tokens with its locals renamed by where they first appear. With no parser to say
 * which names are bound, a local is a lower-case word that is not a call, a macro, a field, a method
 * or part of a path.
 */
function rustBodyShape(body: RustToken[]): string {
	const order = new Map<string, number>();
	return body
		.map(({ text }, i) => {
			const before = body[i - 1]?.text;
			const after = body[i + 1]?.text;
			const path = (before === ":" && body[i - 2]?.text === ":") || (after === ":" && body[i + 2]?.text === ":");
			if (!/^[a-z_]\w*$/.test(text) || RUST_WORDS.has(text) || path || before === "." || after === "(" || after === "!") return text;
			if (!order.has(text)) order.set(text, order.size);
			return `$${order.get(text)}`;
		})
		.join(" ");
}

const ESCAPES: Record<string, number> = { n: 10, r: 13, t: 9, "0": 0, "\\": 92, "'": 39, '"': 34 };

/** The number a Rust number or char token stands for. */
function rustLiteral(text: string): number | undefined {
	const char = /^b?'(\\?)(.+)'$/.exec(text);
	if (char) return char[1] ? ESCAPES[char[2]!] : char[2]!.length === 1 ? char[2]!.charCodeAt(0) : undefined;
	const hex = /^0x([\da-f_]+)(?:[iu]\d+|[iu]size)?$/i.exec(text);
	if (hex) return parseInt(hex[1]!.replaceAll("_", ""), 16);
	const decimal = /^(\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?)(?:[iuf]\d+|[iu]size)?$/i.exec(text);
	return decimal ? Number(decimal[1]!.replaceAll("_", "")) : undefined;
}

/** A constant's number, where its tokens are arithmetic on numbers and the file's earlier constants. */
function rustNumber(tokens: RustToken[], known: Map<string, number>): number | undefined {
	let at = 0;
	const factor = (): number | undefined => {
		const token = tokens[at++]?.text;
		let value: number | undefined;
		if (token === "-") value = -(factor() ?? NaN);
		else if (token === "(") {
			value = sum();
			if (tokens[at++]?.text !== ")") return undefined;
		} else value = token === undefined ? undefined : (known.get(token) ?? rustLiteral(token));
		// A cast keeps the number: `b'\n' as u16`.
		while (tokens[at]?.text === "as") at += 2;
		return value;
	};
	const product = (): number | undefined => {
		let value = factor();
		while (tokens[at]?.text === "*" || tokens[at]?.text === "/") value = arithmetic(value, tokens[at++]!.text, factor());
		return value;
	};
	const sum = (): number | undefined => {
		let value = product();
		while (tokens[at]?.text === "+" || tokens[at]?.text === "-") value = arithmetic(value, tokens[at++]!.text, product());
		return value;
	};
	const value = sum();
	return at === tokens.length && value !== undefined && !Number.isNaN(value) ? value : undefined;
}

/** Where the item that starts at a token ends: its `;`, or with `braced` also the `}` that closes its first brace. */
function itemEnd(tokens: RustToken[], from: number, braced: boolean): number {
	let depth = 0;
	for (let at = from; at < tokens.length; at++) {
		const mark = tokens[at]!.text;
		if ("([{".includes(mark)) depth++;
		else if (")]}".includes(mark) && --depth === 0 && mark === "}" && braced) return at;
		else if (mark === ";" && depth === 0) return at;
	}
	return tokens.length;
}

/** The functions, constants and types of a Rust file's app code, `code` as `readAppCode` reads it. */
function rustPieces(file: string, text: string, code = readAppCode(text).code): Piece[] {
	const tokens = rustTokens(text, code);
	const traitImpl = inTraitImpl(tokens);
	const pieces: Piece[] = rustFunctions(tokens)
		.filter((fn) => !fn.traitImpl)
		.map((fn) => ({ kind: "function", name: fn.name, file, shape: rustBodyShape(fn.body), helper: fn.free }));
	const known = new Map<string, number>();
	let depth = 0;
	tokens.forEach((token, i) => {
		if (token.text === "{") depth++;
		else if (token.text === "}") depth--;
		const name = tokens[i + 1]?.text ?? "";
		if ((token.text === "const" || token.text === "static") && /^[A-Z][A-Z\d_]*$/.test(name) && !traitImpl(i)) {
			const end = itemEnd(tokens, i, false);
			const equals = tokens.findIndex((mark, at) => at > i && at < end && mark.text === "=");
			const value = equals < 0 ? [] : tokens.slice(equals + 1, end);
			const number = rustNumber(value, known);
			if (number !== undefined) known.set(name, number);
			const shape = number === undefined ? value.map((part) => part.text).join(" ") : String(number);
			if (!plain(name, shape)) pieces.push({ kind: "constant", name, file, shape });
		}
		// Types at the top of the file: an associated `type Output` belongs to its trait.
		if (depth === 0 && ["struct", "enum", "type"].includes(token.text) && /^[A-Z]\w*$/.test(name)) {
			pieces.push({ kind: "type", name, file, shape: `${token.text} ${tokens.slice(i + 2, itemEnd(tokens, i + 2, true) + 1).map((part) => part.text).join(" ")}` });
		}
	});
	return pieces;
}

// Copies

type Copies = { key: string; files: string[] };

/** The pieces written in two or more files, each set under a key that names it. */
function copiesOf(pieces: Piece[]): Copies[] {
	const same = new Map<string, Piece[]>();
	for (const piece of pieces) {
		// A function is the same whatever its name; a constant or a type only under the same name.
		const language = piece.file.endsWith(".rs") ? "Rust" : "TypeScript";
		const key = [language, piece.kind, piece.kind === "function" ? "" : piece.name, piece.shape].join("\n");
		same.set(key, [...(same.get(key) ?? []), piece]);
	}
	const sets = [...same.values()].flatMap((set) => {
		if (set[0]!.kind !== "function" || set[0]!.shape.replace(/\s/g, "").length >= SHORT) return [set];
		const helpers = new Map<string, Piece[]>();
		for (const piece of set) if (piece.helper) helpers.set(piece.name, [...(helpers.get(piece.name) ?? []), piece]);
		return [...helpers.values()];
	});
	return sets
		.map((set) => ({ key: `${set[0]!.kind} ${[...new Set(set.map((piece) => piece.name))].sort().join(" / ")}`, files: [...new Set(set.map((piece) => piece.file))].sort() }))
		.filter((copies) => copies.files.length > 1);
}

/** Copies with the same key counted together, as the list of exceptions counts them. */
function countByKey(copies: Copies[]): Map<string, { count: number; files: string[] }> {
	const counts = new Map<string, { count: number; files: string[] }>();
	for (const { key, files } of copies) {
		const seen = counts.get(key) ?? { count: 0, files: [] };
		counts.set(key, { count: seen.count + files.length, files: [...seen.files, ...files] });
	}
	return counts;
}

function appPieces(): Piece[] {
	const ts = tsFiles(path.join(root, "src")).flatMap((file) => tsPieces(path.relative(root, file)));
	const rust = appSources().flatMap((source) => rustPieces(source.file, source.text, source.code));
	return [...ts, ...rust];
}

it("no helper, constant or type is written in two files", () => {
	const pieces = appPieces();
	assert.ok(pieces.filter((piece) => piece.kind === "function").length > 5000, "found too few functions; the reader is broken");
	const allowed = JSON.parse(readFileSync(path.join(root, LIST), "utf-8")) as Record<string, number>;
	const counts = countByKey(copiesOf(pieces));

	const copied = [...counts].filter(([key, { count }]) => count > (allowed[key] ?? 0)).map(([key, { files }]) => `${key}: ${files.join(", ")}`);
	assert.deepEqual(
		copied,
		[],
		"Each of these is written in more than one file. Keep one and import it everywhere else: TypeScript in src/shared/core or beside its users, Rust in the lowest crate all its users depend on (docs/rust-server.md).",
	);
	const fewer = Object.entries(allowed)
		.filter(([key, count]) => (counts.get(key)?.count ?? 0) < count)
		.map(([key, count]) => `${key}: listed ${count}, found ${counts.get(key)?.count ?? 0}`);
	assert.deepEqual(fewer, [], `These have fewer copies than ${LIST} says. Lower their count, or remove the line at 0.`);
});

describe("the copy finder", () => {
	const keys = (pieces: Piece[]) => copiesOf(pieces).map((copies) => `${copies.key}: ${copies.files.join(", ")}`);

	it("finds a copied helper whose name and variables were renamed", () => {
		const first = tsPieces("a.ts", "export function percent(value: number) {\n\tconst scaled = Math.round(value * 100);\n\treturn `${scaled}%`;\n}\n");
		const second = tsPieces("b.tsx", "const toPct = (n: number) => {\n\tconst x = Math.round(n * 100); // rounded\n\treturn `${x}%`;\n};\n");
		assert.deepEqual(keys([...first, ...second]), ["function percent / toPct: a.ts, b.tsx"]);
	});

	it("finds a renamed Rust copy, and leaves out methods a trait gives every type", () => {
		const first = rustPieces("a.rs", 'fn date_ms(v: &Json) -> f64 {\n\tv.as_str().and_then(time::parse_date).map_or(f64::NAN, |ms| ms as f64)\n}\nimpl Tool for A { fn parameters(&self) -> Json { json!({ "type": "object", "properties": {} }) } }\n');
		const second = rustPieces("b.rs", 'fn ms_of(value: &Json) -> f64 {\n\t// Parsed the same way.\n\tvalue.as_str().and_then(time::parse_date).map_or(f64::NAN, |t| t as f64)\n}\nimpl Tool for B { fn parameters(&self) -> Json { json!({ "type": "object", "properties": {} }) } }\n#[cfg(test)]\nmod tests { fn date_ms(v: &Json) -> f64 { v.as_str().and_then(time::parse_date).map_or(f64::NAN, |ms| ms as f64) } }\n');
		assert.deepEqual(keys([...first, ...second]), ["function date_ms / ms_of: a.rs, b.rs"]);
	});

	it("counts a short body only for top-level helpers of the same name", () => {
		const first = tsPieces("a.ts", "const ignore = () => {};\nconst pct = (n: number) => `${n * 100}%`;\nexport const store = { refresh: () => {} };\nfunction Panel() { const show = () => setOpen(true); }\n");
		const second = tsPieces("b.ts", "const ignore = () => {};\nconst share = (n: number) => `${n * 100}%`;\nexport const other = { reload: () => {} };\nfunction Menu() { const show = () => setOpen(true); }\n");
		assert.deepEqual(keys([...first, ...second]), ["function ignore: a.ts, b.ts"]);
		const rust = [...rustPieces("a.rs", "fn name_of(file: &Json) -> &str { file[0].str() }\nimpl A { fn alive(&self) -> bool { self.reader.alive() } }\n"), ...rustPieces("b.rs", "fn name_of(f: &Json) -> &str { f[0].str() }\nimpl B { fn alive(&self) -> bool { self.reader.alive() } }\n")];
		assert.deepEqual(keys(rust), ["function name_of: a.rs, b.rs"]);
	});

	it("compares constants by value and leaves out plain ones", () => {
		const first = tsPieces("a.ts", 'const DAY_MS = 86_400_000;\nconst CELL = 2;\nconst RETRY_MS = 5;\nconst WEEKDAYS = ["Sun", "Mon"];\nconst listeners = new Set<() => void>();\nconst NAME = "a";\n');
		const second = tsPieces("b.ts", 'const HOUR_MS = 60 * 60 * 1000;\nconst DAY_MS = 24 * HOUR_MS;\nconst CELL = 2;\nconst RETRY_MS = 5;\nconst WEEKDAYS = ["Sun", "Mon"];\nconst listeners = new Set<() => void>();\nconst NAME = "b";\n');
		assert.deepEqual(keys([...first, ...second]), ["constant DAY_MS: a.ts, b.ts", "constant RETRY_MS: a.ts, b.ts", "constant WEEKDAYS: a.ts, b.ts"]);
		const rust = [...rustPieces("a.rs", "const DAY_MS: i64 = 86_400_000;\nconst NEWLINE: u16 = b'\\n' as u16;\nstatic LOCK: Mutex<()> = Mutex::new(());\n"), ...rustPieces("b.rs", "fn f() { const DAY_MS: i64 = 24 * 60 * 60 * 1000; }\nconst NEWLINE: u16 = b'\\n' as u16;\nstatic LOCK: Mutex<()> = Mutex::new(());\n")];
		assert.deepEqual(keys(rust), ["constant DAY_MS: a.rs, b.rs"]);
	});

	it("finds a type of the same name and shape, however its members end", () => {
		const first = tsPieces("a.ts", "type Lesson = { id: string; title: string };\ntype Row = { id: string };\n");
		const second = tsPieces("b.ts", "interface Lesson { id: string, title: string }\ntype Row = { id: number };\n");
		assert.deepEqual(keys([...first, ...second]), ["type Lesson: a.ts, b.ts"]);
		const rust = [...rustPieces("a.rs", "struct Span { from: usize, to: usize }\nimpl Add for Span { type Output = Span; }\n"), ...rustPieces("b.rs", "pub struct Span { from: usize, to: usize }\nimpl Sub for Span { type Output = Span; }\n")];
		assert.deepEqual(keys(rust), ["type Span: a.rs, b.rs"]);
	});

	it("counts copies under one key together", () => {
		const counts = countByKey([
			{ key: "function onKey / onKeyDown", files: ["a.ts", "b.ts"] },
			{ key: "function onKey / onKeyDown", files: ["c.ts", "d.ts", "e.ts"] },
		]);
		assert.equal(counts.get("function onKey / onKeyDown")?.count, 5);
	});
});
