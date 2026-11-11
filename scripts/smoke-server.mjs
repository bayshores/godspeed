/**
 * smoke-server.mjs — boot the release server from a staged folder and prove it serves.
 *
 * A finished `cargo build` says nothing about whether the server starts beside its UI and
 * pdf.js files. This runs before the bundler so a broken payload fails in seconds. It starts
 * target/<triple>/release/godspeed-server (what scripts/stage-app.mjs builds) in browser mode on
 * a free 127.0.0.1 port, in a folder of links to the staged files, with a THROWAWAY home and
 * data folder so it never touches a real godspeed folder. It polls GET / until 200, then probes
 * the routes below. Any non-200, an early exit, or a 30 s boot timeout fails and prints the
 * server's log tail. The child is ALWAYS stopped: a leaked server holds its port.
 */
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const WINDOWS = process.platform === "win32";
const PDFIUM = { darwin: "libpdfium.dylib", win32: "pdfium.dll" }[process.platform] ?? "libpdfium.so";
const POLL_MS = 500;
const BOOT_TIMEOUT_MS = 30_000;
/** GET-only probes. /api/boot writes only to the throwaway data folder; the page asks for it
 *  before its first paint. The last one is a file from pdfjs-dist/. */
const PROBES = ["/api/boot", "/api/graph", "/api/settings", "/pdfjs/pdf.worker.min.mjs"];

const triple = execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
const server = path.join(ROOT, "target", triple, "release", WINDOWS ? "godspeed-server.exe" : "godspeed-server");
const staged = { ui: path.join(ROOT, "dist-ui"), models: path.join(ROOT, "models"), "pdfjs-dist": path.join(ROOT, ".stage", "pdfjs-dist") };
const pdfium = path.join(ROOT, ".stage", PDFIUM);

for (const missing of [server, pdfium, ...Object.values(staged)].filter((file) => !fs.existsSync(file))) {
	console.error(`[smoke-server] ${path.relative(ROOT, missing)} is missing, run \`node scripts/stage-app.mjs\` first.`);
	process.exit(1);
}

/** A free TCP port: listen(0) lets the kernel pick one. */
function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
		srv.on("error", reject);
	});
}

/** One GET; resolves the status code (0 = connection refused or failed). */
function get(url) {
	return new Promise((resolve) => {
		const req = http.get(url, (res) => {
			res.resume();
			resolve(res.statusCode ?? 0);
		});
		req.on("error", () => resolve(0));
		req.setTimeout(5000, () => {
			req.destroy();
			resolve(0);
		});
	});
}

async function main() {
	const port = await freePort();
	const url = `http://127.0.0.1:${port}`;
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "lh-smoke-"));
	const resources = path.join(home, "resources");
	fs.mkdirSync(resources);
	// A junction needs no special rights on Windows; other systems ignore the type.
	for (const [name, target] of Object.entries(staged)) fs.symlinkSync(target, path.join(resources, name), "junction");

	const tail = [];
	const keep = (buf) => tail.push(...buf.toString().split("\n"));
	const child = spawn(server, [], {
		cwd: resources,
		// Nothing from the real environment (keys, agent folders) reaches the server.
		env: {
			PATH: process.env.PATH,
			...(WINDOWS ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
			HOME: home,
			USERPROFILE: home,
			APPDATA: path.join(home, "config"),
			LOCALAPPDATA: path.join(home, "local"),
			PORT: String(port),
			LH_DATA_DIR: path.join(home, "data"),
			LH_PDFIUM_PATH: pdfium,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let exited = false;
	child.stdout.on("data", keep);
	child.stderr.on("data", keep);
	child.on("exit", () => {
		exited = true;
	});

	const stop = () =>
		new Promise((resolve) => {
			if (exited) return resolve();
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				resolve();
			}, 3000);
			child.once("exit", () => {
				clearTimeout(timer);
				resolve();
			});
			child.kill("SIGTERM");
		});

	let failed = null;
	try {
		let boot = 0;
		const deadline = Date.now() + BOOT_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (exited) throw new Error(`server exited before answering on ${url}`);
			boot = await get(url);
			if (boot === 200) break;
			await new Promise((r) => setTimeout(r, POLL_MS));
		}
		if (boot !== 200) throw new Error(`server never answered 200 on ${url} (last status: ${boot})`);
		console.log(`[smoke-server] boot ok: GET / → 200 (${url})`);

		for (const route of PROBES) {
			const status = await get(url + route);
			if (status !== 200) throw new Error(`GET ${route} → ${status} (expected 200)`);
			console.log(`[smoke-server] GET ${route} → 200`);
		}
	} catch (err) {
		failed = err;
	} finally {
		await stop();
		fs.rmSync(home, { recursive: true, force: true });
	}

	if (failed) {
		console.error(`[smoke-server] FAIL: ${failed.message}`);
		console.error("--- server log tail " + "-".repeat(20));
		for (const line of tail.slice(-40)) if (line.trim()) console.error(`    ${line}`);
		process.exit(1);
	}
	console.log("[smoke-server] smoke passed: the server boots and serves.");
}

main().catch((err) => {
	console.error(`[smoke-server] FAIL: ${err.message}`);
	process.exit(1);
});
