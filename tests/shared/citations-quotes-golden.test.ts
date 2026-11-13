/**
 * The source mark twins replay the shared cases the Rust server also
 * replays (crates/core/tests/citations_quotes_golden.rs), so both copies
 * read and write quoted marks alike.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { citesInWords, fileCiteMark, replaceCiteMarks, type CiteMark } from "../../src/shared/core/citations.ts";

interface Case {
	name: string;
	output: { args: { text?: string; name?: string; quote?: string }; result: unknown };
}

const cases = JSON.parse(readFileSync(new URL("../../crates/core/tests/golden/citations_quotes.json", import.meta.url), "utf-8")) as Case[];

function read(text: string): { marks: CiteMark[]; swapped: string } {
	const marks: CiteMark[] = [];
	const swapped = replaceCiteMarks(text, (mark) => `<${marks.push(mark)}>`);
	return { marks, swapped };
}

describe("citations_quotes shared cases", () => {
	for (const { name, output } of cases) {
		it(name, () => {
			const { text, name: file, quote } = output.args;
			if (text !== undefined) {
				assert.deepEqual({ ...read(text), words: citesInWords(text) }, output.result);
				return;
			}
			const mark = fileCiteMark("f_1a2b3c4d5e6f", "p. 3", file!, quote);
			assert.deepEqual({ mark, marks: read(mark).marks, words: citesInWords(`It frees memory. ${mark} Then $x+1$ and \`free\`.`) }, output.result);
		});
	}
});
