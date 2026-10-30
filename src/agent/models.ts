import type { Api, Model, StreamFunction } from "@earendil-works/pi-ai";
import packageMetadata from "../../package.json" with { type: "json" };
import { agentModel, agentStream } from "./agent-bridge.ts";

/** App identity is immutable and shared by every native Agent.
 * Agent's default Pi attribution otherwise overrides it. */
export const APP_IDENTITY = Object.freeze({
	userAgent: Object.freeze({ custom: `godspeed/${packageMetadata.version}` }),
	attribution: Object.freeze({ name: packageMetadata.name, url: packageMetadata.homepage }),
});

/**
 * An "engine" is the model + the stream function an agent loop runs on —
 * the two things a test fake replaces.
 *
 * There is one production engine: the outside agent. Its stream parks
 * every request as a work item that the agent connected over /api/mcp picks
 * up and answers (src/agent/agent-bridge.ts). The agent chooses its own
 * model and effort in its own harness.
 */
export interface PiEngine {
	model: Model<Api>;
	streamFn: StreamFunction;
}

/** The outside-agent engine every lesson, job and pipeline stage runs on. */
export function agentEngine(): PiEngine {
	return { model: agentModel(), streamFn: agentStream };
}
