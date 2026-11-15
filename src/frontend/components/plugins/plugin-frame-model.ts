import type { PluginManifest, SettingValue } from "@/frontend/lib/plugins-api";
import type { HostAnswer } from "@/frontend/lib/plugin-host-api";

/**
 * The host side of MCP Apps (protocol 2026-01-26, the one `@modelcontextprotocol/ext-apps` 2.x
 * speaks) for one plugin frame: JSON-RPC over postMessage. A message counts only when it comes
 * from this frame's window, is well-formed JSON-RPC and names a method godspeed knows; anything
 * else is dropped. A well-formed request for another method gets "method not found", so the
 * plugin's SDK doesn't wait for an answer that never comes.
 */

export const PROTOCOL_VERSION = "2026-01-26";

/** A question in the lesson; `id` stays the same for as long as the question lives. */
export interface PluginQuestion {
	id: string;
	text: string;
	options: string[];
}

/** What the plugin can read with get_context. On a space's page only `space` is set. */
export interface PluginContext {
	space: { id: string; name: string } | null;
	/** The open lesson's title. */
	topic: string | null;
	/** The open question on screen. Never carries its answer. */
	question: PluginQuestion | null;
	/** The last question the learner answered or skipped: its right answer and whether he got it
	 *  right only as far as the lesson showed them to him. */
	lastAnswered: (PluginQuestion & { answer?: string; correct?: boolean }) | null;
	/** The teacher's last message, as text. */
	teacherMessage: string | null;
}

/** The tokens every surface shares, under their MCP Apps names. Each is read where the frame
 *  sits, so in a pop-up they are the pop-up's own. */
const SHARED_TOKENS: Record<string, string> = {
	"--color-background-tertiary": "--accent",
	"--color-text-primary": "--foreground",
	"--color-text-secondary": "--muted-foreground",
	"--color-text-tertiary": "--lh-ink-3",
	"--color-text-danger": "--destructive",
	"--color-text-success": "--lh-ans-right",
	"--color-border-primary": "--border",
	"--color-ring-primary": "--ring",
	"--font-sans": "--font-sans",
	"--font-mono": "--font-mono",
	"--border-radius-xs": "--radius",
	"--border-radius-sm": "--radius",
	"--border-radius-md": "--radius",
	"--border-radius-lg": "--radius",
};

/**
 * godspeed's tokens under their MCP Apps names, so a plugin's page matches what it sits on. On a
 * sheet (a space's tab) the background is the sheet and a well on it is the page color. In a
 * window hanging from the top bar (a lesson's) the page is made of the bar, as every pop-up is:
 * its background is the bar and a well on it the pop-up's well. The tone is a hovered row's.
 */
export function styleTokens(onBar: boolean): Record<string, string> {
	const surface = onBar
		? { "--color-background-primary": "--background", "--color-background-secondary": "--card", "--color-background-inverse": "--lh-bar-ink", "--color-text-inverse": "--lh-bar" }
		: { "--color-background-primary": "--lh-sheet", "--color-background-secondary": "--background", "--color-background-inverse": "--lh-bar", "--color-text-inverse": "--lh-bar-ink" };
	return { ...surface, ...SHARED_TOKENS };
}

/** A `@font-face` rule of the app's, and the address its relative URLs are read from. */
interface FontFaceText {
	css: string;
	base: string;
}

const BUILT_FONT = /^\/assets\/([\w.-]+\.woff2)$/;

/**
 * The app's `@font-face` rules for the families in `stack` (the `--font-sans` value), with each
 * built file at `/plugin-fonts/` on `localhost`, the one place a plugin's page may load the app's
 * fonts from, and each inlined one as it is. A rule with any other file is left out; so is every
 * rule in `npm run dev`, which serves the fonts unbuilt.
 */
export function hostFonts(rules: readonly FontFaceText[], stack: string, at: { origin: string; port: string }): string {
	const families = new Set(stack.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")));
	const shown: string[] = [];
	for (const rule of rules) {
		const family = /font-family:\s*(["']?)([^;"']+)\1/.exec(rule.css)?.[2]?.trim();
		if (!family || !families.has(family)) continue;
		let built = true;
		const css = rule.css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (whole: string, _quote: string, href: string) => {
			// A small font the build inlined travels in the rule itself.
			if (href.startsWith("data:font/")) return whole;
			const url = new URL(href, rule.base);
			const file = url.origin === at.origin ? BUILT_FONT.exec(url.pathname)?.[1] : undefined;
			if (!file) built = false;
			return `url("http://localhost:${at.port}/plugin-fonts/${file}")`;
		});
		if (built) shown.push(css);
	}
	return shown.join("\n");
}

/** The server and window calls the host tools make. */
export interface HostCalls {
	readStored(key: string): Promise<HostAnswer>;
	writeStored(key: string, value: unknown): Promise<HostAnswer>;
	askAgent(prompt: string, schema: unknown): Promise<HostAnswer>;
	readSpace(spaceId: string): Promise<HostAnswer>;
	/** Opens a web link in the browser; false when godspeed won't. */
	openLink(url: string): boolean;
}

interface BridgeOptions {
	manifest: PluginManifest;
	values: Record<string, SettingValue>;
	/** The frame's window, the only sender heard. */
	frame: () => unknown;
	post: (message: object) => void;
	/** Read when the plugin asks, so it is always the current one. */
	context: () => PluginContext;
	/** Theme, CSS variables and `@font-face` rules (hostFonts), read at initialize. */
	look: () => { theme: "light" | "dark"; variables: Record<string, string>; fonts: string };
	calls: HostCalls;
	/** The plugin finished the handshake. */
	onReady: () => void;
	/** The page's content height, from `ui/notifications/size-changed`; only where the frame is as tall as its page. */
	onSize?: (height: number) => void;
}

type Params = Record<string, unknown>;
type Id = string | number;
type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Params; isError?: true };

class RpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
	) {
		super(message);
	}
}

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INVALID_REQUEST = -32600;
const HOST_REFUSED = -32000;
/** A long ask_agent keeps the plugin's request open this often (the SDK gives up after 60 s without a word). */
const PROGRESS_EVERY_MS = 20_000;

const isObject = (value: unknown): value is Params => typeof value === "object" && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is Id => typeof value === "string" || (typeof value === "number" && Number.isFinite(value));

/** The message as JSON-RPC from the plugin, or null for anything else (answers included: the host asks nothing). */
function readMessage(data: unknown): { id?: Id; method: string; params: Params } | null {
	if (!isObject(data) || data.jsonrpc !== "2.0" || typeof data.method !== "string") return null;
	if (data.params !== undefined && !isObject(data.params)) return null;
	if ("id" in data && !isId(data.id)) return null;
	return { ...("id" in data ? { id: data.id as Id } : {}), method: data.method, params: (data.params as Params | undefined) ?? {} };
}

function toolResult(value: Params): ToolResult {
	return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function toolError(text: string): ToolResult {
	return { content: [{ type: "text", text }], isError: true };
}

const text = (params: Params, key: string): string => {
	const value = params[key];
	if (typeof value !== "string") throw new RpcError(INVALID_PARAMS, `${key} must be text.`);
	return value;
};

/** Listens to one plugin frame; `receive` takes each message event's source and data. */
export function createBridge(options: BridgeOptions) {
	const { manifest, calls } = options;
	let initialized = false;
	// The page may hear of changes once it said it is initialized.
	let ready = false;
	// What the page last got, to tell it only of real changes.
	let sentContext = "";
	let loads = 0;
	// After a navigation the frame holds another page: it hears nothing more, answers included.
	let stopped = false;
	const post = (message: object) => {
		if (!stopped) options.post(message);
	};

	// `needs`: the manifest's `uses` entry a tool asks for.
	const tools: Record<string, { needs?: "agent" | "space"; run: (args: Params, progressToken: Id | undefined) => Promise<ToolResult> }> = {
		get_context: { run: async () => toolResult({ ...options.context() }) },
		storage_get: {
			run: async (args) => {
				const got = await calls.readStored(text(args, "key"));
				return got.error === null ? toolResult({ value: got.value }) : toolError(got.error);
			},
		},
		storage_set: {
			run: async (args) => {
				if (!("value" in args)) throw new RpcError(INVALID_PARAMS, "Send { key, value }.");
				const set = await calls.writeStored(text(args, "key"), args.value);
				return set.error === null ? toolResult({}) : toolError(set.error);
			},
		},
		ask_agent: {
			needs: "agent",
			run: async (args, progressToken) => {
				const prompt = text(args, "prompt");
				let progress = 0;
				const timer =
					progressToken === undefined ? undefined : setInterval(() => post({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken, progress: ++progress } }), PROGRESS_EVERY_MS);
				try {
					const asked = await calls.askAgent(prompt, args.schema ?? {});
					return asked.error === null ? toolResult({ answer: asked.value }) : toolError(asked.error);
				} finally {
					clearInterval(timer);
				}
			},
		},
		read_space: {
			needs: "space",
			run: async () => {
				const space = options.context().space;
				if (!space) return toolError("No space is open.");
				const read = await calls.readSpace(space.id);
				return read.error === null ? toolResult(read.value as Params) : toolError(read.error);
			},
		},
	};

	const initializeResult = () => {
		const look = options.look();
		return {
			protocolVersion: PROTOCOL_VERSION,
			hostInfo: { name: "godspeed", version: process.env.LH_VERSION ?? "0" },
			hostCapabilities: { openLinks: {}, serverTools: {} },
			hostContext: {
				theme: look.theme,
				styles: look.fonts ? { variables: look.variables, css: { fonts: look.fonts } } : { variables: look.variables },
				displayMode: "inline",
				availableDisplayModes: ["inline"],
				platform: "desktop",
				locale: navigator.language,
				timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				// The plugin's own setting values, by setting key.
				settings: { ...options.values },
			},
		};
	};

	async function answer(method: string, params: Params): Promise<unknown> {
		if (method === "ping") return {};
		if (method === "ui/initialize") {
			initialized = true;
			sentContext = JSON.stringify(options.context());
			return initializeResult();
		}
		if (!initialized) throw new RpcError(INVALID_REQUEST, "Send ui/initialize first.");
		if (method === "ui/open-link") {
			const url = text(params, "url");
			if (!/^https?:\/\//i.test(url) || !URL.canParse(url)) throw new RpcError(INVALID_PARAMS, "godspeed opens http and https links only.");
			if (!calls.openLink(url)) throw new RpcError(HOST_REFUSED, "godspeed opens a link only after a click in the plugin.");
			return {};
		}
		if (method === "tools/call") {
			const name = text(params, "name");
			const tool = Object.hasOwn(tools, name) ? tools[name] : undefined;
			if (!tool) throw new RpcError(INVALID_PARAMS, `godspeed has no tool ${name}.`);
			if (tool.needs && !manifest.uses.includes(tool.needs)) throw new RpcError(INVALID_PARAMS, `${name} needs "${tool.needs}" in the manifest's uses.`);
			if (params.arguments !== undefined && !isObject(params.arguments)) throw new RpcError(INVALID_PARAMS, "arguments must be an object.");
			const meta = params._meta;
			const progressToken = isObject(meta) && isId(meta.progressToken) ? meta.progressToken : undefined;
			return tool.run((params.arguments as Params | undefined) ?? {}, progressToken);
		}
		throw new RpcError(METHOD_NOT_FOUND, `godspeed doesn't handle ${method}.`);
	}

	function notice(method: string, params: Params) {
		if (method === "ui/notifications/initialized" && initialized) {
			ready = true;
			options.onReady();
		}
		// The width is the host's to set; only the height follows the page.
		if (method === "ui/notifications/size-changed" && initialized && typeof params.height === "number" && Number.isFinite(params.height) && params.height >= 0) options.onSize?.(params.height);
	}

	return {
		/** The frame loaded a page. Only its first page is the plugin's entry: a later load means
		 *  it navigated, so the bridge stops; false then. */
		loaded(): boolean {
			loads += 1;
			if (loads > 1) stopped = true;
			return !stopped;
		},
		/** Tells the page when what get_context gives changed since it last heard:
		 *  `ui/notifications/host-context-changed` with empty params, so it reads it again. */
		changed() {
			if (!ready || stopped) return;
			const context = JSON.stringify(options.context());
			if (context === sentContext) return;
			sentContext = context;
			post({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: {} });
		},
		receive(source: unknown, data: unknown) {
			if (stopped || source === null || source === undefined || source !== options.frame()) return;
			const message = readMessage(data);
			if (!message) return;
			const { id, method, params } = message;
			if (id === undefined) {
				notice(method, params);
				return;
			}
			answer(method, params).then(
				(result) => post({ jsonrpc: "2.0", id, result }),
				(err: unknown) => {
					const error = err instanceof RpcError ? { code: err.code, message: err.message } : { code: HOST_REFUSED, message: "godspeed couldn't do that." };
					post({ jsonrpc: "2.0", id, error });
				},
			);
		},
	};
}
