import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Colors } from "../../utils/colors.ts";

interface ScrollableContainerProps {
  children: React.ReactNode;
  maxHeight: number;
  showScrollIndicators?: boolean;
  scrollOffset?: number;
  onScrollChange?: (offset: number) => void;
}

export const ScrollableContainer: React.FC<ScrollableContainerProps> = ({
  children,
  maxHeight,
  showScrollIndicators = true,
  scrollOffset = 0,
  onScrollChange,
}) => {
  const [internalScrollOffset, setInternalScrollOffset] = useState(
    scrollOffset,
  );
  const [isScrollable, setIsScrollable] = useState(false);
  const [totalHeight, setTotalHeight] = useState(0);
  const childrenRef = useRef<React.ReactNode[]>([]);

  const currentScrollOffset = onScrollChange
    ? scrollOffset
    : internalScrollOffset;

  // Process children to measure total height
  useEffect(() => {
    if (!children) return;

    const childArray = React.Children.toArray(children);
    childrenRef.current = childArray;
    setTotalHeight(childArray.length);
    setIsScrollable(childArray.length > maxHeight);
  }, [children, maxHeight]);

  // Handle scroll input (arrow keys, page up/down)
  useInput((input, key) => {
    if (!isScrollable) return;

    let newOffset = currentScrollOffset;

    if (key.upArrow) {
      newOffset = Math.max(0, currentScrollOffset - 1);
    } else if (key.downArrow) {
      newOffset = Math.min(totalHeight - maxHeight, currentScrollOffset + 1);
    } else if (key.pageUp) {
      newOffset = Math.max(0, currentScrollOffset - Math.floor(maxHeight / 2));
    } else if (key.pageDown) {
      newOffset = Math.min(
        totalHeight - maxHeight,
        currentScrollOffset + Math.floor(maxHeight / 2),
      );
    } else if (input === "g" || (key.ctrl && input === "a")) {
      // Go to top (like vim)
      newOffset = 0;
    } else if (input === "G" || (key.ctrl && input === "e")) {
      // Go to bottom (like vim)
      newOffset = Math.max(0, totalHeight - maxHeight);
    }

    if (newOffset !== currentScrollOffset) {
      if (onScrollChange) {
        onScrollChange(newOffset);
      } else {
        setInternalScrollOffset(newOffset);
      }
    }
  });

  const visibleChildren = React.Children.toArray(children).slice(
    currentScrollOffset,
    currentScrollOffset + maxHeight,
  );

  const canScrollUp = currentScrollOffset > 0;
  const canScrollDown = currentScrollOffset + maxHeight < totalHeight;

  return (
    <Box flexDirection="column" height={maxHeight}>
      {/* Top scroll indicator */}
      {showScrollIndicators && isScrollable && canScrollUp && (
        <Box justifyContent="center">
          <Text color={Colors.UI.metadata}>
            ↑ {currentScrollOffset} rows hidden above (↑/↓ to scroll)
          </Text>
        </Box>
      )}

      {/* Main content area */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleChildren}
      </Box>

      {/* Bottom scroll indicator */}
      {showScrollIndicators && isScrollable && canScrollDown && (
        <Box justifyContent="center">
          <Text color={Colors.UI.metadata}>
            ↓ {totalHeight - (currentScrollOffset + maxHeight)}{" "}
            rows hidden below
          </Text>
        </Box>
      )}

      {/* Scroll position indicator */}
      {showScrollIndicators && isScrollable && (
        <Box justifyContent="flex-end">
          <Text color={Colors.UI.metadata}>
            [{currentScrollOffset + 1}-
            {Math.min(currentScrollOffset + maxHeight, totalHeight)} of{" "}
            {totalHeight}]
          </Text>
        </Box>
      )}
    </Box>
  );
};
