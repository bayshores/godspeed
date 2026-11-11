//! PDF reading through pdfium on one dedicated thread: text, shape, search, extracts and page images.
//!
//! Every call is a method on [`Pdf`] (`app.pdf`), named after the TypeScript function it replaces:
//! `text`, `pdf_extract`, `pdf_probe`, `pdf_shape`, `pdf_info`, `pdf_search`, `render_pdf_pages`.
//! `ops::parse_page_spec` and `ops::parse_int` are the free functions.

mod info;
mod open;

pub mod ops;
pub mod render;
#[cfg(feature = "test-support")]
pub mod test_support;
pub mod text;
pub mod worker;

pub use info::{PdfInfo, PdfPageInfo};
pub use ops::{PdfSearchHit, PdfShape};
pub use render::RenderedPdfPage;
pub use worker::Pdf;
