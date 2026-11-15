//! Space files to text: office documents, EPUB books, captions, text sniffing, linked folder walks and fingerprints. The zip reader is also how a plugin zip is unpacked.

mod entities;
mod epub;
pub mod fingerprint;
mod inflate;
mod ioerr;
pub mod office;
pub mod text;
pub mod walk;
pub mod zipfile;
