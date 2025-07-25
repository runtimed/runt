import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { Colors } from "../../utils/colors.ts";

interface ScrollableWithSelectionProps {
  children: React.ReactNode;
  maxHeight: number;
  selectedIndex: number;
  showOverflowIndicator?: boolean;
}

export const ScrollableWithSelection: React.FC<ScrollableWithSelectionProps> = (
  {
    children,
    maxHeight,
    selectedIndex,
    showOverflowIndicator = true,
  },
) => {
  const childArray = React.Children.toArray(children);
  const totalChildren = childArray.length;
  const canFit = totalChildren <= maxHeight;

  const { visibleChildren, startIndex, endIndex } = useMemo(() => {
    if (canFit) {
      return {
        visibleChildren: childArray,
        startIndex: 0,
        endIndex: totalChildren - 1,
      };
    }

    const indicatorSpace = showOverflowIndicator ? 1 : 0;
    const safeMaxHeight = Math.max(1, maxHeight - indicatorSpace);

    // Simple approach: keep selected item visible, preferring to show it in the middle
    let startIdx = Math.max(0, selectedIndex - Math.floor(safeMaxHeight / 2));
    let endIdx = Math.min(totalChildren - 1, startIdx + safeMaxHeight - 1);

    // Adjust if we're at the end and can show more items at the beginning
    if (endIdx - startIdx + 1 < safeMaxHeight && startIdx > 0) {
      startIdx = Math.max(0, endIdx - safeMaxHeight + 1);
    }

    const visible = childArray.slice(startIdx, endIdx + 1);

    return {
      visibleChildren: visible,
      startIndex: startIdx,
      endIndex: endIdx,
    };
  }, [
    childArray,
    totalChildren,
    selectedIndex,
    maxHeight,
    showOverflowIndicator,
    canFit,
  ]);

  if (canFit) {
    return (
      <Box flexDirection="column">
        {children}
      </Box>
    );
  }

  const hiddenAbove = startIndex;
  const hiddenBelow = totalChildren - 1 - endIndex;

  return (
    <Box
      flexDirection="column"
      minHeight={Math.min(
        totalChildren + (showOverflowIndicator ? 1 : 0),
        maxHeight,
      )}
    >
      {showOverflowIndicator && hiddenAbove > 0 && (
        <Box justifyContent="center" height={1}>
          <Text color={Colors.UI.metadata}>
            ↑ {hiddenAbove} cell{hiddenAbove === 1 ? "" : "s"} hidden above
          </Text>
        </Box>
      )}

      <Box flexDirection="column">{visibleChildren}</Box>

      {showOverflowIndicator && hiddenBelow > 0 && (
        <Box justifyContent="center" height={1}>
          <Text color={Colors.UI.metadata}>
            ↓ {hiddenBelow} cell{hiddenBelow === 1 ? "" : "s"} hidden below
          </Text>
        </Box>
      )}
    </Box>
  );
};
