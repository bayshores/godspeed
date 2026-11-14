/** The godspeed folder on the server, and the agent last started here. */
import type { FolderAgent } from "@/shared/core";
import type { FolderView } from "./agent-folder-model";

const AGENT_KEY = "lh-folder-agent";
const UNREACHABLE = "Couldn't reach godspeed. Try again.";

export async function postAgentFolder(body: object): Promise<FolderView> {
	let res: Response;
	try {
		res = await fetch("/api/agent-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	} catch {
		throw new Error(UNREACHABLE);
	}
	const json = (await res.json().catch(() => ({}))) as FolderView & { error?: string };
	if (!res.ok) throw new Error(json.error ?? UNREACHABLE);
	return json;
}

/** The last agent started from this window; null when none was. */
export function savedAgent(): string | null {
	try {
		return localStorage.getItem(AGENT_KEY);
	} catch {
		return null;
	}
}

export function saveAgent(agent: FolderAgent): void {
	try {
		localStorage.setItem(AGENT_KEY, agent);
	} catch {
		/* remembering is a convenience */
	}
}
