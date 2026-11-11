// What the embedding worker (src/backend/server/workers/embed-worker.mjs) gives for fixed batches,
// run on the real worker with models/ (node scripts/fetch-model.mjs). Vectors are the f32 bytes as
// hex, one row per text; token ids come from the same tokenizer the worker's pipeline loads.
import path from "node:path";
import { Worker } from "node:worker_threads";
import { AutoTokenizer, env } from "@huggingface/transformers";

const root = path.resolve(import.meta.dirname, "../../../..");
const modelsDir = path.join(root, "models");
const model = "Snowflake/snowflake-arctic-embed-xs";
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

const long = Array.from({ length: 120 }, (_, i) => `Sentence ${i} talks about binary trees, heaps and graphs.`).join(" ");
export const BATCHES: Record<string, string[]> = {
	"eight passages": [
		"Photosynthesis turns sunlight, water and carbon dioxide into glucose and oxygen inside the chloroplasts of plant cells.",
		"Mitosis is the cell division that produces two identical daughter cells, each with the same number of chromosomes as the parent.",
		"Binary search finds an item in a sorted array by repeatedly halving the range that could still hold it.",
		"Quicksort picks a pivot, partitions the array into smaller and larger items, and sorts each side the same way.",
		"The French Revolution began in 1789 when the Estates General met, and it ended the absolute monarchy in France.",
		"In a market the price settles where the quantity supplied equals the quantity demanded.",
		"Newton's second law says the net force on an object equals its mass times its acceleration.",
		"Shall I compare thee to a summer's day? Thou art more lovely and more temperate.",
	],
	"short batch with padding": ["ok", "Les protéines sont synthétisées par les ribosomes.\n蛋白质由核糖体合成。", "Ünïcödé ÀÉÎÕÜ ﬁ ½ 𝔘 😀 café"],
	"one query": [`${QUERY_PREFIX}how do plants make food from light`],
	"longer than the model reads": [long, "a short one beside it"],
	"empty and blank": ["", "   \n\t "],
	"code and math": ["fn main() { println!(\"{}\", x[i] * 2); } // O(n log n), ∑_{i=0}^{n} i² = n(n+1)(2n+1)/6"],
	"accents and marks": ["naïve coöperation résumé Œuvre Straße İstanbul ǅ ﬀ", "x́ è ñ ​zero width­soft"],
	"control characters": ["tab\there\u0007bell\u0000nul\u0085next line﻿bom"],
};

function embedAll(): Promise<Record<string, string[]>> {
	const worker = new Worker(path.join(root, "src", "backend", "server", "workers", "embed-worker.mjs"), { workerData: { modelsDir, model } });
	const names = Object.keys(BATCHES);
	const out: Record<string, string[]> = {};
	return new Promise((resolve, reject) => {
		worker.on("message", (msg: { id: number; ok: boolean; vectors?: Float32Array; error?: string }) => {
			if (!msg.ok) return reject(new Error(msg.error));
			const bytes = Buffer.from(msg.vectors!.buffer);
			const rows = msg.vectors!.length / 384;
			out[names[msg.id]!] = Array.from({ length: rows }, (_, i) => bytes.subarray(i * 1536, (i + 1) * 1536).toString("hex"));
			if (Object.keys(out).length === names.length) worker.terminate().then(() => resolve(out));
		});
		worker.on("error", reject);
		names.forEach((name, id) => worker.postMessage({ id, texts: BATCHES[name] }));
	});
}

async function tokens(): Promise<Record<string, number[][]>> {
	env.allowRemoteModels = false;
	env.localModelPath = modelsDir;
	const tokenizer = await AutoTokenizer.from_pretrained(model);
	const out: Record<string, number[][]> = {};
	for (const [name, texts] of Object.entries(BATCHES)) {
		const { input_ids } = tokenizer(texts, { padding: true, truncation: true });
		out[name] = input_ids.tolist().map((row: bigint[]) => row.map(Number));
	}
	return out;
}

export default {
	batches: () => BATCHES,
	tokens,
	vectors: embedAll,
};
