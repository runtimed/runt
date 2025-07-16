import React from "react";
import { Box, Text } from "ink";
import { Colors } from "../../utils/colors.ts";

interface MarkdownRendererProps {
  content: string;
  compact?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  compact = false,
}: MarkdownRendererProps) => {
  const renderMarkdown = (text: string) => {
    const lines = text.split("\n");
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeBlockLanguage = "";
    let codeBlockLines: string[] = [];
    let lastWasEmpty = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || "";
      const trimmed = line.trim();

      // Code block handling
      if (trimmed.startsWith("```")) {
        if (inCodeBlock) {
          // End code block
          elements.push(
            <Box
              key={`code-${i}`}
              flexDirection="column"
              marginTop={compact ? 0 : 1}
              marginBottom={compact ? 0 : 1}
            >
              {!compact && codeBlockLanguage && (
                <Text color={Colors.UI.metadata}>{codeBlockLanguage}</Text>
              )}
              <Box
                borderStyle="round"
                borderColor={Colors.UI.border}
                paddingX={2}
                paddingY={1}
              >
                {codeBlockLines.map((codeLine, idx) => (
                  // @ts-expect-error - TUI Text component in Ink
                  <Text color={Colors.Syntax.string} key={idx}>
                    {codeLine || " "}
                  </Text>
                ))}
              </Box>
            </Box>,
          );
          inCodeBlock = false;
          codeBlockLanguage = "";
          codeBlockLines = [];
        } else {
          // Start code block
          inCodeBlock = true;
          codeBlockLanguage = trimmed.slice(3) || "";
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      // Headers
      if (trimmed.startsWith("#")) {
        const level = trimmed.match(/^#+/)?.[0].length || 1;
        const headerText = trimmed.slice(level || 0).trim();
        const headerColor = level === 1
          ? Colors.AccentGreen
          : level === 2
          ? Colors.AccentCyan
          : Colors.AccentYellow;

        elements.push(
          <Box
            key={`header-${i}`}
            marginTop={compact ? 0 : level === 1 ? 2 : 1}
            marginBottom={compact ? 0 : 1}
          >
            <Text color={headerColor} bold>
              {headerText}
            </Text>
          </Box>,
        );
        continue;
      }

      // Lists
      const listMatch = trimmed.match(/^(\s*)[-*+]\s+(.+)/);
      if (listMatch) {
        const [, indent = "", text = ""] = listMatch;
        const level = Math.floor(indent.length / 2);

        elements.push(
          <Box key={`list-${i}`} marginLeft={level * 2 + 1}>
            <Text color={Colors.AccentBlue}>•</Text>
            <Text>{renderInlineMarkdown(text || "")}</Text>
          </Box>,
        );
        continue;
      }

      // Numbered lists
      const numberedMatch = trimmed.match(/^(\s*)(\d+)\.\s+(.+)/);
      if (numberedMatch) {
        const [, indent = "", number = "", text = ""] = numberedMatch;
        const level = Math.floor(indent.length / 2);

        elements.push(
          <Box key={`numbered-${i}`} marginLeft={level * 2 + 1}>
            <Text color={Colors.AccentBlue}>{number}.</Text>
            <Text>{renderInlineMarkdown(text || "")}</Text>
          </Box>,
        );
        continue;
      }

      // Blockquotes
      if (trimmed.startsWith(">")) {
        const quoteText = trimmed.slice(1).trim();
        elements.push(
          <Box key={`quote-${i}`} marginLeft={2} marginY={compact ? 0 : 1}>
            <Text color={Colors.UI.metadata}>│</Text>
            <Text color={Colors.UI.metadata} italic>
              {renderInlineMarkdown(quoteText)}
            </Text>
          </Box>,
        );
        continue;
      }

      // Horizontal rules
      if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
        elements.push(
          <Box key={`hr-${i}`} marginY={compact ? 0 : 1}>
            <Text color={Colors.UI.border}>{"─".repeat(50)}</Text>
          </Box>,
        );
        continue;
      }

      // Empty lines
      if (trimmed === "") {
        if (!compact && !lastWasEmpty) {
          elements.push(<Box key={`empty-${i}`} height={1} />);
        }
        lastWasEmpty = true;
        continue;
      }
      lastWasEmpty = false;

      // Regular paragraphs
      elements.push(
        <Box key={`para-${i}`} marginBottom={compact ? 0 : 1}>
          <Text wrap="wrap">{renderInlineMarkdown(line || "")}</Text>
        </Box>,
      );
    }

    return elements;
  };

  const renderInlineMarkdown = (text: string): React.ReactNode => {
    // Handle inline code
    const codeRegex = /`([^`]+)`/g;
    const parts = text.split(codeRegex);

    return parts.map((part, index) => {
      const isCode = index % 2 === 1;

      if (isCode) {
        return (
          <Text
            // @ts-expect-error - TUI Text component in Ink
            key={index}
            color={Colors.Syntax.string}
            backgroundColor={Colors.UI.border}
          >
            {part}
          </Text>
        );
      }

      // Handle bold and italic
      let processedPart = part;

      // Simple bold/italic processing
      const boldRegex = /\*\*([^*]+)\*\*/g;
      const italicRegex = /\*([^*]+)\*/g;

      // For simplicity, just handle basic formatting
      if (boldRegex.test(processedPart)) {
        processedPart = processedPart.replace(boldRegex, "$1");
        return (
          // @ts-expect-error - TUI Text component in Ink
          <Text key={index} bold>
            {processedPart}
          </Text>
        );
      }

      if (italicRegex.test(processedPart)) {
        processedPart = processedPart.replace(italicRegex, "$1");
        return (
          // @ts-expect-error - TUI Text component in Ink
          <Text key={index} italic>
            {processedPart}
          </Text>
        );
      }

      // @ts-expect-error - TUI Text component in Ink
      return <Text key={index}>{processedPart}</Text>;
    });
  };

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">{renderMarkdown(content)}</Box>
    </Box>
  );
};
