import { isSubscriptionProvider, subscriptionConnected } from "../agent/subscription-connections.ts";
import { AGENT_PROVIDER } from "../agent/agent-bridge.ts";
import { readMcpToken } from "../store/mcp-token.ts";

/**
 * THE CONNECTION GATE'S TRUTH (API keys removed — subscriptions only): a
 * model provider can run only when it is a CONNECTED subscription
 * (ChatGPT, GitHub Copilot, Grok). Every other pi-ai catalog provider has
 * no way to authenticate in this app, so it is never connected — the turn
 * gate, the job runner, and the extraction pipeline all refuse it with the
 * provider_not_connected envelope instead of dying mid-stream.
 *
 * Test seam: suites that drive the turn composition with scripted engines
 * pin a catalog provider (e.g. "openrouter") and mark it connected here.
 * Production never calls connectProviderForTests. The set lives on
 * globalThis so every module instance (dynamic imports in tests) shares it.
 */
const TEST_CONNECTED = Symbol.for("lh.testConnectedProviders");

function testConnected(): Set<string> {
	const g = globalThis as Record<symbol, Set<string> | undefined>;
	if (!g[TEST_CONNECTED]) g[TEST_CONNECTED] = new Set();
	return g[TEST_CONNECTED];
}

export function providerConnected(provider: string): boolean {
	if (isSubscriptionProvider(provider)) return subscriptionConnected(provider);
	// The outside agent counts as connected while agent access is on
	// (Settings → Outside agents); its requests then wait for the agent to poll.
	if (provider === AGENT_PROVIDER) return readMcpToken() !== null;
	return testConnected().has(provider);
}

/** Tests only: treat a non-subscription catalog provider as connected
 *  (returns the undo). */
export function connectProviderForTests(provider: string): () => void {
	testConnected().add(provider);
	return () => {
		testConnected().delete(provider);
	};
}
