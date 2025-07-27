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

  const { visibleChildren, startIndex, endIndex, totalVisibleHeight, hiddenAboveLines, hiddenBelowLines } = useMemo(() => {
    let currentHeight = 0;
    let startIdx = 0;
    let endIdx = 0;

    // Calculate the ideal start index to keep selectedIndex in view
    // Try to center the selected item if possible
    let idealStartIdx = 0;
    let heightBeforeSelected = 0;
    for (let i = 0; i < selectedIndex; i++) {
      heightBeforeSelected += itemHeights[i] || 0;
    }

    // Estimate how many items can fit above the selected item
    let estimatedItemsAbove = 0;
    let currentHeightAbove = 0;
    for (let i = selectedIndex - 1; i >= 0; i--) {
      currentHeightAbove += itemHeights[i] || 0;
      if (currentHeightAbove > maxHeight / 2) {
        break;
      }
      estimatedItemsAbove++;
    }
    idealStartIdx = Math.max(0, selectedIndex - estimatedItemsAbove);

    // Determine the actual visible range
    currentHeight = 0;
    startIdx = idealStartIdx;
    for (let i = idealStartIdx; i < totalChildren; i++) {
      currentHeight += itemHeights[i] || 0;
      if (currentHeight > maxHeight) {
        endIdx = i - 1;
        break;
      }
      endIdx = i;
    }

    // Adjust if selectedIndex is not in view
    if (selectedIndex < startIdx) {
      startIdx = selectedIndex;
      currentHeight = 0;
      for (let i = selectedIndex; i < totalChildren; i++) {
        currentHeight += itemHeights[i] || 0;
        if (currentHeight > maxHeight) {
          endIdx = i - 1;
          break;
        }
        endIdx = i;
      }
    } else if (selectedIndex > endIdx) {
      endIdx = selectedIndex;
      currentHeight = 0;
      for (let i = selectedIndex; i >= 0; i--) {
        currentHeight += itemHeights[i] || 0;
        if (currentHeight > maxHeight) {
          startIdx = i + 1;
          break;
        }
        startIdx = i;
      }
    }

    // Final adjustment to ensure we don't go out of bounds
    if (endIdx - startIdx + 1 > totalChildren) {
      startIdx = 0;
      endIdx = totalChildren - 1;
    }

    // Calculate total visible height
    const _totalVisibleHeight = itemHeights.slice(startIdx, endIdx + 1).reduce((sum, h) => sum + h, 0);

    // Calculate hidden lines
    const _hiddenAboveLines = itemHeights.slice(0, startIdx).reduce((sum, h) => sum + h, 0);
    const _hiddenBelowLines = itemHeights.slice(endIdx + 1).reduce((sum, h) => sum + h, 0);

    const visible = childArray.slice(startIdx, endIdx + 1);

    return {
      visibleChildren: visible,
      startIndex: startIdx,
      endIndex: endIdx,
      totalVisibleHeight: _totalVisibleHeight,
      hiddenAboveLines: _hiddenAboveLines,
      hiddenBelowLines: _hiddenBelowLines,
    };
  }, [
    childArray,
    totalChildren,
    selectedIndex,
    maxHeight,
    itemHeights,
  ]);

  const hasIndicators = showOverflowIndicator && (hiddenAboveLines > 0 || hiddenBelowLines > 0);
  const contentBoxHeight = maxHeight - (hasIndicators ? 2 : 0); // 2 lines for indicators if present

  return (
    <Box
      flexDirection="column"
      height={maxHeight} // The outer box should take up the full available height
    >
      {showOverflowIndicator && hiddenAboveLines > 0 && (
        <Box justifyContent="center" height={1}>
          <Text color={Colors.UI.metadata}>
            ↑ {hiddenAboveLines} lines hidden above
          </Text>
        </Box>
      )}

      {/* The content box should take up the remaining height after indicators */}
      <Box flexDirection="column" height={contentBoxHeight}>
        {visibleChildren}
      </Box>

      {showOverflowIndicator && hiddenBelowLines > 0 && (
        <Box justifyContent="center" height={1}>
          <Text color={Colors.UI.metadata}>
            ↓ {hiddenBelowLines} lines hidden below
          </Text>
        </Box>
      )}
    </Box>
  );
};
