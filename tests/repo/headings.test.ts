/**
 * The app draws a heading one of three ways (docs/ui-rules.md, "Page layout"): a page's title
 * (.lh-page-title), a card's or a dialog's title (.lh-card-title), or a heading inside one
 * (.lh-inner-title). A heading may also be read by a screen reader alone (.sr-only) or be the
 * lesson's kind tag (.lh-kind). This fails a heading in src/frontend drawn with a class set of its
 * own; the few that are another kind of thing (a count, the wordmark, a hero name) are counted
 * per file in tests/repo/exceptions/own-headings.json.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertWithinList } from "./counted-list.ts";

const NAMED = ["lh-page-title", "lh-card-title", "lh-inner-title", "lh-kind", "sr-only"];

/** The opening tag of each heading that takes none of the named classes. */
function ownHeadings(source: string): string[] {
	const named = new RegExp(`(^|[\\s"\`{(])(${NAMED.join("|")})($|[\\s"\`}),])`);
	return [...source.matchAll(/<h[1-6]\b[^>]*>/g)].map((match) => match[0].replace(/\s+/g, " ")).filter((tag) => !named.test(tag));
}

describe("headings", () => {
	it("the reader tells a named heading from one with its own classes", () => {
		const sample = [
			'<h1 className="lh-page-title">Home</h1>',
			'<h2 className={cn("lh-card-title flex-1", busy && "opacity-60")}>Plan</h2>',
			'<h3\n\tdata-testid="x"\n\tclassName="lh-inner-title px-3">Recent</h3>',
			'<h2 className="text-xl text-ink">Linked folder</h2>',
			'<h3 className="lh-card-title-ish">Not one</h3>',
			"<h4>Bare</h4>",
		].join("\n");
		assert.deepEqual(ownHeadings(sample), ['<h2 className="text-xl text-ink">', '<h3 className="lh-card-title-ish">', "<h4>"]);
	});

	it("every heading in the app takes a named class, or its file is on the list", () => {
		assertWithinList("own-headings", ownHeadings, "draws a heading with its own classes (use .lh-page-title, .lh-card-title or .lh-inner-title)");
	});
});
