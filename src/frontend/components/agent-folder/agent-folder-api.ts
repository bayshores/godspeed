/** The godspeed folder on the server, and the agent last started here. */
import type { FolderAgent } from "@/shared/core";
import { jsonInit, send, serverError } from "@/frontend/lib/api";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import type { FolderView } from "./agent-folder-model";

const AGENT_KEY = "lh-folder-agent";
const UNREACHABLE = "Couldn't reach godspeed. Try again.";

export async function postAgentFolder(body: object): Promise<FolderView> {
	const { error, body: answer } = await send("/api/agent-folder", jsonInit("POST", body));
	if (error) throw new Error(serverError(answer) ?? UNREACHABLE);
	return answer as FolderView;
}

/** The last agent started from this window; null when none was. */
export function savedAgent(): string | null {
	return readStorage(AGENT_KEY);
}

export function saveAgent(agent: FolderAgent): void {
	// Remembering is a convenience.
	writeStorage(AGENT_KEY, agent);
}
