/**
 * Fractional indexing implementation for deterministic ordering.
 * Based on the algorithm used by Figma, Linear, and other collaborative apps.
 *
 * Uses base-62 encoding (a-z, A-Z, 0-9) for lexicographic ordering.
 *
 * Usage with cells:
 * - Store the result in the `fractionalIndex` field
 * - Order cells by `fractionalIndex` ascending
 * - No need to update other cells when inserting
 */

const BASE = 62;
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Get the integer value of a base-62 digit.
 */
function digitValue(digit: string): number {
  const val = DIGITS.indexOf(digit);
  if (val === -1) {
    throw new Error(`Invalid digit: ${digit}`);
  }
  return val;
}

/**
 * Get the base-62 digit for an integer value.
 */
function valueToDigit(value: number): string {
  if (value < 0 || value >= BASE) {
    throw new Error(`Value out of range: ${value}`);
  }
  return DIGITS[value];
}

/**
 * Compare two fractional index strings.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
function compare(a: string, b: string): number {
  if (a === b) return 0;
  if (a < b) return -1;
  return 1;
}

/**
 * Get the midpoint between two strings.
 * If before is null, generates a string before after.
 * If after is null, generates a string after before.
 * If both are null, generates an initial string.
 *
 * @example
 * // First cell in notebook
 * const firstCell = fractionalIndexBetween(null, null); // "a0"
 *
 * // Insert after first cell
 * const secondCell = fractionalIndexBetween("a0", null); // "a1"
 *
 * // Insert between first and second
 * const middleCell = fractionalIndexBetween("a0", "a1"); // "a0V" (approx)
 */
export function fractionalIndexBetween(
  before: string | null | undefined,
  after: string | null | undefined,
): string {
  // Handle edge cases
  if (!before && !after) {
    return "a0"; // First position
  }

  if (!before) {
    // Insert at beginning - need to go before 'after'
    return fractionalIndexBefore(after!);
  }

  if (!after) {
    // Insert at end - need to go after 'before'
    return fractionalIndexAfter(before);
  }

  // Insert between two values
  if (compare(before, after) >= 0) {
    throw new Error(
      `Invalid order: before (${before}) must be less than after (${after})`,
    );
  }

  // Find the first differing position
  let pos = 0;
  while (
    pos < before.length && pos < after.length && before[pos] === after[pos]
  ) {
    pos++;
  }

  // If before is a prefix of after, we need to find a midpoint
  if (pos === before.length) {
    return before + midpoint("", after.slice(pos));
  }

  // If after is a prefix of before (shouldn't happen with valid ordering)
  if (pos === after.length) {
    throw new Error(
      `Invalid order: after (${after}) is a prefix of before (${before})`,
    );
  }

  // Find midpoint between the differing suffixes
  const beforeSuffix = before.slice(pos);
  const afterSuffix = after.slice(pos);
  const mid = midpoint(beforeSuffix, afterSuffix);

  return before.slice(0, pos) + mid;
}

/**
 * Generate a string that comes before the given string.
 */
function fractionalIndexBefore(after: string): string {
  // Find the last non-zero digit
  for (let i = after.length - 1; i >= 0; i--) {
    const digit = after[i];
    const value = digitValue(digit);

    if (value > 0) {
      // Can decrement this digit
      if (i === after.length - 1) {
        // Last digit - just decrement it
        return after.slice(0, i) + valueToDigit(value - 1);
      } else {
        // Not the last digit - decrement and append middle value
        const prefix = after.slice(0, i);
        const newDigit = valueToDigit(value - 1);
        return prefix + newDigit + valueToDigit(Math.floor(BASE / 2));
      }
    }
  }

  // All digits are 0, need to add a digit before
  return "0" + valueToDigit(Math.floor(BASE / 2));
}

/**
 * Generate a string that comes after the given string.
 */
function fractionalIndexAfter(before: string): string {
  // Find the last digit that's not at maximum
  for (let i = before.length - 1; i >= 0; i--) {
    const digit = before[i];
    const value = digitValue(digit);

    if (value < BASE - 1) {
      // Can increment this digit
      return before.slice(0, i) + valueToDigit(value + 1);
    }
  }

  // All digits are at maximum, need to append
  return before + "0";
}

/**
 * Find the midpoint between two strings.
 * Assumes before < after lexicographically.
 */
function midpoint(before: string, after: string): string {
  // Pad to same length
  const maxLen = Math.max(before.length, after.length);
  const paddedBefore = before.padEnd(maxLen, "0");
  const paddedAfter = after.padEnd(maxLen, "0");

  // Find first differing position
  let diffPos = 0;
  while (diffPos < maxLen && paddedBefore[diffPos] === paddedAfter[diffPos]) {
    diffPos++;
  }

  if (diffPos === maxLen) {
    // Strings are equal after padding - shouldn't happen
    throw new Error("Cannot find midpoint between equal strings");
  }

  const beforeValue = digitValue(paddedBefore[diffPos]);
  const afterValue = digitValue(paddedAfter[diffPos]);

  if (afterValue - beforeValue > 1) {
    // Can fit a value between them at this position
    const midValue = Math.floor((beforeValue + afterValue) / 2);
    return paddedBefore.slice(0, diffPos) + valueToDigit(midValue);
  }

  // Characters are adjacent (e.g., 'a' and 'b')
  // We need to extend with a fractional part

  // Take the lower value and extend it
  const base = paddedBefore.slice(0, diffPos + 1);

  // If we're at the last position or the remaining suffixes are equal,
  // just append a middle digit
  if (
    diffPos === maxLen - 1 ||
    paddedBefore.slice(diffPos + 1) === paddedAfter.slice(diffPos + 1)
  ) {
    return base + valueToDigit(Math.floor(BASE / 2));
  }

  // Otherwise, find midpoint of the remaining part
  const suffix = midpoint(
    paddedBefore.slice(diffPos + 1),
    paddedAfter.slice(diffPos + 1),
  );

  return base + suffix;
}

/**
 * Validate that a string is a valid fractional index.
 */
export function isValidFractionalIndex(index: string): boolean {
  if (!index || index.length === 0) {
    return false;
  }

  for (const char of index) {
    if (!DIGITS.includes(char)) {
      return false;
    }
  }

  return true;
}

/**
 * Generate the initial fractional index for a notebook.
 * Use this for the first cell's fractionalIndex field.
 */
export function initialFractionalIndex(): string {
  return "a0";
}

/**
 * Generate multiple evenly-spaced fractional indices.
 * Useful for bulk operations like importing multiple cells at once.
 * Each generated index can be assigned to a cell's fractionalIndex field.
 */
export function generateFractionalIndices(
  count: number,
  before?: string | null,
  after?: string | null,
): string[] {
  if (count <= 0) {
    return [];
  }

  if (count === 1) {
    return [fractionalIndexBetween(before, after)];
  }

  const indices: string[] = [];

  // Generate evenly spaced indices
  let prev = before;
  for (let i = 0; i < count; i++) {
    // For even spacing, we calculate intermediate positions
    const isLast = i === count - 1;
    const next = isLast ? after : null;

    const index = fractionalIndexBetween(prev, next);
    indices.push(index);
    prev = index;
  }

  return indices;
}
