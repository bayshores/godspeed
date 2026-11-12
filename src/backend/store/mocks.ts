/**
 * data/spaces/<id>/mocks/<mock id>.json: one mock of a prep
 * (core/mock.ts). Written only by server/mocks.ts, stamped with its
 * format; a space's delete takes the folder with it.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.ts";
import { isSpaceId } from "../../shared/core/contracts.ts";
import { MOCK_FORMAT_VERSION, isMockId, parseMock, type Mock } from "../../shared/core/mock.ts";
import { setAsideCorrupt } from "./set-aside.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

function mocksDir(spaceId: string): string {
	if (!isSpaceId(spaceId)) throw new Error(`Invalid space id: ${spaceId}`);
	return path.join(PATHS.spaces, spaceId, "mocks");
}

function mockFile(spaceId: string, mockId: string): string {
	if (!isMockId(mockId)) throw new Error(`Invalid mock id: ${mockId}`);
	return path.join(mocksDir(spaceId), `${mockId}.json`);
}

/** The saved mock; null when there is none or a newer build saved it. */
export function readMock(spaceId: string, mockId: string): Mock | null {
	const file = mockFile(spaceId, mockId);
	let text: string;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch {
		return null;
	}
	try {
		const mock = parseMock(JSON.parse(text));
		return mock === "newer" ? null : mock;
	} catch {
		setAsideCorrupt(file);
		return null;
	}
}

/** Every mock of a prep, oldest first. */
export function listMocks(spaceId: string): Mock[] {
	const dir = mocksDir(spaceId);
	let names: string[];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return [];
	}
	return names
		.flatMap((name) => {
			const id = name.replace(/\.json$/, "");
			const mock = name.endsWith(".json") && isMockId(id) ? readMock(spaceId, id) : null;
			return mock ? [mock] : [];
		})
		.sort((a, b) => a.n - b.n);
}

export function writeMock(spaceId: string, mock: Mock): void {
	writeFileAtomic(mockFile(spaceId, mock.id), JSON.stringify({ version: MOCK_FORMAT_VERSION, ...mock }, null, "\t"));
}

export function removeMock(spaceId: string, mockId: string): void {
	fs.rmSync(mockFile(spaceId, mockId), { force: true });
}
