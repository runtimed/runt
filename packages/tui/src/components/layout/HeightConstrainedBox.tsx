import React from "react";
import { Box, Text } from "ink";
import { Colors } from "../../utils/colors.ts";

interface HeightConstrainedBoxProps {
  children: React.ReactNode;
  maxHeight: number;
  showOverflowIndicator?: boolean;
  overflowDirection?: "top" | "bottom";
}

export const HeightConstrainedBox: React.FC<HeightConstrainedBoxProps> = ({
  children,
  maxHeight,
  showOverflowIndicator = true,
  overflowDirection = "bottom",
}) => {
  const childArray = React.Children.toArray(children);
  const totalChildren = childArray.length;
  const canFit = totalChildren <= maxHeight;

  if (canFit) {
    return (
      <Box flexDirection="column">
        {children}
      </Box>
    );
  }

  const indicatorSpace = showOverflowIndicator ? 1 : 0;
  const safeMaxHeight = Math.max(1, maxHeight - indicatorSpace);

  const visibleChildren = overflowDirection === "top"
    ? childArray.slice(totalChildren - safeMaxHeight)
    : childArray.slice(0, safeMaxHeight);

  const hiddenCount = totalChildren - visibleChildren.length;

  return (
    <Box
      flexDirection="column"
      minHeight={Math.min(totalChildren + indicatorSpace, maxHeight)}
    >
      {showOverflowIndicator &&
        overflowDirection === "top" &&
        hiddenCount > 0 && (
        <Box justifyContent="center" height={1}>
          <Text color={Colors.UI.metadata}>
            ↑ {hiddenCount} item{hiddenCount === 1 ? "" : "s"} hidden above
          </Text>
        </Box>
      )}

      <Box flexDirection="column">{visibleChildren}</Box>

      {showOverflowIndicator &&
        overflowDirection === "bottom" &&
        hiddenCount > 0 && (
        <Box justifyContent="center" height={1}>
          <Text color={Colors.UI.metadata}>
            ↓ {hiddenCount} item{hiddenCount === 1 ? "" : "s"} hidden below
          </Text>
        </Box>
      )}
    </Box>
  );
};
