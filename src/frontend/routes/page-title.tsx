/** The window title names the page like the top bar ("godspeed / graph");
 *  Home keeps the plain name. React puts the element in <head>. */
export function PageTitle({ page }: { page?: string }) {
	return <title>{page ? `godspeed / ${page}` : "godspeed"}</title>;
}
