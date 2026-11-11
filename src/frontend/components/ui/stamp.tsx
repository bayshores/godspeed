/** A red rubber stamp on something finished ("Done"). */
export function Stamp({ children }: { children: string }) {
	return <span className="inline-block rotate-[7deg] rounded-[3px] border-2 border-stamp px-2.5 py-0.5 text-[17px] leading-snug text-stamp">{children}</span>;
}
