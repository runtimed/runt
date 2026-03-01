//! Terminal emulation for stream outputs (stdout/stderr).
//!
//! This module provides terminal emulation using `alacritty_terminal` to properly
//! handle escape sequences like carriage returns (for progress bars), backspaces,
//! and cursor movement. Each (cell_id, stream_name) pair gets its own terminal
//! emulator, and the rendered content is serialized back to ANSI text for the
//! frontend to display.

use std::collections::HashMap;

use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::Config;
use alacritty_terminal::vte::ansi::{Color, NamedColor, Processor, Rgb};
use alacritty_terminal::Term;

/// Default terminal width in columns.
const DEFAULT_COLUMNS: usize = 120;

/// Default terminal height in lines.
/// We use a small height since we don't need scrollback for notebook outputs.
const DEFAULT_LINES: usize = 100;

/// Maximum scrollback history.
/// Keep minimal since notebook outputs don't need scrollback.
const SCROLLBACK_HISTORY: usize = 10000;

/// Key for terminal buffers: (cell_id, stream_name).
type StreamKey = (String, String);

/// Simple dimensions struct for creating terminals.
struct TermDimensions {
    columns: usize,
    screen_lines: usize,
}

impl TermDimensions {
    fn new(columns: usize, screen_lines: usize) -> Self {
        Self {
            columns,
            screen_lines,
        }
    }
}

impl Dimensions for TermDimensions {
    fn total_lines(&self) -> usize {
        self.screen_lines
    }

    fn screen_lines(&self) -> usize {
        self.screen_lines
    }

    fn columns(&self) -> usize {
        self.columns
    }
}

/// Manages terminal emulators for stream outputs.
///
/// Each (cell_id, stream_name) pair gets its own terminal emulator to properly
/// handle escape sequences. When text is fed to a stream, it's processed through
/// the terminal and the rendered content is returned as ANSI text.
///
/// Also tracks the output index for each stream in the cell's outputs list,
/// enabling efficient in-place updates without searching.
pub struct StreamTerminals {
    terminals: HashMap<StreamKey, Term<VoidListener>>,
    processors: HashMap<StreamKey, Processor>,
    /// Output indices for each (cell_id, stream_name) in the cell's outputs list.
    output_indices: HashMap<StreamKey, usize>,
}

impl Default for StreamTerminals {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamTerminals {
    /// Create a new StreamTerminals manager.
    pub fn new() -> Self {
        Self {
            terminals: HashMap::new(),
            processors: HashMap::new(),
            output_indices: HashMap::new(),
        }
    }

    /// Feed text to the terminal for (cell_id, stream_name).
    ///
    /// Returns the rendered ANSI text representation of the terminal content.
    /// This handles escape sequences like `\r` (carriage return) and cursor
    /// movement, so progress bars will show only their final state.
    pub fn feed(&mut self, cell_id: &str, stream_name: &str, text: &str) -> String {
        let key = (cell_id.to_string(), stream_name.to_string());

        // Get or create terminal and processor for this stream
        let term = self.terminals.entry(key.clone()).or_insert_with(|| {
            let config = Config {
                scrolling_history: SCROLLBACK_HISTORY,
                ..Config::default()
            };
            let dimensions = TermDimensions::new(DEFAULT_COLUMNS, DEFAULT_LINES);
            Term::new(config, &dimensions, VoidListener)
        });

        let processor = self.processors.entry(key).or_default();

        // Feed input to terminal
        processor.advance(term, text.as_bytes());

        // Serialize terminal content back to ANSI text
        serialize_to_ansi(term)
    }

    /// Clear terminal(s) for a cell.
    ///
    /// Called when a cell starts executing to reset the terminal state.
    pub fn clear(&mut self, cell_id: &str) {
        // Remove all terminals for this cell (both stdout and stderr)
        self.terminals.retain(|(cid, _), _| cid != cell_id);
        self.processors.retain(|(cid, _), _| cid != cell_id);
        self.output_indices.retain(|(cid, _), _| cid != cell_id);
    }

    /// Check if a stream exists for a cell.
    pub fn has_stream(&self, cell_id: &str, stream_name: &str) -> bool {
        let key = (cell_id.to_string(), stream_name.to_string());
        self.terminals.contains_key(&key)
    }

    /// Get the output index for a stream (if known).
    ///
    /// Returns the index in the cell's outputs list where this stream is stored.
    pub fn get_output_index(&self, cell_id: &str, stream_name: &str) -> Option<usize> {
        let key = (cell_id.to_string(), stream_name.to_string());
        self.output_indices.get(&key).copied()
    }

    /// Set the output index for a stream.
    ///
    /// Called after upserting a stream output to track its position for future updates.
    pub fn set_output_index(&mut self, cell_id: &str, stream_name: &str, index: usize) {
        let key = (cell_id.to_string(), stream_name.to_string());
        self.output_indices.insert(key, index);
    }
}

/// Serialize terminal content to ANSI-encoded string.
///
/// This iterates through the terminal's renderable content and converts
/// it back to ANSI escape sequences that the frontend can render.
/// Only lines with actual content are included (trailing empty lines are trimmed).
fn serialize_to_ansi(term: &Term<VoidListener>) -> String {
    // First pass: find the last line with actual content
    let content = term.renderable_content();
    let mut max_line_with_content: i32 = -1;

    for indexed_cell in content.display_iter {
        let cell = &indexed_cell.cell;
        if cell.c != ' ' && cell.c != '\0' {
            max_line_with_content = max_line_with_content.max(indexed_cell.point.line.0);
        }
    }

    if max_line_with_content < 0 {
        return String::new();
    }

    // Second pass: serialize with ANSI codes, only up to max_line_with_content
    let content = term.renderable_content();
    let mut result = String::new();
    let mut current_fg: Option<Color> = None;
    let mut current_bg: Option<Color> = None;
    let mut current_flags = Flags::empty();
    let mut last_line: Option<i32> = None;

    for indexed_cell in content.display_iter {
        let point = indexed_cell.point;
        let cell = &indexed_cell.cell;

        // Stop after the last line with content
        if point.line.0 > max_line_with_content {
            break;
        }

        // Handle line breaks
        if let Some(prev_line) = last_line {
            if point.line.0 != prev_line {
                let lines_to_add = point.line.0 - prev_line;
                for _ in 0..lines_to_add {
                    result.push('\n');
                }
            }
        }
        last_line = Some(point.line.0);

        // Skip spacer cells
        if cell.flags.contains(Flags::WIDE_CHAR_SPACER)
            || cell.flags.contains(Flags::LEADING_WIDE_CHAR_SPACER)
        {
            continue;
        }

        // Emit attribute changes
        let mut attrs_changed = false;

        // Check if we need to reset
        let need_reset = (current_flags != cell.flags && !current_flags.is_empty())
            || (current_fg.is_some() && current_fg != Some(cell.fg))
            || (current_bg.is_some() && current_bg != Some(cell.bg));

        if need_reset {
            result.push_str("\x1b[0m");
            current_fg = None;
            current_bg = None;
            current_flags = Flags::empty();
            attrs_changed = true;
        }

        // Emit new flags
        if cell.flags != current_flags {
            if cell.flags.contains(Flags::BOLD) && !current_flags.contains(Flags::BOLD) {
                result.push_str("\x1b[1m");
                attrs_changed = true;
            }
            if cell.flags.contains(Flags::DIM) && !current_flags.contains(Flags::DIM) {
                result.push_str("\x1b[2m");
                attrs_changed = true;
            }
            if cell.flags.contains(Flags::ITALIC) && !current_flags.contains(Flags::ITALIC) {
                result.push_str("\x1b[3m");
                attrs_changed = true;
            }
            if cell.flags.contains(Flags::UNDERLINE) && !current_flags.contains(Flags::UNDERLINE) {
                result.push_str("\x1b[4m");
                attrs_changed = true;
            }
            if cell.flags.contains(Flags::STRIKEOUT) && !current_flags.contains(Flags::STRIKEOUT) {
                result.push_str("\x1b[9m");
                attrs_changed = true;
            }
            if cell.flags.contains(Flags::HIDDEN) && !current_flags.contains(Flags::HIDDEN) {
                result.push_str("\x1b[8m");
                attrs_changed = true;
            }
            current_flags = cell.flags;
        }

        // Emit foreground color if changed
        if current_fg != Some(cell.fg) {
            if let Some(ansi) = color_to_ansi(&cell.fg, true) {
                result.push_str(&ansi);
                attrs_changed = true;
            }
            current_fg = Some(cell.fg);
        }

        // Emit background color if changed
        if current_bg != Some(cell.bg) {
            if let Some(ansi) = color_to_ansi(&cell.bg, false) {
                result.push_str(&ansi);
                attrs_changed = true;
            }
            current_bg = Some(cell.bg);
        }

        // Emit the character
        if cell.c != ' ' || attrs_changed {
            result.push(cell.c);
        } else {
            result.push(' ');
        }

        // Emit any zero-width characters
        if let Some(zerowidth) = cell.zerowidth() {
            for c in zerowidth {
                result.push(*c);
            }
        }
    }

    // Reset at end if we have any active attributes
    if !current_flags.is_empty() || current_fg.is_some() || current_bg.is_some() {
        result.push_str("\x1b[0m");
    }

    // Trim trailing whitespace from each line
    let lines: Vec<&str> = result.lines().collect();
    let trimmed_lines: Vec<String> = lines
        .iter()
        .map(|line| line.trim_end().to_string())
        .collect();

    // Remove trailing empty lines
    let mut final_lines = trimmed_lines;
    while final_lines.last().is_some_and(|l| l.is_empty()) {
        final_lines.pop();
    }

    final_lines.join("\n")
}

/// Convert a Color to ANSI escape sequence.
fn color_to_ansi(color: &Color, is_foreground: bool) -> Option<String> {
    let base = if is_foreground { 30 } else { 40 };

    match color {
        Color::Named(named) => {
            let code = match named {
                NamedColor::Black => Some(base),
                NamedColor::Red => Some(base + 1),
                NamedColor::Green => Some(base + 2),
                NamedColor::Yellow => Some(base + 3),
                NamedColor::Blue => Some(base + 4),
                NamedColor::Magenta => Some(base + 5),
                NamedColor::Cyan => Some(base + 6),
                NamedColor::White => Some(base + 7),
                NamedColor::BrightBlack => Some(base + 60),
                NamedColor::BrightRed => Some(base + 61),
                NamedColor::BrightGreen => Some(base + 62),
                NamedColor::BrightYellow => Some(base + 63),
                NamedColor::BrightBlue => Some(base + 64),
                NamedColor::BrightMagenta => Some(base + 65),
                NamedColor::BrightCyan => Some(base + 66),
                NamedColor::BrightWhite => Some(base + 67),
                // Default foreground/background - don't emit
                NamedColor::Foreground | NamedColor::Background => None,
                // Other named colors (cursor, etc.) - skip
                _ => None,
            };
            code.map(|c| format!("\x1b[{}m", c))
        }
        Color::Spec(Rgb { r, g, b }) => {
            // True color (24-bit)
            let prefix = if is_foreground { 38 } else { 48 };
            Some(format!("\x1b[{};2;{};{};{}m", prefix, r, g, b))
        }
        Color::Indexed(idx) => {
            // 256-color palette
            let prefix = if is_foreground { 38 } else { 48 };
            Some(format!("\x1b[{};5;{}m", prefix, idx))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_text() {
        let mut terminals = StreamTerminals::new();
        let result = terminals.feed("cell-1", "stdout", "hello world");
        assert!(result.contains("hello world"));
    }

    #[test]
    fn test_carriage_return() {
        let mut terminals = StreamTerminals::new();
        // Simulate progress bar: "Progress: 50%\rProgress: 100%"
        let result = terminals.feed("cell-1", "stdout", "Progress: 50%\rProgress: 100%");
        // Should only contain the final state
        assert!(result.contains("Progress: 100%"));
        assert!(!result.contains("Progress: 50%"));
    }

    #[test]
    fn test_newlines() {
        let mut terminals = StreamTerminals::new();
        let result = terminals.feed("cell-1", "stdout", "line1\nline2\nline3");
        assert!(result.contains("line1"));
        assert!(result.contains("line2"));
        assert!(result.contains("line3"));
    }

    #[test]
    fn test_colors() {
        let mut terminals = StreamTerminals::new();
        let result = terminals.feed("cell-1", "stdout", "\x1b[31mred\x1b[0m normal");
        // Should preserve the ANSI codes
        assert!(result.contains("\x1b["));
        assert!(result.contains("red"));
        assert!(result.contains("normal"));
    }

    #[test]
    fn test_separate_streams() {
        let mut terminals = StreamTerminals::new();
        terminals.feed("cell-1", "stdout", "stdout content");
        terminals.feed("cell-1", "stderr", "stderr content");

        assert!(terminals.has_stream("cell-1", "stdout"));
        assert!(terminals.has_stream("cell-1", "stderr"));
    }

    #[test]
    fn test_clear() {
        let mut terminals = StreamTerminals::new();
        terminals.feed("cell-1", "stdout", "content");
        assert!(terminals.has_stream("cell-1", "stdout"));

        terminals.clear("cell-1");
        assert!(!terminals.has_stream("cell-1", "stdout"));
    }

    #[test]
    fn test_incremental_feed() {
        let mut terminals = StreamTerminals::new();

        // Feed in chunks like kernel would
        terminals.feed("cell-1", "stdout", "Hello ");
        let result = terminals.feed("cell-1", "stdout", "World!");

        assert!(result.contains("Hello World!"));
    }

    #[test]
    fn test_is_send() {
        fn assert_send<T: Send>() {}
        assert_send::<StreamTerminals>();
    }

    #[test]
    fn test_output_index_tracking() {
        let mut terminals = StreamTerminals::new();

        // Initially no index known
        assert!(terminals.get_output_index("cell-1", "stdout").is_none());

        // Set index after first upsert
        terminals.set_output_index("cell-1", "stdout", 0);
        assert_eq!(terminals.get_output_index("cell-1", "stdout"), Some(0));

        // Different stream gets different index
        terminals.set_output_index("cell-1", "stderr", 1);
        assert_eq!(terminals.get_output_index("cell-1", "stderr"), Some(1));
        assert_eq!(terminals.get_output_index("cell-1", "stdout"), Some(0));

        // Clear removes indices
        terminals.clear("cell-1");
        assert!(terminals.get_output_index("cell-1", "stdout").is_none());
        assert!(terminals.get_output_index("cell-1", "stderr").is_none());
    }
}
