//! PDF reading through pdfium on one dedicated thread: text, shape, search, extracts and page images.
//!
//! Every call is a method on [`Pdf`] (`app.pdf`), named after the TypeScript function it replaces:
//! `text`, `pdf_extract`, `pdf_probe`, `pdf_shape`, `pdf_info`, `pdf_search`, `render_pdf_pages`.
//! `ops::parse_page_spec` is the one free function.

mod info;
mod open;
mod png;

pub mod ops;
pub mod render;
pub mod text;
pub mod worker;

pub use info::{PdfInfo, PdfPageInfo};
pub use ops::{PdfSearchHit, PdfShape};
pub use render::RenderedPdfPage;
pub use worker::Pdf;
