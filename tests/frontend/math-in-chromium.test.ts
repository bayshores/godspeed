/**
 * Inline math in Chromium, which the Windows app runs on and no layout run
 * draws: the rules that let a wide piece scroll must cut no letter off a
 * piece that fits. Skipped where no Chrome is installed.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { it } from "node:test";
import katex from "katex";

const CHROME = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((file) => fs.existsSync(file));

/** The inline math rules of globals.css, as written. */
function mathRules(): string {
	const css = fs.readFileSync("src/frontend/globals.css", "utf-8");
	const block = /:not\(\.katex-display\) > \.katex \{[^}]*\}/.exec(css);
	const scroller = /@supports \(baseline-source: last\) \{[^}]*\}\s*\}/.exec(css);
	assert.ok(block && scroller, "globals.css holds the inline math rules");
	return `${block[0]}\n${scroller[0]}`;
}

it("inline math that fits its line is whole in Chromium", { skip: CHROME ? false : "no Chrome here" }, () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "math-"));
	try {
		const math = ["12", "P(A)", "x^2+y^2=z^2"].map((tex) => katex.renderToString(tex)).join(" and ");
		// A base that scrolls is one wider than its box: none of these should be.
		const report = `document.fonts.ready.then(() => { document.body.dataset.cut = [...document.querySelectorAll(".katex-base")].filter((base) => base.scrollWidth > base.clientWidth + 1).length; });`;
		const page = path.join(dir, "page.html");
		fs.writeFileSync(
			page,
			`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://${path.resolve("node_modules/katex/dist/katex.min.css")}"><style>* { box-sizing: border-box } body { width: 900px; font-size: 20px }\n${mathRules()}</style><p>${math}</p><script>${report}</script>`,
		);
		const dom = execFileSync(CHROME!, ["--headless=new", "--no-sandbox", "--disable-gpu", "--virtual-time-budget=5000", `--user-data-dir=${path.join(dir, "profile")}`, "--dump-dom", `file://${page}`], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 });
		const cut = /data-cut="(\d+)"/.exec(dom);
		assert.ok(cut, "the page measured its math");
		assert.equal(cut[1], "0", "no piece of math is cut at its right edge");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
