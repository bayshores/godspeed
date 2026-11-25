import { useMemo } from "react";
import { useLocation } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { useVault } from "@/frontend/components/vault/vault-context";
import type { IdeaFacts } from "./starter-model";

/** What the starters and the whole list of ideas are made from, all of it already loaded by the
 *  window: the page on screen, the spaces, their open deadlines and whether a notes folder is set. */
export function useIdeaFacts(): IdeaFacts {
	const { pathname } = useLocation();
	const { spaces, activeSpace } = useSpaces();
	const { deadlines, gaps } = useOpenDeadlines();
	const { status: vault } = useVault();
	const notesFolder = vault?.folder != null;
	return useMemo(
		() => ({
			path: pathname,
			space: activeSpace && { id: activeSpace.id, name: activeSpace.name, files: activeSpace.fileCount },
			spaces: spaces.filter((s) => !s.closed).length,
			gaps: gaps.flatMap((g) => spaces.filter((s) => s.id === g.spaceId).map(({ id, name }) => ({ id, name }))),
			deadlines: deadlines ?? [],
			notesFolder,
		}),
		[pathname, activeSpace, spaces, gaps, deadlines, notesFolder],
	);
}
