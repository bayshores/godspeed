/**
 * The setup card's words, from what the server found (GET /api/agent/health): the rows of the full
 * card, the one sentence of the compact card and the strip's peek, and whether the agent can run.
 * The server decides each state; this only words it. Pure.
 */
import type { AgentHealth, AgentProblem, AgentUpdate } from "@/shared/core";
import { AGENT_LABEL } from "@/frontend/components/agent-folder/agent-folder-model";

/** The row's mark: a tick once passed, a highlighter square while it needs the learner, the square
 *  breathing while it waits on the browser, the spinner while it is found out, nothing before. */
type Mark = "tick" | "need" | "wait" | "busy" | "none";

/** A key on a row. `open`: a page outside godspeed. */
export type RowKey =
	| { kind: "open"; label: string; href: string }
	| { kind: "login"; label: string }
	| { kind: "cancel" }
	| { kind: "update"; label: string }
	| { kind: "check" };

export interface CardRow {
	id: "version" | "account" | "own";
	name: string;
	mark: Mark;
	fact: string | null;
	/** Why, in the fact's hover tip. */
	tip: string | null;
	/** At the row's end. */
	keys: RowKey[];
	/** Said where a key would be: "Updated". */
	note: string | null;
	/** Under the row while a sign-in waits on the browser: the code field (Claude Code's) and its keys. */
	signing: { code: boolean; keys: RowKey[] } | null;
	/** Under a failed update: the command the learner can run in Terminal. */
	run: string | null;
}

const row = (id: CardRow["id"], name: string, mark: Mark, more: Partial<CardRow> = {}): CardRow => ({ id, name, mark, fact: null, tip: null, keys: [], note: null, signing: null, run: null, ...more });

const VERSION_CHECKS = new Set(["installed", "node", "upToDate", "helper"]);
const CHECK_AGAIN: RowKey = { kind: "check" };

type Failure = NonNullable<AgentHealth["failing"]>;

/** What a failed version check says and the key that fixes it; an update that runs or failed
 *  speaks in a too old agent's place. */
function versionFailed(f: Failure, update: AgentUpdate | null): Partial<CardRow> {
	const open = (label: string) => (f.link ? [{ kind: "open", label, href: f.link } as const] : []);
	switch (f.problem) {
		case "notInstalled":
			return { fact: "Not installed", keys: open("Get it") };
		case "tooOld":
			if (update?.state === "failed") return { fact: "Update didn't finish", tip: update.line, keys: [{ kind: "update", label: "Try again" }], run: update.command };
			return { fact: f.needs ? `Too old, needs ${f.needs}` : "Too old", keys: [{ kind: "update", label: "Update" }] };
		case "noNode":
			return { fact: f.needs ? `Needs Node.js ${f.needs} or newer` : "Needs a newer Node.js", keys: open("Get Node.js") };
		case "noHelper":
			return { fact: "A part of godspeed is missing", keys: open("Reinstall godspeed") };
		default:
			return { fact: "Couldn't check", tip: f.reason, keys: [CHECK_AGAIN] };
	}
}

/** What a failed sign-in check says and the key that fixes it. */
function accountFailed(f: Failure, login: AgentHealth["login"]): Partial<CardRow> {
	if (login && "failed" in login) return { fact: "Login didn't finish", tip: login.failed, keys: [{ kind: "login", label: "Try again" }] };
	switch (f.problem) {
		case "signedOut":
			return { keys: [{ kind: "login", label: "Log in" }] };
		case "billsByUse":
			return { fact: "Console account, billed by use", keys: [{ kind: "login", label: "Log in with your plan" }] };
		case "freeAccount":
			return { fact: "Free account; teaching needs Pro or Max", keys: f.link ? [{ kind: "open", label: "See plans", href: f.link }] : [] };
		default:
			return { fact: "Couldn't check", tip: f.reason, keys: [CHECK_AGAIN] };
	}
}

/** The first of `checks` that failed, with why. */
function failureOf(h: AgentHealth, checks: (check: string) => boolean): Failure | null {
	const found = h.checks.find((c) => checks(c.check) && c.failure);
	if (found?.failure) return { check: found.check, ...found.failure };
	return h.failing && checks(h.failing.check) ? h.failing : null;
}

/** The card's rows: Version and Account, or one "Own start command" row for the learner's own
 *  command. Before the first answer the rows are blank with the spinner on the first. */
export function cardRows(h: AgentHealth | null, update: AgentUpdate | null): CardRow[] {
	const first = !answered(h);
	if (h?.ownCommand) {
		if (first) return [row("own", "Own start command", "busy")];
		const f = failureOf(h, (check) => VERSION_CHECKS.has(check));
		return [f ? row("own", "Own start command", "need", versionFailed(f, update)) : row("own", "Own start command", "tick")];
	}
	if (first) return [row("version", "Version", "busy"), row("account", "Account", "none")];

	const installed = h.checks.find((c) => c.check === "installed");
	const version = failureOf(h, (check) => VERSION_CHECKS.has(check));
	const versionRow =
		update?.state === "running"
			? row("version", "Version", "busy", { fact: "Updating" })
			: // Until the check after it has read the new version.
				update?.state === "done" && version?.problem === "tooOld"
				? row("version", "Version", "busy", { fact: "Updated" })
				: version
				? row("version", "Version", "need", versionFailed(version, update))
				: installed?.state === "passed"
					? row("version", "Version", "tick", { fact: installed.fact, note: update?.state === "done" ? "Updated" : null })
					: row("version", "Version", h.checking ? "busy" : "none");

	const loggedIn = h.checks.find((c) => c.check === "loggedIn");
	const account = failureOf(h, (check) => check === "loggedIn");
	const login = h.login;
	const accountRow =
		login && "url" in login
			? row("account", "Account", "wait", {
					fact: "Finish in your browser",
					signing: { code: login.code, keys: [{ kind: "open", label: "Open again", href: login.url }, { kind: "cancel" }] },
				})
			: account
				? row("account", "Account", "need", accountFailed(account, login))
				: loggedIn?.state === "passed"
					? row("account", "Account", "tick", { fact: loggedIn.fact })
					: row("account", "Account", "none");
	return [versionRow, accountRow];
}

/** A check has answered for the picked agent; before that it may or may not run. */
export const answered = (h: AgentHealth | null): h is AgentHealth => !!h && !(h.checking && h.checks.every((c) => c.state === "unchecked"));

/** The agent can't run: a check failed, so a send would fail too. */
export const cantRun = (h: AgentHealth | null): boolean => !!h?.failing;

/** The model select shows once every check passed. */
export const ready = (h: AgentHealth | null): boolean => !!h && !h.failing && h.checks.length > 0 && h.checks.every((c) => c.state === "passed");

/** The compact card's sentence, which names the agent since no picker stands beside it. */
const SENTENCE: Record<AgentProblem, (agent: string, needs: string | null) => string> = {
	notInstalled: (agent) => `${agent} isn't installed.`,
	tooOld: (agent) => `${agent} is too old.`,
	noNode: (agent, needs) => (needs ? `${agent} needs Node.js ${needs} or newer.` : `${agent} needs a newer Node.js.`),
	signedOut: (agent) => `${agent} isn't logged in.`,
	billsByUse: (agent) => `${agent} is billed by use.`,
	freeAccount: (agent) => `${agent} needs Pro or Max.`,
	noHelper: () => "A part of godspeed is missing.",
	failed: (agent) => `godspeed couldn't check ${agent}.`,
};

/** The compact card and the peek's row: why the agent can't run, in one sentence, and the row
 *  that fixes it; once Log in was pressed, what to do now. Null while it can run. */
export function compact(h: AgentHealth | null, update: AgentUpdate | null): { sentence: string; row: CardRow } | null {
	const f = h?.failing;
	if (!h || !f) return null;
	const rows = cardRows(h, update);
	const fixes = rows.find((r) => (h.ownCommand ? r.id === "own" : f.check === "loggedIn" ? r.id === "account" : r.id === "version")) ?? rows[0]!;
	return { sentence: fixes.signing ? "Finish in your browser." : SENTENCE[f.problem](AGENT_LABEL[h.agent], f.needs), row: fixes };
}
