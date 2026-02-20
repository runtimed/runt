//! Fractional indexing for cell ordering.
//!
//! Uses base-36 strings that sort lexicographically, allowing insertions
//! between any two adjacent keys without reindexing. This is the Rust
//! equivalent of `generateKeyBetween` used in intheloop's schema.

use std::fmt;

const BASE: u32 = 36;
const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

/// Errors that can occur during fractional index operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FractionalIndexError {
    /// A key contains a character that is not a valid base-36 digit.
    InvalidCharacter(char),
    /// `before` is not strictly less than `after`.
    InvalidOrder { before: String, after: String },
    /// No string can be generated between the given bounds.
    NoSpace { before: String, after: String },
}

impl fmt::Display for FractionalIndexError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCharacter(c) => write!(f, "invalid base-36 digit: '{c}'"),
            Self::InvalidOrder { before, after } => {
                write!(f, "before ({before}) must be less than after ({after})")
            }
            Self::NoSpace { before, after } => {
                write!(f, "no key exists between \"{before}\" and \"{after}\"")
            }
        }
    }
}

impl std::error::Error for FractionalIndexError {}

fn digit_value(c: u8) -> Result<u32, FractionalIndexError> {
    match c {
        b'0'..=b'9' => Ok((c - b'0') as u32),
        b'a'..=b'z' => Ok((c - b'a' + 10) as u32),
        _ => Err(FractionalIndexError::InvalidCharacter(c as char)),
    }
}

fn digit_char(v: u32) -> u8 {
    DIGITS[v as usize]
}

/// Validate that a key string contains only valid base-36 digits.
fn validate_key(key: &str) -> Result<(), FractionalIndexError> {
    for &c in key.as_bytes() {
        digit_value(c)?;
    }
    Ok(())
}

/// Generate a key between two optional bounds.
///
/// - `key_between(None, None)` → midpoint key
/// - `key_between(None, Some(after))` → key before `after`
/// - `key_between(Some(before), None)` → key after `before`
/// - `key_between(Some(before), Some(after))` → key between `before` and `after`
///
/// Returns a lexicographically sortable base-36 string.
pub fn key_between(
    before: Option<&str>,
    after: Option<&str>,
) -> Result<String, FractionalIndexError> {
    if let Some(b) = before {
        validate_key(b)?;
    }
    if let Some(a) = after {
        validate_key(a)?;
    }

    match (before, after) {
        (None, None) => Ok(String::from("a")),
        (None, Some(after)) => generate_key_before(after),
        (Some(before), None) => generate_key_after(before),
        (Some(before), Some(after)) => {
            if before >= after {
                return Err(FractionalIndexError::InvalidOrder {
                    before: before.to_string(),
                    after: after.to_string(),
                });
            }
            generate_key_between(before, after)
        }
    }
}

/// Generate n keys evenly spaced between two bounds.
pub fn n_keys_between(
    before: Option<&str>,
    after: Option<&str>,
    n: usize,
) -> Result<Vec<String>, FractionalIndexError> {
    if n == 0 {
        return Ok(vec![]);
    }

    let mut result = Vec::with_capacity(n);
    let mut prev = before.map(|s| s.to_string());

    for _ in 0..n {
        let key = key_between(prev.as_deref(), after)?;
        result.push(key.clone());
        prev = Some(key);
    }

    Ok(result)
}

/// Generate a key that sorts before `b`.
fn generate_key_before(b: &str) -> Result<String, FractionalIndexError> {
    let bytes = b.as_bytes();

    // Find the first non-zero character
    let mut i = 0;
    while i < bytes.len() && bytes[i] == b'0' {
        i += 1;
    }

    if i == bytes.len() {
        // All zeros — prepend another zero
        return Ok(format!("0{b}"));
    }

    let val = digit_value(bytes[i])?;

    if i == 0 && val > 1 {
        // Can use a smaller first character
        return Ok(String::from(digit_char(val / 2) as char));
    }

    let prefix = &b[..i];
    if val > 1 {
        return Ok(format!("{prefix}{}", digit_char(val / 2) as char));
    }

    // val is 1, use prefix + "0" + midpoint
    Ok(format!("{prefix}0h"))
}

/// Generate a key that sorts after `a`.
fn generate_key_after(a: &str) -> Result<String, FractionalIndexError> {
    let bytes = a.as_bytes();

    // Find the last character that isn't 'z'
    let mut i = bytes.len() as isize - 1;
    while i >= 0 && bytes[i as usize] == b'z' {
        i -= 1;
    }

    if i < 0 {
        // All 'z's — extend
        return Ok(format!("{a}h"));
    }

    let idx = i as usize;
    let val = digit_value(bytes[idx])?;

    if val < BASE - 2 {
        // Simple increment
        let prefix = &a[..idx];
        return Ok(format!("{prefix}{}", digit_char(val + 1) as char));
    }

    // val is 'y' (34), incrementing gives 'z' — extend instead to avoid boundary
    Ok(format!("{a}h"))
}

/// Generate a key between `a` and `b` where `a < b`.
fn generate_key_between(a: &str, b: &str) -> Result<String, FractionalIndexError> {
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();

    // Find the first position where they differ
    let mut i = 0;
    while i < a_bytes.len() && i < b_bytes.len() && a_bytes[i] == b_bytes[i] {
        i += 1;
    }

    // If a is a prefix of b
    if i == a_bytes.len() {
        let next_val = digit_value(b_bytes[i])?;

        if next_val > 0 {
            // There's a non-zero char after the common prefix
            let mid_val = next_val / 2;
            if mid_val > 0 {
                return Ok(format!("{a}{}", digit_char(mid_val) as char));
            } else {
                // next_val is 1, mid is 0 — use a + "0"
                return Ok(format!("{a}0"));
            }
        }

        // next_val is 0: b continues with "0" after a ends
        if b_bytes.len() > i + 1 {
            // Count consecutive zeros after position i in b
            let mut j = i;
            while j < b_bytes.len() && b_bytes[j] == b'0' {
                j += 1;
            }

            if j == b_bytes.len() {
                // b is all zeros after the prefix — use fewer zeros
                let zero_count = j - i;
                if zero_count > 1 {
                    return Ok(format!("{a}{}", "0".repeat(zero_count / 2)));
                }
            } else if j < b_bytes.len() {
                // b has a non-zero char at position j
                let prefix = format!("{a}{}", "0".repeat(j - i));
                let next_val = digit_value(b_bytes[j])?;
                if next_val > 0 {
                    return Ok(format!(
                        "{prefix}{}",
                        digit_char(next_val / 2) as char
                    ));
                }
            }
        }

        return Err(FractionalIndexError::NoSpace {
            before: a.to_string(),
            after: b.to_string(),
        });
    }

    // b is a prefix of a shouldn't happen if a < b
    if i == b_bytes.len() {
        return Err(FractionalIndexError::InvalidOrder {
            before: a.to_string(),
            after: b.to_string(),
        });
    }

    // Characters differ at position i
    let a_val = digit_value(a_bytes[i])?;
    let b_val = digit_value(b_bytes[i])?;

    // If there's room between them, use the midpoint
    if b_val - a_val > 1 {
        let mid_val = (a_val + b_val) / 2;
        let prefix = &a[..i];
        let suffix = &a[i + 1..];
        return Ok(format!(
            "{prefix}{}{}",
            digit_char(mid_val) as char,
            suffix
        ));
    }

    // Characters are adjacent (diff is 1)
    // Extend after a's character to find space
    if i < a_bytes.len() - 1 {
        // a has more characters — generate key after the remaining part
        let prefix = &a[..i + 1];
        let remaining = &a[i + 1..];
        let suffix = generate_key_after(remaining)?;
        return Ok(format!("{prefix}{suffix}"));
    }

    // a[i] and b[i] are adjacent, a has no more characters — extend with midpoint
    Ok(format!("{}h", &a[..i + 1]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_midpoint_none_none() {
        let key = key_between(None, None).unwrap();
        assert_eq!(key, "a");
    }

    #[test]
    fn test_after_last() {
        let key = key_between(Some("a"), None).unwrap();
        assert!(key.as_str() > "a");
    }

    #[test]
    fn test_before_first() {
        let key = key_between(None, Some("a")).unwrap();
        assert!(key.as_str() < "a");
    }

    #[test]
    fn test_between_two_keys() {
        let key = key_between(Some("a"), Some("b")).unwrap();
        assert!(key.as_str() > "a");
        assert!(key.as_str() < "b");
    }

    #[test]
    fn test_between_distant_keys() {
        let key = key_between(Some("a"), Some("z")).unwrap();
        assert!(key.as_str() > "a");
        assert!(key.as_str() < "z");
    }

    #[test]
    fn test_between_adjacent_single_chars() {
        let key = key_between(Some("a"), Some("b")).unwrap();
        assert!(key.as_str() > "a");
        assert!(key.as_str() < "b");
    }

    #[test]
    fn test_sequential_insertions_at_end() {
        let mut keys = vec![key_between(None, None).unwrap()];
        for _ in 0..20 {
            let last = keys.last().unwrap().clone();
            let new_key = key_between(Some(&last), None).unwrap();
            assert!(
                new_key.as_str() > last.as_str(),
                "{new_key} should be > {last}"
            );
            keys.push(new_key);
        }
        for window in keys.windows(2) {
            assert!(window[0] < window[1], "{} should be < {}", window[0], window[1]);
        }
    }

    #[test]
    fn test_sequential_insertions_at_beginning() {
        let mut keys = vec![key_between(None, None).unwrap()];
        for _ in 0..20 {
            let first = keys.first().unwrap().clone();
            let new_key = key_between(None, Some(&first)).unwrap();
            assert!(
                new_key.as_str() < first.as_str(),
                "{new_key} should be < {first}"
            );
            keys.insert(0, new_key);
        }
        for window in keys.windows(2) {
            assert!(window[0] < window[1], "{} should be < {}", window[0], window[1]);
        }
    }

    #[test]
    fn test_sequential_insertions_between() {
        let mut lo = "a".to_string();
        let hi = "b".to_string();
        let mut keys = vec![];
        for _ in 0..20 {
            let key = key_between(Some(&lo), Some(&hi)).unwrap();
            assert!(key.as_str() > lo.as_str(), "{key} should be > {lo}");
            assert!(key.as_str() < hi.as_str(), "{key} should be < {hi}");
            keys.push(key.clone());
            lo = key;
        }
    }

    #[test]
    fn test_n_keys_between_zero() {
        let keys = n_keys_between(None, None, 0).unwrap();
        assert!(keys.is_empty());
    }

    #[test]
    fn test_n_keys_between_one() {
        let keys = n_keys_between(None, None, 1).unwrap();
        assert_eq!(keys.len(), 1);
    }

    #[test]
    fn test_n_keys_between_multiple() {
        let keys = n_keys_between(Some("a"), Some("z"), 5).unwrap();
        assert_eq!(keys.len(), 5);

        for window in keys.windows(2) {
            assert!(window[0] < window[1], "{} should be < {}", window[0], window[1]);
        }

        for key in &keys {
            assert!(key.as_str() > "a", "{key} should be > a");
            assert!(key.as_str() < "z", "{key} should be < z");
        }
    }

    #[test]
    fn test_n_keys_between_at_end() {
        let keys = n_keys_between(Some("a"), None, 5).unwrap();
        assert_eq!(keys.len(), 5);
        for window in keys.windows(2) {
            assert!(window[0] < window[1], "{} should be < {}", window[0], window[1]);
        }
        assert!(keys[0].as_str() > "a");
    }

    #[test]
    fn test_n_keys_between_at_beginning() {
        let keys = n_keys_between(None, Some("z"), 5).unwrap();
        assert_eq!(keys.len(), 5);
        for window in keys.windows(2) {
            assert!(window[0] < window[1], "{} should be < {}", window[0], window[1]);
        }
        assert!(keys.last().unwrap().as_str() < "z");
    }

    #[test]
    fn test_before_not_less_than_after() {
        let result = key_between(Some("b"), Some("a"));
        assert!(matches!(result, Err(FractionalIndexError::InvalidOrder { .. })));
    }

    #[test]
    fn test_before_equal_to_after() {
        let result = key_between(Some("a"), Some("a"));
        assert!(matches!(result, Err(FractionalIndexError::InvalidOrder { .. })));
    }

    #[test]
    fn test_multichar_keys() {
        let k1 = key_between(Some("aa"), Some("ab")).unwrap();
        assert!(k1.as_str() > "aa");
        assert!(k1.as_str() < "ab");
    }

    #[test]
    fn test_generate_after_max() {
        let key = key_between(Some("zzz"), None).unwrap();
        assert!(key.as_str() > "zzz");
    }

    // ── New edge-case tests ─────────────────────────────────────────────

    #[test]
    fn test_prefix_bound_case() {
        // This was the original bug: key_between("a", "a0") returned "a0i" > "a0"
        let key = key_between(Some("a"), Some("a5")).unwrap();
        assert!(key.as_str() > "a", "{key} should be > a");
        assert!(key.as_str() < "a5", "{key} should be < a5");
    }

    #[test]
    fn test_prefix_bound_a_a1() {
        let key = key_between(Some("a"), Some("a1")).unwrap();
        assert!(key.as_str() > "a", "{key} should be > a");
        assert!(key.as_str() < "a1", "{key} should be < a1");
    }

    #[test]
    fn test_prefix_bound_a_az() {
        let key = key_between(Some("a"), Some("az")).unwrap();
        assert!(key.as_str() > "a", "{key} should be > a");
        assert!(key.as_str() < "az", "{key} should be < az");
    }

    #[test]
    fn test_invalid_character_returns_error() {
        let result = key_between(Some("A"), None);
        assert!(matches!(result, Err(FractionalIndexError::InvalidCharacter('A'))));
    }

    #[test]
    fn test_invalid_character_in_after() {
        let result = key_between(None, Some("A"));
        assert!(matches!(result, Err(FractionalIndexError::InvalidCharacter('A'))));
    }

    #[test]
    fn test_invalid_character_special() {
        let result = key_between(Some("a/b"), None);
        assert!(matches!(result, Err(FractionalIndexError::InvalidCharacter('/'))));
    }

    #[test]
    fn test_error_display() {
        let err = FractionalIndexError::InvalidCharacter('Z');
        assert_eq!(err.to_string(), "invalid base-36 digit: 'Z'");

        let err = FractionalIndexError::InvalidOrder {
            before: "b".into(),
            after: "a".into(),
        };
        assert_eq!(err.to_string(), "before (b) must be less than after (a)");
    }
}
