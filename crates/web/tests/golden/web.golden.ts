import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { webTools } from "../../../../src/backend/agent/tools/web.ts";

/**
 * web_fetch end to end (fetch, Readability, Turndown, the reader-service fallback) against a local
 * server that serves tests/fixtures/routes.json. The reader service's address is pointed at the
 * same server, and the port is written as PORT so the Rust replay can use its own.
 */

const fixtures = path.resolve(import.meta.dirname, "../fixtures");

interface Route {
	status?: number;
	reason?: string;
	type?: string;
	file?: string;
	hex?: string;
	bom?: boolean;
	headers?: Record<string, string>;
	contentLength?: number;
}

const routes = JSON.parse(fs.readFileSync(path.join(fixtures, "routes.json"), "utf8")) as Record<string, Route>;

let origin: Promise<string> | null = null;

function routeKey(url: string): string {
	const pathname = url.split("#")[0]!;
	if (!pathname.startsWith("/__jina/")) return pathname;
	return `/__jina${pathname.slice("/__jina/".length).replace(/^https?:\/\/[^/]+/, "")}`;
}

function serve(req: http.IncomingMessage, res: http.ServerResponse) {
	const route = routes[routeKey(req.url ?? "/")];
	if (!route) {
		res.writeHead(404, "Not Found", { "Content-Type": "text/plain" });
		res.end("no such fixture");
		return;
	}
	let body = Buffer.alloc(0);
	if (route.file) body = fs.readFileSync(path.join(fixtures, route.file));
	if (route.hex) body = Buffer.from(route.hex, "hex");
	if (route.bom) body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]);
	const headers: Record<string, string | number> = { ...route.headers, Connection: "close" };
	if (route.type) headers["Content-Type"] = route.type;
	headers["Content-Length"] = route.contentLength ?? body.length;
	res.writeHead(route.status ?? 200, route.reason ?? "OK", headers);
	const short = route.contentLength !== undefined && route.contentLength > body.length;
	res.end(body, () => {
		if (short) res.socket?.destroy();
	});
}

function start(): Promise<string> {
	origin ??= new Promise((resolve) => {
		const server = http.createServer(serve);
		server.unref();
		server.listen(0, "127.0.0.1", () => {
			const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
			const realFetch = globalThis.fetch;
			globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				const jina = "https://r.jina.ai/";
				return realFetch(url.startsWith(jina) ? `${base}/__jina/${url.slice(jina.length)}` : input, init);
			}) as typeof fetch;
			resolve(base);
		});
	});
	return origin;
}

async function webFetch(target: string): Promise<string> {
	const base = await start();
	const url = /^https?:/.test(target) ? target : base + target;
	const result = await webTools.web_fetch!.execute("call", { url }, undefined);
	const first = result.content[0];
	const text = first?.type === "text" ? first.text : "";
	return text.replaceAll(base, "http://127.0.0.1:PORT");
}

const cases: Record<string, () => Promise<string>> = {};
for (const route of Object.keys(routes)) {
	if (!route.startsWith("/__jina/")) cases[route] = () => webFetch(route);
}
cases["connection refused"] = () => webFetch("http://127.0.0.1:1/");

export default cases;
