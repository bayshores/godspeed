/// The app-wide message id: `msg_<base36 now>_<8 hex>`.
pub fn new_message_id() -> String {
	gs_base::ids::timed("msg")
}
