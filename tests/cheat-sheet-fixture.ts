import type { CheatSheetView } from "../src/shared/core/cheat-sheet.ts";

type CheatSheet = CheatSheetView["sheet"];

export const newCheatSheet = (deadlineId: string, now: string): CheatSheet => ({ deadlineId, versions: [], messages: [], rules: [], updatedAt: now });
