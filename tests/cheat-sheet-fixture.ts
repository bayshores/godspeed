import type { CheatSheet } from "../src/shared/core/cheat-sheet.ts";

export const newCheatSheet = (deadlineId: string, now: string): CheatSheet => ({ deadlineId, versions: [], messages: [], rules: [], updatedAt: now });
