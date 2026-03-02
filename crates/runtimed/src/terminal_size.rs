//! Terminal size constants for kernel output.
//!
//! These constants define the terminal dimensions used for:
//! 1. Kernel environment variables (COLUMNS, LINES) - what subprocesses see
//! 2. Stream terminal emulation - how we process escape sequences
//!
//! Using 80 columns provides good compatibility with side-by-side window layouts
//! on typical displays. Both values should match to ensure consistent output
//! formatting between what the kernel produces and how we render it.

/// Terminal width in columns.
///
/// This is passed to kernels via COLUMNS env var and used for stream terminal
/// emulation. 80 is the classic terminal width that works well for side-by-side
/// layouts and produces readable tracebacks.
pub const TERMINAL_COLUMNS: usize = 80;

/// Terminal height in lines.
///
/// Passed to kernels via LINES env var. The actual value matters less for
/// notebooks since we don't have scrolling viewports, but some tools check it.
pub const TERMINAL_LINES: usize = 100;

/// String version of TERMINAL_COLUMNS for env var.
pub const TERMINAL_COLUMNS_STR: &str = "80";

/// String version of TERMINAL_LINES for env var.
pub const TERMINAL_LINES_STR: &str = "100";
