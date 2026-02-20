//! Fractional indexing for cell ordering.
//!
//! Uses base-36 strings that sort lexicographically, allowing insertions
//! between any two adjacent keys without reindexing. This is the Rust
//! equivalent of `generateKeyBetween` used in intheloop's schema.

const BASE: u32 = 36;
const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";

fn digit_value(c: u8) -> u32 {
    match c {
        b'0'..=b'9' => (c - b'0') as u32,
        b'a'..=b'z' => (c - b'a' + 10) as u32,
        _ => panic!("invalid base-36 digit: {}", c as char),
    }
}

fn digit_char(v: u32) -> u8 {
    DIGITS[v as usize]
}

/// Generate a key between two optional bounds.
///
/// - `key_between(None, None)` → midpoint key
/// - `key_between(None, Some(after))` → key before `after`
/// - `key_between(Some(before), None)` → key after `before`
/// - `key_between(Some(before), Some(after))` → key between `before` and `after`
///
/// Returns a lexicographically sortable base-36 string.
///
/// # Panics
///
/// Panics if `before >= after` when both are provided.
pub fn key_between(before: Option<&str>, after: Option<&str>) -> String {
    match (before, after) {
        (None, None) => String::from("a"),
        (None, Some(after)) => midpoint_string(&[], after.as_bytes()),
        (Some(before), None) => midpoint_string(before.as_bytes(), &[]),
        (Some(before), Some(after)) => {
            assert!(
                before < after,
                "before ({before}) must be less than after ({after})"
            );
            midpoint_string(before.as_bytes(), after.as_bytes())
        }
    }
}

/// Generate n keys evenly spaced between two bounds.
pub fn n_keys_between(before: Option<&str>, after: Option<&str>, n: usize) -> Vec<String> {
    if n == 0 {
        return vec![];
    }

    let mut result = Vec::with_capacity(n);
    let mut prev = before.map(|s| s.to_string());

    for _ in 0..n {
        let key = key_between(prev.as_deref(), after);
        result.push(key.clone());
        prev = Some(key);
    }

    result
}

/// Find a string that sorts between `a` and `b`.
///
/// When `a` is empty, it represents "before everything" (each digit = 0).
/// When `b` is empty, it represents "after everything" (each digit = BASE).
fn midpoint_string(a: &[u8], b: &[u8]) -> String {
    let max_len = a.len().max(b.len());
    let mut result = Vec::new();

    for i in 0..=max_len {
        let av = if i < a.len() {
            digit_value(a[i])
        } else {
            0
        };
        let bv = if i < b.len() {
            digit_value(b[i])
        } else {
            BASE
        };

        if av + 1 < bv {
            // There's room between these digits
            let mid = av + (bv - av) / 2;
            result.push(digit_char(mid));
            return String::from_utf8(result).unwrap();
        }

        // av and bv are adjacent or equal, carry the prefix digit and continue
        result.push(digit_char(av));
    }

    // Fallback: should not reach here if a < b, but append midpoint
    result.push(digit_char(BASE / 2));
    String::from_utf8(result).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_midpoint_none_none() {
        let key = key_between(None, None);
        assert_eq!(key, "a");
    }

    #[test]
    fn test_after_last() {
        let key = key_between(Some("a"), None);
        assert!(key.as_str() > "a");
    }

    #[test]
    fn test_before_first() {
        let key = key_between(None, Some("a"));
        assert!(key.as_str() < "a");
    }

    #[test]
    fn test_between_two_keys() {
        let key = key_between(Some("a"), Some("b"));
        assert!(key.as_str() > "a");
        assert!(key.as_str() < "b");
    }

    #[test]
    fn test_between_distant_keys() {
        let key = key_between(Some("a"), Some("z"));
        assert!(key.as_str() > "a");
        assert!(key.as_str() < "z");
    }

    #[test]
    fn test_between_adjacent_single_chars() {
        let key = key_between(Some("a"), Some("b"));
        assert!(key.as_str() > "a");
        assert!(key.as_str() < "b");
    }

    #[test]
    fn test_sequential_insertions_at_end() {
        let mut keys = vec![key_between(None, None)];
        for _ in 0..20 {
            let last = keys.last().unwrap().clone();
            let new_key = key_between(Some(&last), None);
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
        let mut keys = vec![key_between(None, None)];
        for _ in 0..20 {
            let first = keys.first().unwrap().clone();
            let new_key = key_between(None, Some(&first));
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
            let key = key_between(Some(&lo), Some(&hi));
            assert!(key.as_str() > lo.as_str(), "{key} should be > {lo}");
            assert!(key.as_str() < hi.as_str(), "{key} should be < {hi}");
            keys.push(key.clone());
            lo = key;
        }
    }

    #[test]
    fn test_n_keys_between_zero() {
        let keys = n_keys_between(None, None, 0);
        assert!(keys.is_empty());
    }

    #[test]
    fn test_n_keys_between_one() {
        let keys = n_keys_between(None, None, 1);
        assert_eq!(keys.len(), 1);
    }

    #[test]
    fn test_n_keys_between_multiple() {
        let keys = n_keys_between(Some("a"), Some("z"), 5);
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
        let keys = n_keys_between(Some("a"), None, 5);
        assert_eq!(keys.len(), 5);
        for window in keys.windows(2) {
            assert!(window[0] < window[1], "{} should be < {}", window[0], window[1]);
        }
        assert!(keys[0].as_str() > "a");
    }

    #[test]
    fn test_n_keys_between_at_beginning() {
        let keys = n_keys_between(None, Some("z"), 5);
        assert_eq!(keys.len(), 5);
        for window in keys.windows(2) {
            assert!(window[0] < window[1], "{} should be < {}", window[0], window[1]);
        }
        assert!(keys.last().unwrap().as_str() < "z");
    }

    #[test]
    #[should_panic(expected = "before")]
    fn test_before_not_less_than_after() {
        key_between(Some("b"), Some("a"));
    }

    #[test]
    #[should_panic(expected = "before")]
    fn test_before_equal_to_after() {
        key_between(Some("a"), Some("a"));
    }

    #[test]
    fn test_multichar_keys() {
        let k1 = key_between(Some("aa"), Some("ab"));
        assert!(k1.as_str() > "aa");
        assert!(k1.as_str() < "ab");
    }

    #[test]
    fn test_generate_after_max() {
        let key = key_between(Some("zzz"), None);
        assert!(key.as_str() > "zzz");
    }
}
