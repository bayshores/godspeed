/**
 * The TypeScript half of the Rust parity tests. Each crates/<crate>/tests/golden/<name>.golden.ts
 * default-exports its cases as `{ "case name": () => output }`; this runs them and writes
 * <name>.json beside the spec: `[{ name, output }]`, or `{ name, error }` when the case threw.
 * JSON keeps what the Rust side must match: key order, number text and lone surrogates.
 * An `undefined` output is left out, so the Rust test reads a missing `output` as undefined.
 *
 *   npm run golden            every spec
 *   npm run golden -- json    specs whose path contains "json"
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const filter = process.argv[2] ?? "";
const specs = fs
	.globSync("crates/*/tests/golden/*.golden.ts")
	.filter((file) => file.includes(filter))
	.sort();
if (specs.length === 0) throw new Error(`no golden specs match "${filter}"`);

for (const spec of specs) {
	const cases = (await import(pathToFileURL(path.resolve(spec)).href)).default as Record<string, () => unknown>;
	const out: { name: string; output?: unknown; error?: string }[] = [];
	for (const [name, run] of Object.entries(cases)) {
		try {
			out.push({ name, output: await run() });
		} catch (err) {
			out.push({ name, error: err instanceof Error ? err.message : String(err) });
		}
	}
	const file = spec.replace(/\.golden\.ts$/, ".json");
	fs.writeFileSync(file, `${JSON.stringify(out, null, "\t")}\n`);
	console.log(`${file}: ${out.length} cases`);
}
