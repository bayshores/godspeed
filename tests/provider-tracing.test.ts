/** JS matcher + config-policy regressions; native Turbopack needs the real payload gate. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import nextConfig from "../next.config.ts";

const require = createRequire(import.meta.url);
// Use Next's actual bundled matcher, not a different glob implementation.
const picomatch = require("next/dist/compiled/picomatch");
const { makeIgnoreFn } = require("next/dist/build/collect-build-traces");
const patterns = nextConfig.outputFileTracingExcludes!["*"];

describe("standalone JavaScript tracing exclusions and native workaround policy", () => {
	for (const windows of [false, true]) {
		const root = windows ? "C:\\build\\godspeed" : "/build/godspeed";
		const file = (relative: string) => root + (windows ? "\\" : "/") + (windows ? relative.replaceAll("/", "\\") : relative);
		const ignored = picomatch(patterns, { contains: true, dot: true, windows });
		it(`excludes genuine data directories and secrets (${windows ? "Windows" : "POSIX"})`, () => {
			for (const relative of ["data/canary.json", "nested/data/private.json", "auth.json", ".env", ".env.local", "chatgpt-credentials.json", "github-copilot-credentials.json", "xai-credentials.json", "chatgpt-credentials.json.fixture.tmp", "github-copilot-credentials.json.fixture.tmp", "xai-credentials.json.fixture.tmp"]) {
				assert.equal(ignored(file(relative)), true, relative);
			}
			// The explicit includes remain necessary: this raw ignore still matches SDK data.
			assert.equal(ignored(file("node_modules/@earendil-works/pi-ai/dist/providers/data/models.json")), true);
			assert.ok(nextConfig.outputFileTracingIncludes!["*"]!.includes("node_modules/@earendil-works/pi-ai/dist/providers/data/**/*"));
		});
		it(`does not confuse dependency suffixes with data directories (${windows ? "Windows" : "POSIX"})`, () => {
			for (const relative of ["node_modules/gcp-metadata/build/src/index.js", "node_modules/form-data/lib/form_data.js", "node_modules/@swc/helpers/_/_ts_metadata.js", "node_modules/@swc/helpers/_/_ts_metadata/index.js", "node_modules/somedata/runtime.js"]) {
				assert.equal(ignored(file(relative)), false, relative);
				assert.equal(picomatch("data/**/*", { contains: true, dot: true, windows })(file("node_modules/gcp-metadata/build/src/index.js")), true, "old pattern must reproduce the bug");
			}
		});
	}
	it("uses the installed Next JavaScript early-ignore function on the host platform", () => {
		const root = process.cwd();
		const ignore = makeIgnoreFn(root, patterns);
		assert.equal(ignore(`${root}/data/private.json`), true);
		assert.equal(ignore(`${root}/node_modules/gcp-metadata/build/src/index.js`), false);
	});
	it("preserves all secret exclusions exactly", () => {
		assert.deepEqual(patterns, ["**/data/**/*", "auth.json", "chatgpt-credentials.json*", "github-copilot-credentials.json*", "xai-credentials.json*", ".env*"]);
	});
	it("retains exactly the runtime includes (the native-provider closure was removed with the sign-ins)", () => {
		assert.deepEqual(nextConfig.outputFileTracingIncludes!["*"], [
			"node_modules/@puppeteer/browsers/lib/browser-data/**/*.js",
			"node_modules/pdfjs-dist/legacy/**/*",
			// Speed plan: the class-PDF text worker, loaded by path.
			"src/server/workers/**/*",
			"src/server/agent-folder-files/**/*",
			"node_modules/pdfjs-dist/standard_fonts/**/*",
			"node_modules/@napi-rs/canvas-*/**/*",
			"node_modules/@resvg/resvg-js-*/**/*",
			// Class search: onnxruntime-node, loaded by createRequire; this platform's binding only.
			"node_modules/onnxruntime-node/package.json",
			"node_modules/onnxruntime-node/dist/**/*.js",
			"node_modules/onnxruntime-common/dist/cjs/**/*.js",
			"node_modules/onnxruntime-common/dist/cjs/package.json",
			`node_modules/onnxruntime-node/bin/napi-v6/${process.platform}/${process.arch}/**/*`,
			// sharp's per-platform packages, with the DLLs Windows needs beside its .node.
			"node_modules/@img/**/*",
			"node_modules/@earendil-works/pi-ai/dist/providers/data/**/*",
			"node_modules/@earendil-works/pi-ai/dist/utils/sleep.js",
			"node_modules/@earendil-works/pi-agent-core/dist/**/*.json",
		]);
	});
});
