import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { folderLine, folderTitle, openLabel, pickLine, vaultHead, waitingLine, type VaultFolder, type VaultStatus } from "../../src/frontend/components/vault/vault-model.ts";

const folder = (name: string, parent: string): VaultFolder => ({ path: `/h/${name}`, name, short: `${parent}/${name}`, parent });
const status = (over: Partial<VaultStatus>): VaultStatus => ({ folder: null, words: "teacher", obsidian: false, vaults: [], notes: 0, capped: false, state: "none", waiting: null, ...over });

describe("the notes folder group", () => {
	it("is Obsidian while the learner picks among Obsidian's vaults or holds one, else Notes folder", () => {
		assert.equal(vaultHead(status({ vaults: [folder("Notes", "~")] })), "Obsidian");
		assert.equal(vaultHead(status({})), "Notes folder");
		assert.equal(vaultHead(status({ state: "ok", obsidian: true, folder: folder("V", "~") })), "Obsidian");
		assert.equal(vaultHead(status({ state: "ok", vaults: [folder("V", "~")], folder: folder("Plain", "~") })), "Notes folder");
	});

	it("asks for a vault when Obsidian lists some, else for a folder", () => {
		assert.equal(pickLine(status({ vaults: [folder("V", "~")] })), "Pick the vault godspeed writes notes in.");
		assert.equal(pickLine(status({})), "Pick the folder godspeed writes notes in.");
	});

	it("names a vault by its name and any other folder by its path", () => {
		const plain = folder("Notes", "~/Documents");
		assert.equal(folderTitle(plain, true), "Notes");
		assert.equal(folderTitle(plain, false), "~/Documents/Notes");
	});

	it("says where the vault is and how many notes it holds, or why it cannot be read", () => {
		const vault = status({ state: "ok", obsidian: true, notes: 412, folder: folder("UCSD", "~/Cowork") });
		assert.equal(folderLine(vault, "Finder"), "In ~/Cowork, 412 notes. Each space gets a folder in it.");
		const plain = status({ state: "ok", notes: 1, folder: folder("Notes", "~/Documents") });
		assert.equal(folderLine(plain, "Finder"), "1 note. It is not an Obsidian vault, so notes open in Finder.");
		assert.match(folderLine({ ...plain, capped: true }, "Finder"), /as many as godspeed reads/);
		assert.equal(folderLine({ ...plain, state: "missing", message: "Can't find this folder." }, "Finder"), "Can't find this folder.");
	});
});

describe("saying where a note opens and what failed", () => {
	it("opens in Obsidian for a vault and in the file browser for any other folder", () => {
		assert.equal(openLabel(true, "Finder"), "Open in Obsidian");
		assert.equal(openLabel(false, "Finder"), "Show in Finder");
	});

	it("counts the notes that could not be saved", () => {
		assert.equal(waitingLine(["Stars and bars", "Combinations"], true), "Couldn't save Stars and bars and Combinations to Obsidian.");
		assert.equal(waitingLine(["Pigeonhole"], false), "Couldn't save Pigeonhole to your notes folder.");
		assert.equal(waitingLine(["A", "B", "C", "D", "E"], true), "Couldn't save A, B and 3 more to Obsidian.");
	});
});
