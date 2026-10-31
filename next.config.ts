import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string; homepage: string };

const nextConfig: NextConfig = {
	// Public build metadata only.
	env: { LH_VERSION: pkg.version, LH_HOMEPAGE: pkg.homepage },
	// Standalone output: a self-contained .next/standalone/server.js that the
	// Electron shell runs on 127.0.0.1. scripts/build-server.mjs copies public/
	// and .next/static into it.
	output: "standalone",
	// Nothing uses next/image; this turns off its /_next/image resize endpoint.
	images: { unoptimized: true },
	// Without these excludes, output file tracing copies the repo's data/ (chat
	// records, graph ledgers) and root secret files (old credential files, a
	// legacy auth.json, .env*) into the bundle. build-server.mjs also refuses to
	// package a standalone that still contains them, because Next copies a
	// loaded .env after tracing.
	//
	// Don't add directory excludes like dist/**/*: they strip the dist/ folders
	// of server-external packages (pi-ai, pi-agent-core) and the packaged
	// server fails with ERR_MODULE_NOT_FOUND. **/data/**/* can also prune an
	// SDK's real data/ directory, so those need explicit includes below.
	// build-server.mjs removes the repo's dist/ and node_modules/electron from
	// the standalone instead.
	outputFileTracingExcludes: {
		"*": [
			"**/data/**/*",
			"auth.json",
			"chatgpt-credentials.json*",
			"github-copilot-credentials.json*",
			"xai-credentials.json*",
			".env*",
		],
	},
	// The tracer misses files loaded at runtime: JSON imported with
	// `with { type: "json" }` (pi-ai's provider catalog), and pdfjs-dist's fake
	// worker and standard fonts, which it loads by resolved path.
	outputFileTracingIncludes: {
		"*": [
			// The trace omits this runtime-imported directory, so importing
			// puppeteer-core would fail before browser startup.
			"node_modules/@puppeteer/browsers/lib/browser-data/**/*.js",
			"node_modules/pdfjs-dist/legacy/**/*",
			// The class-PDF text worker, loaded by path
			// (src/server/class-files.ts pdfTextWorkerPath); the tracer can't see it.
			"src/server/workers/**/*",
			// The godspeed folder's files, copied there at runtime (src/server/agent-folder.ts).
			"src/server/agent-folder-files/**/*",
			"node_modules/pdfjs-dist/standard_fonts/**/*",
			// pdf_render paints via @napi-rs/canvas. Its
			// platform binary (@napi-rs/canvas-<platform>-<arch>) is a dynamic
			// optional-dep require the tracer cannot see. Builds run per-OS and
			// npm installs only the current platform's binary, so this glob
			// resolves to exactly one Skia binary per build.
			"node_modules/@napi-rs/canvas-*/**/*",
			// resvg rasterizes visual-maker SVGs natively; same
			// per-platform-binary story as the canvas above (one per build).
			"node_modules/@resvg/resvg-js-*/**/*",
			// Class search: transformers loads onnxruntime-node with createRequire,
			// which the tracer misses. Its binding is per platform; only this
			// build's is included.
			"node_modules/onnxruntime-node/package.json",
			"node_modules/onnxruntime-node/dist/**/*.js",
			"node_modules/onnxruntime-common/dist/cjs/**/*.js",
			// Marks dist/cjs as CommonJS; without it Node reads it as ESM.
			"node_modules/onnxruntime-common/dist/cjs/package.json",
			`node_modules/onnxruntime-node/bin/napi-v6/${process.platform}/${process.arch}/**/*`,
			// transformers imports sharp; on Windows its .node needs the libvips
			// DLLs beside it, which the tracer leaves out. npm installs only this
			// platform's @img packages, so this is one set per build.
			"node_modules/@img/**/*",
			"node_modules/@earendil-works/pi-ai/dist/providers/data/**/*",
			"node_modules/@earendil-works/pi-ai/dist/utils/sleep.js",
			"node_modules/@earendil-works/pi-agent-core/dist/**/*.json",
		],
	},
	// Framework-free core lives in src/ (plain TS, imported by routes and CLI alike).
	// The pi engine must stay external: its providers are runtime-loaded Node
	// code (undici streams, catalog data) that breaks when bundled into routes.
	// The proxy (src/proxy.ts) buffers every API body, 10 MB by default; a
	// lesson message may carry 5 PDFs of 30 MB each as base64 (src/core/attachments.ts).
	experimental: { proxyClientMaxBodySize: "210mb" },
	serverExternalPackages: [
		"@earendil-works/pi-ai",
		"@earendil-works/pi-agent-core",
		"pdfjs-dist", // bundling breaks its node fake-worker path
		"@napi-rs/canvas", // native binding — bundling breaks the .node require
		"@resvg/resvg-js", // native binding — same
	],
};

export default nextConfig;