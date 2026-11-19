import { useEffect, useState } from "react";
import { getJson } from "@/frontend/lib/api";

/** `aspect` is the first page's width over height; every page is drawn at it. */
export type ReadingDoc = { kind: "text"; text: string } | { kind: "pdf"; pageCount: number; aspect: number };

/** The whole file the teacher is reading (GET /api/reading); null while
 *  loading or when the file can't be shown. */
export function useReadingDoc(path: string | null): ReadingDoc | null {
	const [doc, setDoc] = useState<{ path: string; doc: ReadingDoc | null } | null>(null);
	useEffect(() => {
		if (!path) return;
		let live = true;
		void getJson<ReadingDoc>(`/api/reading?path=${encodeURIComponent(path)}`).then(({ body }) => {
			if (live) setDoc({ path, doc: body });
		});
		return () => {
			live = false;
		};
	}, [path]);
	return doc && doc.path === path ? doc.doc : null;
}

/** One PDF page's image. */
export const pdfPageUrl = (path: string, page: number): string => `/api/reading?path=${encodeURIComponent(path)}&page=${page}`;
