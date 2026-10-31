/**
 * Teaching rules an agent saves on its own. The rule goes into the same
 * list the learner edits (Settings → Teaching for every lesson, Edit class
 * for one class); data/agent-rules.json only marks it as the agent's.
 * The learner can undo or edit it from the chat, the notice or Settings.
 */
import { emit } from "../core/events.ts";
import { ruleFor, sameWhere, whereLabel, type RuleWhere, type SavedRule } from "../core/agent-rules.ts";
import { CURRENT_SETTINGS_VERSION } from "../core/settings.ts";
import { oneLine, RULE_MAX_CHARS, RULES_MAX } from "../core/teaching-areas.ts";
import { readSavedRules, writeSavedRules } from "../store/agent-rules.ts";
import { stores } from "./stores.ts";

type RuleOutcome = { ok: true; rule: string; for: string; where: string } | { ok: false; error: string };

function className(where: RuleWhere): string | undefined {
	return "classId" in where ? stores.classStore.getClass(where.classId)?.name : undefined;
}

/** The rule list at `where`, or null for a class that doesn't exist. */
function readList(where: RuleWhere): string[] | null {
	if ("classId" in where) {
		const record = stores.classStore.getClass(where.classId);
		return record ? (record.rules ?? []) : null;
	}
	return stores.settingsStore.readSettings()?.agent?.rules?.[where.area] ?? [];
}

function writeList(where: RuleWhere, rules: string[]): void {
	if ("classId" in where) {
		stores.classStore.updateClass(where.classId, { rules });
		return;
	}
	const record = stores.settingsStore.readSettings() ?? { version: CURRENT_SETTINGS_VERSION };
	const areaRules = { ...record.agent?.rules };
	if (rules.length) areaRules[where.area] = rules;
	else delete areaRules[where.area];
	stores.settingsStore.writeSettings({ ...record, agent: { ...record.agent, rules: areaRules } });
}

/** Every mark except the one for `text` at `where`. */
function others(saved: SavedRule[], where: RuleWhere, text: string): SavedRule[] {
	return saved.filter((s) => !(s.text === text && sameWhere(s.where, where)));
}

function unmark(where: RuleWhere, text: string): void {
	const saved = readSavedRules();
	const kept = others(saved, where, text);
	if (kept.length !== saved.length) writeSavedRules(kept);
}

/** Save a rule for the learner. With `agent` (an outside agent's name, from
 *  the terminal) the window shows a notice; a lesson shows it in the chat. */
export function saveRuleByAgent(text: string, where: RuleWhere, agent?: string): RuleOutcome {
	const rule = oneLine(text, RULE_MAX_CHARS);
	if (!rule) return { ok: false, error: `A rule is one line of 1 to ${RULE_MAX_CHARS} characters.` };
	const list = readList(where);
	if (!list) return { ok: false, error: "No such class." };
	const name = className(where);
	const saved = { ok: true as const, rule, for: ruleFor(where, name), where: whereLabel(where, name) };
	// The learner already has it: nothing to save or mark.
	if (list.includes(rule)) return saved;
	if (list.length >= RULES_MAX) {
		return { ok: false, error: `${saved.where} already has ${RULES_MAX} rules, the most it can hold. Tell the learner, and ask which one to remove in Settings.` };
	}
	writeList(where, [...list, rule]);
	// A stale mark from a rule the learner removed in Settings is replaced, not doubled.
	writeSavedRules([...others(readSavedRules(), where, rule), { where, text: rule, at: new Date().toISOString() }]);
	emit("rules-changed", agent ? { saved: { text: rule, where, label: saved.where, agent } } : {});
	return saved;
}

/** Undo: take the rule out of its list. False when it isn't there. */
export function removeRule(where: RuleWhere, text: string): boolean {
	const list = readList(where);
	if (!list?.includes(text)) return false;
	writeList(where, list.filter((r) => r !== text));
	unmark(where, text);
	emit("rules-changed", {});
	return true;
}

/** Rewrite a rule in place. It becomes the learner's, so the mark goes. */
export function editRule(where: RuleWhere, text: string, newText: string): RuleOutcome {
	const rule = oneLine(newText, RULE_MAX_CHARS);
	if (!rule) return { ok: false, error: `A rule is one line of 1 to ${RULE_MAX_CHARS} characters.` };
	const list = readList(where);
	const at = list?.indexOf(text) ?? -1;
	if (!list || at < 0) return { ok: false, error: "That rule was removed." };
	if (rule !== text && list.includes(rule)) return { ok: false, error: "You already have that rule." };
	writeList(where, list.map((r, i) => (i === at ? rule : r)));
	unmark(where, text);
	emit("rules-changed", {});
	const name = className(where);
	return { ok: true, rule, for: ruleFor(where, name), where: whereLabel(where, name) };
}

/** The agent-saved rules that are still in their lists. Marks for rules the
 *  learner removed or rewrote in Settings are dropped here. */
export function agentSavedRules(): SavedRule[] {
	const saved = readSavedRules();
	const kept = saved.filter((s) => readList(s.where)?.includes(s.text));
	if (kept.length !== saved.length) writeSavedRules(kept);
	return kept;
}
