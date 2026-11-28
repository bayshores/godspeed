import { useState } from "react";
import { cn } from "@/frontend/lib/utils";

/** A one-off row (the desk) that rises in when it mounts mid-session —
 *  decided once, at mount. */
export function ArrivalRow({ live, className, children }: { live: boolean; className?: string; children: React.ReactNode }) {
	const [rise] = useState(live);
	return <div className={cn(className, rise && "lh-rise")}>{children}</div>;
}
