import { useEffect, useState } from "react";

/** `aspect` is the first page's width over height; every page is drawn at it. */
export type ReadingDoc = { kind: "text"; text: string } | { kind: "pdf"; pageCount: number; aspect: number };

/** The whole file the teacher is reading (GET /api/reading); null while
 *  loading or when the file can't be shown. */
export function useReadingDoc(path: string | null): ReadingDoc | null {
	const [doc, setDoc] = useState<{ path: string; doc: ReadingDoc | null } | null>(null);
	useEffect(() => {
		if (!path) return;
		let live = true;
		fetch(`/api/reading?path=${encodeURIComponent(path)}`)
			.then((res) => (res.ok ? (res.json() as Promise<ReadingDoc>) : null))
			.catch(() => null)
			.then((next) => {
				if (live) setDoc({ path, doc: next });
			});
		return () => {
			live = false;
		};
	}, [path]);
	return doc && doc.path === path ? doc.doc : null;
}

/** One PDF page's image. */
export const pdfPageUrl = (path: string, page: number): string => `/api/reading?path=${encodeURIComponent(path)}&page=${page}`;
