// pi-ai's validateToolArguments on TypeBox schemas like the app's tools: each case records the
// schema JSON, the arguments, and what pi returned or threw.
import { Type, type TSchema } from "typebox";
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";

const option = Type.Object({ label: Type.String({ minLength: 1 }), value: Type.Optional(Type.String()) });
const quiz = Type.Object({
	type: Type.Union([Type.Literal("predict"), Type.Literal("check")]),
	nodeId: Type.String(),
	question: Type.String({ minLength: 1, maxLength: 40 }),
	options: Type.Array(option, { minItems: 2, maxItems: 4 }),
	multiSelect: Type.Optional(Type.Boolean()),
	correctAnswer: Type.Union([Type.String(), Type.Array(Type.String())]),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
	time: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	rating: Type.Optional(Type.Union([Type.Literal("R0"), Type.Literal("R1"), Type.Null()])),
});
const good = { type: "check", nodeId: "n1", question: "Why?", options: [{ label: "a", value: "a" }, { label: "b" }], correctAnswer: "a" };

const flat = Type.Object({
	n: Type.Integer({ minimum: 0 }),
	flag: Type.Optional(Type.Boolean()),
	name: Type.Optional(Type.String({ maxLength: 3 })),
	nothing: Type.Optional(Type.Null()),
	tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }))),
	k: Type.Optional(Type.Literal(5)),
	on: Type.Optional(Type.Literal(true)),
});

const cases: [string, TSchema, unknown][] = [
	["quiz ok", quiz, good],
	["quiz loose values", quiz, { ...good, multiSelect: "true", limit: "7", time: null, rating: null, options: { label: "only" } }],
	["quiz missing several", quiz, { nodeId: 3 }],
	["quiz wrong type literal", quiz, { ...good, type: "teach" }],
	["quiz bad union", quiz, { ...good, correctAnswer: 5 }],
	["quiz union object", quiz, { ...good, correctAnswer: { a: 1 } }],
	["quiz too many options", quiz, { ...good, options: [1, 2, 3, 4, 5].map((n) => ({ label: `o${n}` })) }],
	["quiz empty label", quiz, { ...good, options: [{ label: "" }, { label: "b", value: 7 }] }],
	["quiz long question", quiz, { ...good, question: "x".repeat(41) }],
	["quiz emoji question", quiz, { ...good, question: "👍🏽".repeat(30) }],
	["quiz combining question", quiz, { ...good, question: "é".repeat(40) }],
	["quiz flag question", quiz, { ...good, question: "🇺🇸".repeat(40) }],
	["quiz zwj question", quiz, { ...good, question: "👩‍👩‍👧".repeat(40) }],
	["quiz limit range", quiz, { ...good, limit: 30 }],
	["quiz limit low", quiz, { ...good, limit: 0 }],
	["quiz limit fraction", quiz, { ...good, limit: 2.7 }],
	["quiz limit text", quiz, { ...good, limit: "abc" }],
	["quiz rating text", quiz, { ...good, rating: "R2" }],
	["quiz rating null kept", quiz, { ...good, rating: null }],
	["quiz extra key", quiz, { ...good, extra: true }],
	["root string", quiz, "hello"],
	["root null", quiz, null],
	["root array", quiz, [1, 2]],
	["many errors", quiz, { type: 1, nodeId: 2, question: 3, options: [4, 5, 6, 7, 8, 9, 10], correctAnswer: null, multiSelect: [], limit: {}, time: 5 }],
	["flat ok", flat, { n: 3 }],
	["flat strings", flat, { n: " 12 ", flag: "FALSE", name: 12, nothing: "", tags: "one", k: "5", on: "1" }],
	["flat hex and bigint", flat, { n: "0x10" }],
	["flat bigint text", flat, { n: "12n" }],
	["flat negative", flat, { n: -1 }],
	["flat null n", flat, { n: null, flag: null, name: null, nothing: null, tags: null }],
	["flat booleans", flat, { n: true, flag: 1, name: false, tags: [1, true, null] }],
	["flat bad", flat, { n: "x", flag: "yes", name: "long", nothing: 1, tags: [""], k: 6, on: false }],
	["flat empty", flat, {}],
	["flat exp", flat, { n: "1e3", name: 1e21 }],
];

export default Object.fromEntries(
	cases.map(([name, schema, args]) => [
		name,
		() => {
			const out: Record<string, unknown> = { schema: JSON.parse(JSON.stringify(schema)), args };
			try {
				out.ok = validateToolArguments({ name: "t", description: "", parameters: schema } as never, { type: "toolCall", id: "c1", name: "t", arguments: args } as never);
			} catch (err) {
				out.error = (err as Error).message;
			}
			return out;
		},
	]),
);
