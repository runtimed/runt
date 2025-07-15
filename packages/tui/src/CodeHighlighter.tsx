import React from "react";
import { Box, Text } from "ink";
import { common, createLowlight } from "lowlight";

// Configure lowlight
const lowlight = createLowlight(common);

// Simple theme colors for terminal
const themeColors: Record<string, string> = {
  "hljs-keyword": "blue",
  "hljs-string": "green",
  "hljs-number": "yellow",
  "hljs-comment": "gray",
  "hljs-function": "cyan",
  "hljs-variable": "white",
  "hljs-built_in": "magenta",
  "hljs-type": "blue",
  "hljs-literal": "yellow",
  "hljs-title": "cyan",
  "hljs-attr": "cyan",
  "hljs-name": "red",
  "hljs-tag": "red",
  "hljs-operator": "white",
  "hljs-punctuation": "white",
  "hljs-params": "white",
  "hljs-property": "cyan",
  "hljs-meta": "gray",
  "hljs-regexp": "green",
  "hljs-symbol": "yellow",
};

function renderHastNode(
  node: ReturnType<typeof lowlight.highlight> | any,
  inheritedColor?: string,
): React.ReactNode {
  if (node.type === "text") {
    return <Text color={inheritedColor}>{node.value}</Text>;
  }

  if (node.type === "element") {
    const nodeClasses: string[] =
      (node.properties?.["className"] as string[]) || [];
    let elementColor: string | undefined = undefined;

    // Find color for this element's class
    for (const className of nodeClasses) {
      if (themeColors[className]) {
        elementColor = themeColors[className];
        break;
      }
    }

    const colorToPassDown = elementColor || inheritedColor;

    const children = node.children?.map(
      (child: any, index: number) => (
        <React.Fragment key={index}>
          {renderHastNode(child, colorToPassDown)}
        </React.Fragment>
      ),
    );

    return <React.Fragment>{children}</React.Fragment>;
  }

  if (node.type === "root") {
    if (!node.children || node.children.length === 0) {
      return null;
    }

    return node.children?.map((child: any, index: number) => (
      <React.Fragment key={index}>
        {renderHastNode(child, inheritedColor)}
      </React.Fragment>
    ));
  }

  return null;
}

interface CodeHighlighterProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
}

export const CodeHighlighter: React.FC<CodeHighlighterProps> = ({
  code,
  language = "python",
  showLineNumbers = false,
}) => {
  const codeToHighlight = code.replace(/\n$/, "");

  try {
    const lines = codeToHighlight.split("\n");
    const padWidth = showLineNumbers ? String(lines.length).length : 0;

    return (
      <Box flexDirection="column">
        {lines.map((line, index) => {
          const highlightedLine = !language || !lowlight.registered(language)
            ? lowlight.highlightAuto(line)
            : lowlight.highlight(language, line);

          const renderedNode = renderHastNode(highlightedLine);
          const contentToRender = renderedNode !== null ? renderedNode : line;

          return (
            <Box key={index}>
              {showLineNumbers && (
                <Text color="gray">
                  {`${String(index + 1).padStart(padWidth, " ")} `}
                </Text>
              )}
              <Text wrap="wrap">{contentToRender}</Text>
            </Box>
          );
        })}
      </Box>
    );
  } catch (_error) {
    // Fallback to plain text on error
    const lines = codeToHighlight.split("\n");
    const padWidth = showLineNumbers ? String(lines.length).length : 0;

    return (
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Box key={index}>
            {showLineNumbers && (
              <Text color="gray">
                {`${String(index + 1).padStart(padWidth, " ")} `}
              </Text>
            )}
            <Text>{line}</Text>
          </Box>
        ))}
      </Box>
    );
  }
};
