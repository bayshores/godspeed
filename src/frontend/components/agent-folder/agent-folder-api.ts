/** The godspeed folder on the server, and the agent that runs the lessons. */
import { isFolderAgent, type FolderAgent } from "@/shared/core";
import { jsonInit, send, serverError } from "@/frontend/lib/api";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import type { FolderView } from "./agent-folder-model";

/** Where an older godspeed kept the agent last started, in the window. */
const OLD_AGENT_KEY = "lh-folder-agent";
const UNREACHABLE = "Couldn't reach godspeed. Try again.";

async function changeFolder(method: "POST" | "PATCH", body: object): Promise<FolderView> {
	const { error, body: answer } = await send("/api/agent-folder", jsonInit(method, body));
	if (error) throw new Error(serverError(answer) ?? UNREACHABLE);
	return answer as FolderView;
}

export const postAgentFolder = (body: object): Promise<FolderView> => changeFolder("POST", body);

/** The agent that runs the lessons, picked; the folder as it is then. */
export const pickAgent = (agent: FolderAgent): Promise<FolderView> => changeFolder("PATCH", { agent });

/** The agent an older godspeed kept in the window goes to the server once, with `pick`, and
 *  leaves the window; the server's is the only one from then on. A send that fails keeps it for
 *  the next start. */
export async function sendOldAgent(pick: (agent: FolderAgent) => Promise<unknown>): Promise<void> {
	const old = readStorage(OLD_AGENT_KEY);
	if (isFolderAgent(old)) await pick(old);
	if (old !== null) writeStorage(OLD_AGENT_KEY, null);
}
