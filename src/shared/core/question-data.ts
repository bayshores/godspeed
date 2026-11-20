/** The shapes of a question and its answer, and the options a question lists (normalised, shuffled). */

// ─── shared types ───────────────────────────────────────────────────────────

export interface QuizOption {
	label: string;
	value: string;
	description?: string;
}

// The TEACH-side quiz adds nodeId and `type`, the question's role in the
// teaching cycle. The role doctrine lives in the system prompt; tool
// descriptions stay mechanical and only say WHEN each kind fires. nodeId
// means "this question is ABOUT this node": a position signal, never a
// completion signal. An ungradeable quiz
// never reaches the learner: quizInputProblems and the plan-nodeId check
// (tools.ts) run in the tool's execute.
const QUIZ_QUESTION_TYPES = ["predict", "check"] as const;
export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];

/** A real selected answer, in the order the options were displayed. */
interface OptionAnswer {
	label: string;
	value: string;
	index: number; // 1-based display index
}

export type QuestionKind = "quiz" | "ask" | "explain" | "code";
export type SelectMode = "single-select" | "multi-select";
export type QuestionMode = SelectMode | "text";

/** Full question data, built by the dock from the tool input and graded by buildAnswer. */
export interface QuestionData {
	kind: QuestionKind;
	/** quiz only (teach phase): the question's role in
	 *  the cycle — predict (before the teaching, never collapsed) or check
	 *  (after it, behind the reveal). Absent on probe quizzes and old
	 *  records — everything check-shaped. */
	questionType?: QuizQuestionType;
	question: string;
	context?: string;
	mode: QuestionMode;
	options: QuizOption[]; // display order (post-shuffle)
	// quiz only. NEVER send to the client before answering:
	correctIndices?: number[];
	// explain only. NEVER send to the client before answering:
	committedAnswer?: string;
	// quiz only (the MC "why"). NEVER send to the client before answering:
	explanation?: string;
}

/** The learner's answer — full structured record, stored as the toolResult's `details`.
 *  No questionId: the toolResult message already carries the toolCallId. */
export interface QuestionAnswerData {
	kind: QuestionKind;
	/** The persisted call's tool NAME: probe-phase
	 *  calls are `probe`/`recall`, teach calls `quiz`/`explain` — the
	 *  cards label by it ("Probe"/"Recall"), so the phase boundary is
	 *  visible in the transcript. Absent on pre-rename records: they
	 *  keep the kind-based labels. */
	tool?: string;
	/** quiz only (teach phase): the role snapshot for rendering (a
	 *  prediction tucks its explanation) and later calibration splits.
	 *  Absent on old records and probe answers. */
	questionType?: QuizQuestionType;
	questionText: string;
	options?: { index: number; label: string }[]; // snapshot for rendering
	dontKnow: boolean;
	answers: OptionAnswer[];
	other?: string; // ask: "Other" free text
	text?: string; // ask/explain: text-mode answer
	/** The learner's reasoning on the QUESTION (was `note`). */
	thinking?: string;
	/** @deprecated the pre-rename key — never written again; old records
	 *  replay through the same types, so it stays declared. Read via
	 *  `thinking ?? note`. */
	note?: string;
	confidence?: number; // quiz only: the learner's stated probability (0-100, raw) that his selected answer is correct — never sent on "I don't know"
	correct?: boolean; // quiz only
	correctIndices?: number[]; // quiz only (rendering)
	committed?: string; // explain only (rendering): the model's committed answer
	code?: string; // code only: what the learner wrote (absent on "I don't know")
	language?: string; // code only
	explanation?: string; // quiz only (rendering)
	dismissed?: boolean;
	answeredAt: string;
}

/** What the server passes to the bridge when the learner answers. */
export interface AnswerRequest {
	dontKnow?: boolean;
	values?: string[]; // option values
	other?: string; // an ask's own answer, typed in the box with nothing picked
	text?: string; // ask text-mode
	thinking?: string; // the reasoning-on-the-question channel (was `note`)
	confidence?: number; // quiz only: 0-100, sent only when the learner picked a level
}

// ─── options ────────────────────────────────────────────────────────────────

export function normalizeOptions(
	options: Array<{ label: string; value?: string; description?: string }> | undefined,
): QuizOption[] {
	const seen = new Set<string>();
	return (options ?? [])
		.map((option) => ({
			label: option.label.trim(),
			value: option.value?.trim() || option.label.trim(),
			description: option.description?.trim() || undefined,
		}))
		.filter((option) => {
			if (option.label.length === 0) return false;
			if (seen.has(option.value)) throw new Error(`duplicate option value "${option.value}"`);
			seen.add(option.value);
			return true;
		});
}

/** mulberry32 seeded by a string — deterministic shuffle for hydration-safe rendering. */
export function seededRandom(seed: string): () => number {
	let h = 2166136261;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	let a = h >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Fisher–Yates with an injectable RNG. Pass `seededRandom(toolCallId)` in
 * rendered components: Math.random() shuffles differently on server vs client
 * and breaks hydration (React #418). A per-toolCallId seed keeps the order
 * stable across reloads while still varying it per question.
 */
export function shuffleOptions(options: QuizOption[], rand: () => number = Math.random): QuizOption[] {
	const out = [...options];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		const a = out[i]!;
		const b = out[j]!;
		out[i] = b;
		out[j] = a;
	}
	return out;
}
