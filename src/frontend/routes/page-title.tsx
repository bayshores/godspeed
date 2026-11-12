/** The window title names the page ("godspeed / Graph"); Today keeps the
 *  plain name. React puts the element in <head>. */
export function PageTitle({ page }: { page?: string }) {
	return <title>{page ? `godspeed / ${page}` : "godspeed"}</title>;
}
