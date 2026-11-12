// Source marks and the content spans they rely on: code and math boundaries from the Markdown
// grammar (nested containers, fences, indented code, dollar runs, \( \[), each kind of mark,
// look-alikes, and the plain-text reader.
import { citesInWords, fileCiteMark, replaceCiteMarks, type CiteMark } from "../../../../src/shared/core/citations.ts";
import { readContentSpans } from "../../../../src/shared/core/content-reader.ts";
import { sessionMarkdown } from "../../../../src/shared/core/session-markdown.ts";

const P = "[[f_1a2b3c4d5e6f:7]]";
const F = "[[f_1a2b3c4d5e6f/p. 12/Week 6 slides.pdf]]";
const W = "[[https://example.com/page]]";

export const spanTexts = [
	"",
	"plain words",
	"a `b` c",
	"x $y$ z",
	"```\n$a$\n```\nafter",
	"~~~js\nlet a = `x`;\n~~~",
	"```\nnever closed $x$",
	"    indented code $x$\n\nthen $y$",
	"- item `code` and $m$\n  - nested ``a ` b`` done",
	"> quote `q`\n> more $r$\n\nout",
	"> ```\n> fenced in quote\n> ```\nlazy",
	"1. one\n\n   ```\n   inside list\n   ```\n2. two `x`",
	"$$\nx\n$$",
	"  $$\n  a + b\n  $$\ntail",
	"$$x$$ inline display",
	"$$ a $$ and $$\nb\n$$",
	"$$\nunclosed display",
	"costs $5 and\n\nthen $6",
	"a \\$x$ b",
	"$a `$` b$",
	"see \\(x\\) and \\[y\\]",
	"\\(a\n\nb\\)",
	"\\[a\n\nb\\]",
	"\\\\(not math\\)",
	"`a $b` c$ d",
	"$$$ three $$$ two $$ end",
	"é😀 `x` $y$",
	"line\r\n```\r\ncode\r\n```\r\n$z$",
	"<span>`not code`</span> `code`",
	"[link `x`](http://a.b) `y`",
	"*emph `c`* **$m$**",
	"\t\tcode by tabs\n\n`x`",
	"a ``` b",
	"``\n`\n``",
	"$\\$$ and $a\\$b$",
	"`unclosed and $math$",
	"# Heading `h`\nSetext `s`\n---\n$x$",
	"text\n```\n" + "$".repeat(3) + "\n```",
];

const markTexts = [
	`A ${P} B ${F} C ${W}`,
	"[[f_1a2b3c4d5e6f/p. 3/a/b.pdf]]",
	"[[1,2],[3,4]]",
	"see [[note]]",
	"[[f_1a2b:7]]",
	"[[f_1a2b3c4d5e6f]]",
	"[[ftp://example.com/a]]",
	"[[https://]]",
	"[[https://a b]]",
	"[[http://exa mple.com]]",
	"[[https://exa%mple.com]]",
	"[[https://[::1]:8080/x]]",
	"[[https://例え.jp/パス]]",
	"[[https://example.com:99999/]]",
	"[[f_1a2b3c4d5e6f:7\n]]",
	`Write \`${P}\` like this.`,
	`\`\`\`\n${P}\n\`\`\``,
	`The set $${P}$ is odd.`,
	`$$\n${P}\n$$`,
	`Real one ${P} and \`${W}\``,
	`- list ${F}\n  > quote ${W}`,
	`[[[f_1a2b3c4d5e6f:7]]]`,
	`[[${"x".repeat(401)}]] ${P}`,
	`${P}${P}${F}`,
];

export default {
	"content spans": () => spanTexts.map((text) => ({ text, spans: readContentSpans(text).map((s) => [s.kind, s.raw]) })),
	"marks read": () =>
		markTexts.map((text) => {
			const marks: CiteMark[] = [];
			const swapped = replaceCiteMarks(text, (mark) => {
				marks.push(mark);
				return `<${marks.length}>`;
			});
			return { text, marks, swapped, words: citesInWords(text) };
		}),
	"stored marks": () =>
		["Week 6 slides.pdf", "Notes [draft] [[v2]].pdf", "HW$2 notes.pdf", "week`3.pdf", "a\nb.pdf"].map((name) => {
			const mark = fileCiteMark("f_1a2b3c4d5e6f", "p. 3", name);
			return { name, mark, words: citesInWords(`It frees memory. ${mark} Then $x+1$ and \`free\`.`) };
		}),
	"session export": () =>
		sessionMarkdown([
			{ id: "u1", role: "user", content: `Where is this from? ${F}`, timestamp: 0 },
			{ id: "a1", role: "assistant", content: [{ type: "text", text: `Chunks are cut by page.${F} See ${W}, and ${P}.` }], stopReason: "stop", timestamp: 0 },
			{ id: "a2", role: "assistant", content: [{ type: "toolCall", id: "c1", name: "send_to_user", arguments: { message: `Code \`${F}\` stays.` } }], stopReason: "toolUse", timestamp: 0 },
		] as never, { anchors: false }),
} as Record<string, () => unknown>;
