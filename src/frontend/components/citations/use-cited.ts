import { useEffect, useState } from "react";
import { getJson } from "@/frontend/lib/api";
import type { CitedPassage, FileCite, PassageCite } from "./page-excerpt-model";

/** GET /api/cited for a space file's source, with its quote when it has
 *  one, or for a passage by its number: null while loading, "gone" when
 *  the file or place is missing. */
export function useCited(cite: FileCite | PassageCite): CitedPassage | "gone" | null {
	const [got, setGot] = useState<{ key: string; passage: CitedPassage | "gone" } | null>(null);
	const url =
		"passage" in cite
			? `/api/cited/${cite.fileId}?passage=${cite.passage}`
			: `/api/cited/${cite.fileId}?range=${encodeURIComponent(cite.range)}${cite.quote ? `&quote=${encodeURIComponent(cite.quote)}` : ""}`;
	useEffect(() => {
		let live = true;
		void getJson<CitedPassage>(url).then(({ body }) => {
			if (live) setGot({ key: url, passage: body ?? "gone" });
		});
		return () => {
			live = false;
		};
	}, [url]);
	return got && got.key === url ? got.passage : null;
}
