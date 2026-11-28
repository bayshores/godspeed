/**
 * No small grey label (docs/ui-rules.md, "Type"): a class set in src/frontend that is small
 * (text-sm, text-xs) and quiet (text-ink-2, text-ink-3, text-muted-foreground) at once fails here.
 * A label the learner needs is text-ui; one that says what is already clear is cut. A count or a
 * date in the counting face and code in the system monospace may be small and quiet. What is
 * drawn at a picture's own measured sizes (the Graph's hover lines, a plot's axes and key) is
 * counted per file in tests/repo/exceptions/small-labels.json.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertWithinList } from "./counted-list.ts";

const SMALL = /(^|\s)(text-sm|text-xs|text-\(length:--text-(sm|xs)\))(\s|$)/;
const QUIET = /(^|\s)(text-ink-2|text-ink-3|text-muted-foreground)(\s|$)/;
const OWN_FACE = /(^|\s)(font-count|font-mono)(\s|$)/;

/** Each quoted class set that is small and quiet, in a face that is not the counting face or code. */
function smallLabels(source: string): string[] {
	return [...source.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((match) => match[1] ?? match[2]!).filter((text) => SMALL.test(text) && QUIET.test(text) && !OWN_FACE.test(text));
}

describe("small labels", () => {
	it("the reader finds a small quiet class set and lets the counting face and code through", () => {
		const sample = [
			'<span className="text-sm text-ink-2">Saved</span>',
			'<span className={cn("shrink-0 text-xs", "x")}>',
			"<p className={`truncate text-(length:--text-sm) text-ink-3 ${on}`}>",
			'<span className="font-count text-sm text-ink-2">3d</span>',
			'<span className="font-mono text-xs text-ink-2">main.py</span>',
			'<span className="text-ui text-ink-2">Saved</span>',
		].join("\n");
		assert.deepEqual(smallLabels(sample), ["text-sm text-ink-2", "truncate text-(length:--text-sm) text-ink-3 ${on}"]);
	});

	it("no small grey label in the app, past the files on the list", () => {
		assertWithinList("small-labels", smallLabels, "sets a small grey label (set it at text-ui, or cut it)");
	});
});
