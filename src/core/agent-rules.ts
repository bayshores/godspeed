/**
 * Teaching rules an agent saved on its own: where each lives (a teaching
 * area's list, for every lesson, or one class's list) and when it was
 * saved. The rules themselves stay in those lists; this record only marks
 * which ones an agent wrote, so the window can say so. Editing a rule
 * changes its text, so it no longer matches and becomes the learner's.
 * Browser-safe.
 */
import { isClassId } from "./contracts/class.ts";
import { TEACHING_AREAS, type AreaId } from "./teaching-areas.ts";

export type RuleWhere = { area: AreaId } | { classId: string };

export interface SavedRule {
	where: RuleWhere;
	text: string;
	/** ISO time it was saved. */
	at: string;
}

const AREA_IDS = new Set<string>(TEACHING_AREAS.map((a) => a.id));

/** A rule location from untrusted input, or null. */
export function parseWhere(raw: unknown): RuleWhere | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as { area?: unknown; classId?: unknown };
	if (typeof r.area === "string" && AREA_IDS.has(r.area)) return { area: r.area as AreaId };
	if (isClassId(r.classId)) return { classId: r.classId };
	return null;
}

export function sameWhere(a: RuleWhere, b: RuleWhere): boolean {
	return "area" in a ? "area" in b && a.area === b.area : "classId" in b && a.classId === b.classId;
}

/** The saved-rules file's list, made safe to use. */
export function parseSavedRules(raw: unknown): SavedRule[] {
	const list = (raw as { rules?: unknown } | null)?.rules;
	if (!Array.isArray(list)) return [];
	const out: SavedRule[] = [];
	for (const entry of list) {
		const e = entry as { where?: unknown; text?: unknown; at?: unknown };
		const where = parseWhere(e?.where);
		if (where && typeof e.text === "string" && e.text && typeof e.at === "string") out.push({ where, text: e.text, at: e.at });
	}
	return out;
}

/** Who the rule is for, after "Saved a rule for": "every lesson" or the class name. */
export function ruleFor(where: RuleWhere, className?: string): string {
	return "classId" in where ? (className ?? "this class") : "every lesson";
}

/** Where a rule lives, in words: "Every lesson, under Teaching" or "Lessons in CSE 21". */
export function whereLabel(where: RuleWhere, className?: string): string {
	if ("classId" in where) return `Lessons in ${className ?? "this class"}`;
	return `Every lesson, under ${TEACHING_AREAS.find((a) => a.id === where.area)?.label ?? "Teaching"}`;
}

/** The saved time of each agent-saved rule in one list, by rule text. */
export function savedTimes(saved: SavedRule[], where: RuleWhere): Record<string, string> {
	const out: Record<string, string> = {};
	for (const s of saved) if (sameWhere(s.where, where)) out[s.text] = s.at;
	return out;
}

/** What a lesson's save_rule call returns (the chat line reads it). */
export interface SaveRuleResult {
	saved: true;
	rule: string;
	/** "every lesson" or the class name. */
	for: string;
	where: RuleWhere;
	note: string;
}

/** A save_rule output from the transcript, or null (a refusal is a string). */
export function parseSaveRuleResult(raw: unknown): SaveRuleResult | null {
	const r = raw as Partial<SaveRuleResult> | null;
	if (!r || typeof r !== "object" || r.saved !== true || typeof r.rule !== "string" || typeof r.for !== "string") return null;
	const where = parseWhere(r.where);
	return where ? { saved: true, rule: r.rule, for: r.for, where, note: typeof r.note === "string" ? r.note : "" } : null;
}
