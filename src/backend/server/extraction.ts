/** The app's ONE extraction pipeline instance. Every front door shares it
 *  (quiz-triggered lesson runs, notes imports, class files), so they hit
 *  the same single-flight registry. */
import { createExtractionPipeline } from "../agent/subagents/extraction.ts";
import { agentEngine } from "../agent/models.ts";
import { graphStoreForChat, scopeOfGraphStore, stores } from "./stores.ts";
import { scheduleTopicGrouping } from "./topics.ts";
import { relatedFacts } from "./search-index.ts";

export const extraction = createExtractionPipeline({
	...stores,
	// A lesson's facts land in ITS class's graph.
	graphStoreForChat,
	// Topics: a run that wrote a CLASS graph queues a
	// debounced topic-grouping run for that class ("No class" has none).
	onGraphWritten: (store) => {
		const scope = scopeOfGraphStore(store);
		if (typeof scope === "string") scheduleTopicGrouping(scope);
	},
	// Every stage runs on the outside agent.
	engineFor: () => agentEngine(),
	// The existing ideas each stretch's prompt carries, by local search.
	relatedFacts,
});
