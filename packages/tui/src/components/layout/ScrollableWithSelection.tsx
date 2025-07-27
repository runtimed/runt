import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { Colors } from "../../utils/colors.ts";

interface ScrollableWithSelectionProps {
  children: React.ReactNode;
  maxHeight: number;
  selectedIndex: number;
  showOverflowIndicator?: boolean;
  itemHeights: number[]; // New prop for individual item heights
}

export const ScrollableWithSelection: React.FC<ScrollableWithSelectionProps> = (
  {
    children,
    maxHeight,
    selectedIndex,
    showOverflowIndicator = true,
    itemHeights,
  },
) => {
  const childArray = React.Children.toArray(children);
  const totalChildren = childArray.length;

  const {
    visibleChildren,
    startIndex,
    endIndex,
    hiddenAboveCells,
    hiddenBelowCells,
  } = useMemo(() => {
    // Simplified logic: ensure selected item is visible and fill around it
    if (totalChildren === 0) {
      return {
        visibleChildren: [],
        startIndex: 0,
        endIndex: -1,
        hiddenAboveCells: 0,
        hiddenBelowCells: 0,
      };
    }

    // Clamp selectedIndex to valid range
    const safeSelectedIndex = Math.max(
      0,
      Math.min(selectedIndex, totalChildren - 1),
    );

    let startIdx = safeSelectedIndex;
    let endIdx = safeSelectedIndex;
    let currentHeight = itemHeights[safeSelectedIndex] || 1;

    // Expand downward first
    while (endIdx + 1 < totalChildren) {
      const nextHeight = itemHeights[endIdx + 1] || 1;
      if (currentHeight + nextHeight > maxHeight) break;
      endIdx++;
      currentHeight += nextHeight;
    }

    // Then expand upward
    while (startIdx > 0) {
      const prevHeight = itemHeights[startIdx - 1] || 1;
      if (currentHeight + prevHeight > maxHeight) break;
      startIdx--;
      currentHeight += prevHeight;
    }

    // Calculate hidden cells
    const _hiddenAboveCells = startIdx;
    const _hiddenBelowCells = Math.max(0, totalChildren - 1 - endIdx);

    const visible = childArray.slice(startIdx, endIdx + 1);

    return {
      visibleChildren: visible,
      startIndex: startIdx,
      endIndex: endIdx,
      hiddenAboveCells: _hiddenAboveCells,
      hiddenBelowCells: _hiddenBelowCells,
    };
  }, [
    childArray,
    totalChildren,
    selectedIndex,
    maxHeight,
    itemHeights,
  ]);

  const hasIndicators = showOverflowIndicator &&
    (hiddenAboveCells > 0 || hiddenBelowCells > 0);
  const contentBoxHeight = maxHeight - (hasIndicators ? 2 : 0); // 2 lines for indicators if present

  return (
    <Box flexDirection="column">
      {showOverflowIndicator && hiddenAboveCells > 0 && (
        <Box justifyContent="center" height={1}>
          <Text color={Colors.UI.metadata}>
            ↑ {hiddenAboveCells} cell{hiddenAboveCells === 1 ? "" : "s"}{" "}
            hidden above
          </Text>
        </Box>
      )}

      <Box flexDirection="column">
        {visibleChildren}
      </Box>

      {showOverflowIndicator && hiddenBelowCells > 0 && (
        <Box justifyContent="center" height={1}>
          <Text color={Colors.UI.metadata}>
            ↓ {hiddenBelowCells} cell{hiddenBelowCells === 1 ? "" : "s"}{" "}
            hidden below
          </Text>
        </Box>
      )}
    </Box>
  );
};
