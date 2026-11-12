import { createContext } from "react";
import type { Cite } from "@/shared/core";

/** The sources of the message being drawn, and how to open a space file's. */
export const CiteContext = createContext<{ cites: readonly Cite[]; open: (cite: Cite) => void } | null>(null);
