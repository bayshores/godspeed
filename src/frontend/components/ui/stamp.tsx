/** A red rubber stamp on something finished ("Done"). */
export function Stamp({ children }: { children: string }) {
	return <span className="inline-block rotate-[8deg] rounded border-2 border-stamp px-2.5 py-[5px] text-lg leading-none text-stamp">{children}</span>;
}
