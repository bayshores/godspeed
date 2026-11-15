import { useEffect, useRef, useState } from "react";
import { LoadFailed } from "@/frontend/components/load-failed";
import { askAgent, readSpace, readStored, writeStored } from "@/frontend/lib/plugin-host-api";
import type { PluginManifest, SettingValue } from "@/frontend/lib/plugins-api";
import { cn } from "@/frontend/lib/utils";
import { createBridge, type PluginContext } from "./plugin-frame-model";

/** A page that hasn't finished the handshake by then didn't load. */
const READY_WITHIN_MS = 10_000;
/** A change is told once things hold still this long, so a streaming reply is one notice, not one per word. */
const NOTICE_AFTER_MS = 500;

/** godspeed's tokens under their MCP Apps names, so a plugin can match the app. */
const STYLE_VARIABLES: Record<string, string> = {
	"--color-background-primary": "--background",
	"--color-background-secondary": "--card",
	"--color-background-tertiary": "--accent",
	"--color-background-inverse": "--lh-bar",
	"--color-text-primary": "--foreground",
	"--color-text-secondary": "--muted-foreground",
	"--color-text-tertiary": "--lh-ink-3",
	"--color-text-inverse": "--lh-bar-ink",
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

function look() {
	const root = document.documentElement;
	const css = getComputedStyle(root);
	const variables: Record<string, string> = {};
	for (const [name, token] of Object.entries(STYLE_VARIABLES)) {
		const value = css.getPropertyValue(token).trim();
		if (value) variables[name] = value;
	}
	return { theme: root.classList.contains("dark") ? ("dark" as const) : ("light" as const), variables };
}

/** At `localhost` on the window's port: the window is on 127.0.0.1, the only host the shell's
 *  Tauri capabilities name, so the frame can't pass Tauri's capability check. */
function pluginEntryUrl(manifest: PluginManifest): string {
	return `http://localhost:${location.port}/plugin-files/${encodeURIComponent(manifest.id)}/${manifest.entry.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * A plugin's page, filling the box it is placed in. The page runs in a frame sandboxed without
 * allow-same-origin, so it has an opaque origin: no /api, no window, no cookies, no storage. It
 * reaches godspeed only by MCP Apps messages (plugin-frame-model.ts).
 */
export function PluginFrame({ manifest, values, context, className }: { manifest: PluginManifest; values: Record<string, SettingValue>; context: PluginContext; className?: string }) {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const bridgeRef = useRef<ReturnType<typeof createBridge> | null>(null);
	// The bridge reads these when the plugin asks, so a new render never restarts it.
	const latest = useRef({ manifest, values, context });
	latest.current = { manifest, values, context };
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
	const id = manifest.id;

	useEffect(() => {
		const bridge = createBridge({
			manifest: latest.current.manifest,
			values: latest.current.values,
			frame: () => frameRef.current?.contentWindow,
			// The frame's origin is opaque, so it can't be named; the window is this frame's own.
			post: (message) => frameRef.current?.contentWindow?.postMessage(message, "*"),
			context: () => latest.current.context,
			look,
			calls: {
				readStored: (key) => readStored(id, key),
				writeStored: (key, value) => writeStored(id, key, value),
				askAgent: (prompt, schema) => askAgent(id, prompt, schema),
				readSpace,
				openLink: (url) => {
					// Only while the learner is in the plugin, so a page can't open the browser by itself.
					if (document.activeElement !== frameRef.current) return false;
					if (window.lh?.openLink) void window.lh.openLink(url);
					else window.open(url, "_blank", "noopener,noreferrer");
					return true;
				},
			},
			onReady: () => setState("ready"),
		});
		bridgeRef.current = bridge;
		const onMessage = (event: MessageEvent) => bridge.receive(event.source, event.data);
		window.addEventListener("message", onMessage);
		const timer = setTimeout(() => setState((now) => (now === "ready" ? now : "failed")), READY_WITHIN_MS);
		return () => {
			window.removeEventListener("message", onMessage);
			clearTimeout(timer);
		};
	}, [id, attempt]);

	// Compared as values: a new object with the same contents is no change.
	const contextKey = JSON.stringify(context);
	useEffect(() => {
		const timer = setTimeout(() => bridgeRef.current?.changed(), NOTICE_AFTER_MS);
		return () => clearTimeout(timer);
	}, [contextKey]);

	if (state === "failed") {
		return (
			<LoadFailed
				message={`${manifest.name} didn't load.`}
				onRetry={() => {
					setState("loading");
					setAttempt((n) => n + 1);
				}}
				className={className}
			/>
		);
	}
	return (
		<iframe
			key={attempt}
			ref={frameRef}
			title={manifest.name}
			// allow-scripts only: never allow-same-origin, which would give the page the app's origin.
			sandbox="allow-scripts"
			src={pluginEntryUrl(manifest)}
			// A second load is the page navigating away from the plugin's entry.
			onLoad={() => {
				if (bridgeRef.current?.loaded() === false) setState("failed");
			}}
			data-testid="plugin-frame"
			data-state={state}
			className={cn("block h-full w-full border-0", state === "loading" && "invisible", className)}
		/>
	);
}
