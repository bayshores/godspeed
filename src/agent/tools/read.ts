import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute, type ImageFileResult } from "../tool-execute.ts";
import { formatSize, resolveSourcePath } from "./fs-shared.ts";

/**
 * The read tool: a Node port of pi's read semantics for the learner's
 * local files. The learner pastes file paths into the chat and the agent
 * reads on its own terms (nothing is auto-injected). Reads are
 * unrestricted: this is a personal study app, not a multi-tenant service.
 *
 * Ported behaviors (mirroring pi's dist/core/tools/read.js):
 * - text files: utf-8, offset (1-indexed) / limit slicing, and the
 *   2000-line / 50KB truncation ceiling with actionable "use offset=N"
 *   continuation notices — a huge file never silently floods the context.
 * - image files (jpg/png/gif/webp/bmp): returned as native image content
 *   parts so the model actually SEES them (toToolResult maps
 *   ImageFileResult to pi's ImageContent).
 * - unreadable/missing files throw — pi turns that into an error tool
 *   result the model sees and recovers from.
 */

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

/** Extension map (pi sniffs magic bytes; extensions suffice here —
 *  learner files are pasted paths, not adversarial uploads). */
const IMAGE_MIME: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

const readInput = Type.Object({
	path: Type.String({ minLength: 1, description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Integer({ minimum: 1, description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read" })),
});

/** Slice + truncate the text body, pi's continuation-notice style. */
function readTextSlice(text: string, offset: number | undefined, limit: number | undefined): string {
	const allLines = text.split("\n");
	const totalLines = allLines.length;
	const startLine = offset ? Math.max(0, offset - 1) : 0;
	if (startLine >= totalLines) {
		throw new Error(`Offset ${offset} is beyond end of file (${totalLines} lines total)`);
	}
	// honor an explicit limit first (never beyond EOF)
	let selected = allLines.slice(startLine, limit !== undefined ? startLine + limit : totalLines);
	// then the 2000-line ceiling
	let truncatedBy: "lines" | "bytes" | null = null;
	if (selected.length > MAX_LINES) {
		selected = selected.slice(0, MAX_LINES);
		truncatedBy = "lines";
	}
	// then the 50KB ceiling
	if (Buffer.byteLength(selected.join("\n"), "utf-8") > MAX_BYTES) {
		while (selected.length > 0 && Buffer.byteLength(selected.join("\n"), "utf-8") > MAX_BYTES) {
			selected.pop();
		}
		truncatedBy = "bytes";
	}
	if (truncatedBy === null) {
		const remaining = totalLines - (startLine + selected.length);
		if (remaining > 0) {
			return `${selected.join("\n")}\n\n[${remaining} more lines in file. Use offset=${startLine + selected.length + 1} to continue.]`;
		}
		return selected.join("\n");
	}
	const endLineDisplay = startLine + selected.length;
	const reason =
		truncatedBy === "lines" ? `${MAX_LINES} line limit` : `${formatSize(MAX_BYTES)} limit`;
	return `${selected.join("\n")}\n\n[Showing lines ${startLine + 1}-${endLineDisplay} of ${totalLines} (${reason}). Use offset=${endLineDisplay + 1} to continue.]`;
}

/**
 * The read tool, shared by the prober and the teacher. The description is
 * pi-verbatim; the teaching doctrine lives in the shared prompt fragments
 * (prompts/shared/). Relative paths resolve against the learner's home
 * (fs-shared.ts).
 */
export const readTool: AgentTool<typeof readInput> = {
	name: "read",
	label: "read",
	description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50.0KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
	parameters: readInput,
	execute: serverExecute("read", readInput, async ({ path: rawPath, offset, limit }): Promise<string | ImageFileResult> => {
		const absolute = resolveSourcePath(rawPath);
		const ext = path.extname(absolute).toLowerCase();
		const mime = IMAGE_MIME[ext];
		const buffer = await fs.readFile(absolute); // ENOENT/EACCES → error result the model sees
		if (mime) {
			// No resize, raw bytes as base64: learner files are study material
			// (screenshots, figures), not adversarial payloads.
			return {
				text: `Read image file [${mime}] — ${path.basename(absolute)} (${formatSize(buffer.byteLength)}), attached as an image.`,
				images: [{ data: buffer.toString("base64"), mimeType: mime }],
			};
		}
		const text = buffer.toString("utf-8");
		return readTextSlice(text, offset, limit);
	}),
};
