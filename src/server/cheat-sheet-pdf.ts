/**
 * Taking the PDF an agent made for a cheat sheet: it must sit inside the
 * sheet's working folder (links resolved, so nothing outside can be read
 * through it), be a real PDF within the size cap, and have 1 to 4 pages
 * of a sane size. Returns its bytes and page sizes, or why not.
 */
import fs from "node:fs";
import path from "node:path";
import { pdfProblem, type SheetPage } from "../core/cheat-sheet.ts";
import type { TakenPdf } from "../agent/subagents/cheat-sheet-writer.ts";

async function pageSizes(bytes: Uint8Array): Promise<SheetPage[]> {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	// A copy: pdf.js may take the buffer it is given.
	const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
	try {
		const doc = await task.promise;
		const pages: SheetPage[] = [];
		for (let i = 1; i <= doc.numPages; i++) {
			const { width, height } = (await doc.getPage(i)).getViewport({ scale: 1 });
			pages.push({ widthPt: width, heightPt: height });
		}
		return pages;
	} finally {
		await task.destroy();
	}
}

export async function takeSheetPdf(folder: string, pdfPath: string): Promise<TakenPdf | string> {
	let file: string;
	try {
		const root = fs.realpathSync(folder);
		file = fs.realpathSync(path.resolve(folder, pdfPath));
		if (!file.startsWith(root + path.sep)) return `Put the PDF inside the working folder, ${folder}.`;
	} catch {
		return `There is no file at ${pdfPath}.`;
	}
	const stat = fs.statSync(file);
	if (!stat.isFile()) return `${pdfPath} is not a file.`;
	const tooBig = pdfProblem({ bytes: stat.size });
	if (tooBig) return tooBig;
	const bytes = new Uint8Array(fs.readFileSync(file));
	const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
	const notPdf = pdfProblem({ bytes: bytes.length, head });
	if (notPdf) return notPdf;
	let pages: SheetPage[];
	try {
		pages = await pageSizes(bytes);
	} catch (err) {
		return `The PDF can't be read: ${err instanceof Error ? err.message : String(err)}`;
	}
	return pdfProblem({ bytes: bytes.length, head, pages }) ?? { bytes, pages };
}
