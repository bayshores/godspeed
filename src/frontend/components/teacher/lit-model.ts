/**
 * The things the teacher changed that stay lit: each target's key ("deadline:ddl_1") with the
 * page it was lit on. One style rule per key lights every element tagged with it, so a row drawn
 * again keeps its mark. A mark leaves when the pointer goes over it, when the learner is on
 * another page, or when the next round of work begins: it fades out first (`leaving`), then goes.
 * Pure.
 */

export interface LitMark {
	page: string;
	leaving: boolean;
}

export type Lit = ReadonlyMap<string, LitMark>;

/** These keys light up on `page`, again too when one was leaving. */
export function lightUp(lit: Lit, keys: readonly string[], page: string): Lit {
	if (keys.length === 0) return lit;
	const next = new Map(lit);
	for (const key of keys) next.set(key, { page, leaving: false });
	return next;
}

/** Every mark `keep` turns down starts to leave; the same map when none does. */
export function letGo(lit: Lit, keep: (key: string, mark: LitMark) => boolean): Lit {
	const going = [...lit].filter(([key, mark]) => !mark.leaving && !keep(key, mark));
	if (going.length === 0) return lit;
	const next = new Map(lit);
	for (const [key, mark] of going) next.set(key, { ...mark, leaving: true });
	return next;
}

/** The marks that have faded out are gone. */
export function dropLeft(lit: Lit): Lit {
	return [...lit.values()].some((m) => m.leaving) ? new Map([...lit].filter(([, m]) => !m.leaving)) : lit;
}

/** The 2-point edge, then the tint over the whole face. Both are inset shadows, which lie over a
 *  face drawn as background images (a sheet) as well as a plain one, and ease where colors would not. */
const MARK = "inset 2px 0 0 var(--lh-tint),inset 0 0 0 100vmax color-mix(in srgb, var(--lh-tint) 16%, transparent)";

/** One rule per mark, the selector's value passed through `escape` (CSS.escape in the page): a lit
 *  one has the edge and the tint and fades them in; a leaving one fades back to its own look. */
export function litRules(lit: Lit, escape: (value: string) => string): string {
	const on: string[] = [];
	const off: string[] = [];
	for (const [key, mark] of lit) (mark.leaving ? off : on).push(`[data-teacher-target="${escape(key)}"]`);
	const rules: string[] = [];
	const motion: string[] = [];
	if (on.length > 0) {
		rules.push(`${on.join(",")}{box-shadow:${MARK}!important}`);
		motion.push(`${on.join(",")}{transition:box-shadow var(--lh-dur) var(--lh-ease-out)}`);
	}
	if (off.length > 0) motion.push(`${off.join(",")}{transition:box-shadow var(--lh-dur-fast) var(--lh-ease-in)}`);
	if (motion.length > 0) rules.push(`@media (prefers-reduced-motion:no-preference){${motion.join("")}}`);
	return rules.join("\n");
}
