import { createContext } from "react";
import type { JobRecord } from "@/core";

/**
 * Background-job observability channel (contracts/jobs.ts "THE ASYNC
 * PROTOCOL" §4).
 *
 * ONE central fetch (in Chat) reads GET /api/jobs?chatId=… and publishes
 * the list here: on mount, per jobs-changed announcement, and on channel
 * resync. Every job surface consumes it (the transcript dispatch cards and
 * the sub-agents sidebar panel), so the cards are pure renderers of this
 * data.
 */
export const JobsContext = createContext<JobRecord[]>([]);
