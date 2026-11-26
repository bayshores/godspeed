/**
 * The picked agent's setup (GET /api/agent/health): each check the server ran, the first that
 * failed, its sign-in and its update. The server decides every state; the setup card words them.
 */
import type { FolderAgent } from "../agent-folder.ts";
import { isRecord } from "../is-record.ts";

/** The server's checks, in the card's order. `helper` is godspeed's own part and has no row. */
const AGENT_CHECKS = ["installed", "node", "upToDate", "loggedIn", "helper"] as const;
type AgentCheck = (typeof AGENT_CHECKS)[number];

/** Why a check failed. `failed`: the check itself could not run; `reason` says why. */
const AGENT_PROBLEMS = ["notInstalled", "noNode", "tooOld", "signedOut", "billsByUse", "freeAccount", "noHelper", "failed"] as const;
export type AgentProblem = (typeof AGENT_PROBLEMS)[number];

/** `unchecked`: an earlier check failed in a way that leaves it nothing to ask, or none ran yet. */
const CHECK_STATES = ["passed", "failed", "unchecked"] as const;
type CheckState = (typeof CHECK_STATES)[number];

/** An update runs, has just finished (told, never kept), or failed. */
const UPDATE_STATES = ["running", "done", "failed"] as const;

export interface AgentUpdate {
	state: (typeof UPDATE_STATES)[number];
	/** The last line it printed, or why it stopped. */
	line: string | null;
	/** What it runs, which the learner can also run in a terminal. */
	command: string;
}

/** Why a check failed: the version it `needs` and the page (`link`) that fixes it, where there is one. */
interface Failure {
	problem: AgentProblem;
	reason: string | null;
	needs: string | null;
	link: string | null;
}

export interface AgentHealth {
	agent: FolderAgent;
	/** A check runs now. */
	checking: boolean;
	/** The learner starts the agent with their own command, which is asked nothing. */
	ownCommand: boolean;
	/** `fact`: the version found, or the plan's words. */
	checks: { check: AgentCheck; state: CheckState; fact: string | null; failure: Failure | null }[];
	/** The first check that failed. */
	failing: ({ check: AgentCheck } & Failure) | null;
	/** A sign-in running (its page, and whether it takes a code) or failed (why). */
	login: { url: string; code: boolean } | { failed: string } | null;
	update: AgentUpdate | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const oneOf = <T extends string>(names: readonly T[], v: unknown): T | null => (names.includes(v as T) ? (v as T) : null);

/** The `agent-update` event's payload, or the health answer's `update`; null when it is not one. */
export function readAgentUpdate(raw: unknown): AgentUpdate | null {
	if (!isRecord(raw)) return null;
	const state = oneOf(UPDATE_STATES, raw.state);
	const command = text(raw.command);
	return state && command ? { state, line: text(raw.line), command } : null;
}

function readLogin(raw: unknown): AgentHealth["login"] {
	if (!isRecord(raw)) return null;
	const url = text(raw.url);
	if (url) return { url, code: raw.code === true };
	const failed = text(raw.failed);
	return failed ? { failed } : null;
}

function readFailure(raw: Record<string, unknown>): Failure | null {
	const problem = oneOf(AGENT_PROBLEMS, raw.problem);
	return problem && { problem, reason: text(raw.reason), needs: text(raw.needs), link: text(raw.link) };
}

/** The answer made safe to use; null when it is not one. */
export function readAgentHealth(raw: unknown): AgentHealth | null {
	if (!isRecord(raw) || (raw.agent !== "claude" && raw.agent !== "codex") || !Array.isArray(raw.checks)) return null;
	const checks = raw.checks.flatMap((c): AgentHealth["checks"] => {
		if (!isRecord(c)) return [];
		const check = oneOf(AGENT_CHECKS, c.check);
		const state = oneOf(CHECK_STATES, c.state);
		return check && state ? [{ check, state, fact: text(c.fact), failure: readFailure(c) }] : [];
	});
	const f = raw.failing;
	const check = isRecord(f) ? oneOf(AGENT_CHECKS, f.check) : null;
	const failure = isRecord(f) ? readFailure(f) : null;
	const failing = check && failure ? { check, ...failure } : null;
	return {
		agent: raw.agent,
		checking: raw.checking === true,
		ownCommand: raw.ownCommand === true,
		checks,
		failing,
		login: readLogin(raw.login),
		update: readAgentUpdate(raw.update),
	};
}
