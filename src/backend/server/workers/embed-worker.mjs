/**
 * Text → embedding vectors on a worker thread (class search).
 *
 * onnxruntime-node runs a model synchronously on the thread that calls it:
 * on the server's main thread, indexing a class froze every request for
 * about a second per batch. This worker holds the model and embeds what the
 * server sends, one message at a time.
 *
 * Plain .mjs on purpose, like pdf-text-worker.mjs: loaded by path, traced
 * into the standalone build by next.config.ts.
 *
 * In:  { id, texts }          (the query prefix is already applied)
 * Out: { id, ok: true, vectors: Float32Array }  (normalized, row after row)
 *   or { id, ok: false, error }
 */
import { parentPort, workerData } from "node:worker_threads";

const { modelsDir, model } = workerData;
let ready;

function load() {
	ready ??= import("@huggingface/transformers").then(({ env, pipeline }) => {
		env.allowRemoteModels = false;
		env.useFSCache = false;
		env.localModelPath = modelsDir;
		return pipeline("feature-extraction", model, { dtype: "q8", device: "cpu" });
	});
	return ready;
}

parentPort.on("message", async ({ id, texts }) => {
	try {
		const embed = await load();
		const { data } = await embed(texts, { pooling: "cls", normalize: true });
		const vectors = Float32Array.from(data);
		parentPort.postMessage({ id, ok: true, vectors }, [vectors.buffer]);
	} catch (err) {
		parentPort.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
	}
});
