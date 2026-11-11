// The visual maker and demo builder loops on the real TypeScript, with a scripted model and a
// stand-in headless engine: each case's script, the result, every tool answer and user message the
// model was shown, and the activity lines. tests/subagents_golden.rs replays each case's `config`
// on the Rust loops with the same stand-ins.
const src = "../../../../src/backend/agent/subagents";
const { runVisualMaker } = await import(`${src}/visual-maker.ts`);
const { runDemoBuilder } = await import(`${src}/demo-builder.ts`);
const { createFauxCore, fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");

type Step = { calls: [string, unknown][] } | { text: string };
type DemoRun = { result: Record<string, unknown> } | { throws: string };
interface Config {
	kind: "visual" | "demo";
	title?: string;
	brief: string;
	steps: Step[];
	/** unavailableReason(), when set. */
	unavailable?: string;
	/** What each runDemo call answers, in turn (the last one repeats). */
	demo?: DemoRun[];
}

/** What the model was shown: tool answers and user messages, pictures as "[image]". */
function shown(messages: { role: string; content: unknown; toolName?: string; isError?: boolean }[]) {
	return messages
		.filter((m) => m.role === "toolResult" || m.role === "user")
		.map((m) => {
			const parts = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as { type: string; text?: string }[]);
			const text = parts.map((p) => (p.type === "text" ? p.text : "[image]")).join("\n");
			return m.role === "toolResult" ? { tool: m.toolName, isError: m.isError, text } : { user: text };
		});
}

async function run(config: Config) {
	let last: unknown[] = [];
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	faux.setResponses(
		config.steps.map((step, i) => (context: { messages: unknown[] }) => {
			last = context.messages;
			return "calls" in step
				? fauxAssistantMessage(step.calls.map(([name, args], k) => fauxToolCall(name, args as Record<string, unknown>, { id: `call_${i}_${k}` })), { stopReason: "toolUse" })
				: fauxAssistantMessage(step.text);
		}),
	);
	const engine = { model: faux.getModel(), streamFn: faux.streamSimple };
	let demoCalls = 0;
	const headless = {
		available: () => true,
		unavailableReason: () => config.unavailable ?? null,
		runDemo: async () => {
			const runs = config.demo ?? [];
			const next = runs[Math.min(demoCalls++, runs.length - 1)]!;
			if ("throws" in next) throw new Error(next.throws);
			return next.result;
		},
		renderSvg: async (svg: string) => {
			if (svg.includes("broken")) throw new Error("bad svg");
			return Buffer.from("png");
		},
		renderPdfPages: async () => [],
	};
	const activity: string[] = [];
	const opts = { engine, headless, onActivity: (line: string) => activity.push(line) };
	const result = config.kind === "visual" ? await runVisualMaker({ brief: config.brief }, opts) : await runDemoBuilder({ title: config.title ?? "", brief: config.brief }, opts);
	return { config, result, shown: shown(last as never), activity };
}

const SVG = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60">', '  <rect x="5" y="5" width="30" height="30"/>', '  <rect x="45" y="5" width="30" height="30"/>', '  <circle cx="100" cy="20" r="10" fill="red"/>', "</svg>"].join("\n");
const clean = { result: { consoleErrors: [], pageErrors: [], failedRequests: [], ok: true } };
const failing = { result: { consoleErrors: ["boom"], pageErrors: ["x is not defined", "y"], failedRequests: ["https://cdn.example/lib.js (net::ERR_FAILED)"], ok: false } };

const cases: Record<string, Config> = {
	"visual: looked at and delivered": { kind: "visual", brief: "  Two boxes and a dot.\nMore.  ", steps: [{ calls: [["write_svg", { svg: SVG }]] }, { calls: [["render_svg", {}]] }, { text: "  Two boxes and a dot.  " }] },
	"visual: an unlooked finish is shown first": {
		kind: "visual",
		brief: "",
		steps: [{ calls: [["write_svg", { svg: SVG }], ["edit_svg", { old_text: 'r="10"', new_text: 'r="$&$$10"' }]] }, { text: "Done." }, { text: "" }],
	},
	"visual: every tool error": {
		kind: "visual",
		brief: "x",
		steps: [
			{
				calls: [
					["edit_svg", { old_text: "a", new_text: "b" }],
					["render_svg", {}],
					["write_svg", { svg: "just words" }],
					["write_svg", { svg: "" }],
					["write_svg", { svg: 5 }],
					["write_svg", {}],
					["write_svg", { svg: SVG }],
					["edit_svg", { old_text: "<rect", new_text: "x" }],
					["edit_svg", { old_text: 'rect x="450"', new_text: "y" }],
					["edit_svg", { old_text: "", new_text: "y" }],
					["edit_svg", { old_text: "<rect", new_text: 5 }],
					["edit_svg", { old_text: "<rect" }],
					["edit_svg", { old_text: "   ", new_text: "" }],
					["edit_svg", { old_text: "red green", new_text: "" }],
					["draw", {}],
					["render_svg", { extra: 1 }],
					["write_svg", { svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect x="1" broken' }],
					["render_svg", {}],
				],
			},
			{ text: "Gave up." },
		],
	},
	"visual: never writes": { kind: "visual", brief: "x", steps: [{ text: "n".repeat(400) }] },
	"visual: iteration limit, looked at": { kind: "visual", brief: "x", steps: [{ calls: [["write_svg", { svg: SVG }], ["render_svg", {}]] }, ...Array.from({ length: 7 }, () => ({ calls: [["render_svg", {}]] as [string, unknown][] }))] },
	"visual: iteration limit, never looked at": { kind: "visual", brief: "x", steps: Array.from({ length: 8 }, () => ({ calls: [["write_svg", { svg: SVG }]] as [string, unknown][] })) },
	"visual: no engine": { kind: "visual", brief: "x", steps: [], unavailable: "no render engine" },
	"visual: the script runs out": { kind: "visual", brief: "x", steps: [{ calls: [["write_svg", { svg: SVG }]] }] },
	"demo: tested and delivered": {
		kind: "demo",
		title: "  Stepper ",
		brief: "",
		steps: [{ calls: [["run_demo", {}], ["run_demo", { probe: "1 + 1" }], ["write_demo", { html: "" }], ["write_demo", { html: "   \n  " }], ["write_demo", { html: 5 }], ["write_demo", {}], ["run_demo", { probe: 5 }], ["run_demo", {}]] }, { text: " Nothing more. " }],
		demo: [{ result: { ...clean.result, probeResult: { a: [1, "two"] } } }, clean],
	},
	"demo: never passes": { kind: "demo", title: "", brief: "b", steps: [{ calls: [["write_demo", { html: "<p>hi</p>" }], ["run_demo", {}]] }, { text: "It works." }], demo: [failing] },
	"demo: the browser fails": { kind: "demo", title: "T", brief: "b", steps: [{ calls: [["write_demo", { html: "<p>hi</p>" }], ["run_demo", {}]] }, { text: "" }], demo: [{ throws: "No render engine available" }] },
	"demo: untested html is verified at the end": { kind: "demo", title: "T", brief: "b", steps: [{ calls: [["write_demo", { html: "<p>a</p>" }]] }, { text: "Built." }], demo: [clean] },
	"demo: never writes": { kind: "demo", title: "T", brief: "b", steps: [{ text: "Nothing could be built." }] },
	"demo: no engine": { kind: "demo", title: "T", brief: "b", steps: [], unavailable: "no browser" },
	"demo: the script runs out": { kind: "demo", title: "T", brief: "b", steps: [] },
};

export default Object.fromEntries(Object.entries(cases).map(([name, config]) => [name, () => run(config)]));
