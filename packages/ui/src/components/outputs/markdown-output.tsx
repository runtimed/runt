"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@runtimed/ui/lib/utils";

import "katex/dist/katex.min.css";

interface MarkdownOutputProps {
  /**
   * The markdown content to render
   */
  content: string;
  /**
   * Additional CSS classes
   */
  className?: string;
  /**
   * Enable copy button on code blocks
   */
  enableCopyCode?: boolean;
  /**
   * Allow raw HTML in markdown (requires iframe for security).
   * When true, throws an error if not running inside an iframe.
   */
  unsafe?: boolean;
}

/**
 * Check if the current window is inside an iframe
 */
function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

interface CodeBlockProps {
  children: string;
  language?: string;
  enableCopy?: boolean;
}

function CodeBlock({
  children,
  language = "",
  enableCopy = true,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  return (
    <div className="group/codeblock relative">
      <SyntaxHighlighter
        language={language}
        style={oneLight}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "0.75rem",
          fontSize: "0.875rem",
          overflow: "auto",
          background: "#fafafa",
          borderRadius: "0.375rem",
        }}
      >
        {children}
      </SyntaxHighlighter>
      {enableCopy && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 z-10 rounded border border-gray-200 bg-white p-1.5 text-gray-600 opacity-0 shadow-sm transition-opacity group-hover/codeblock:opacity-100 hover:bg-gray-50 hover:text-gray-800"
          title={copied ? "Copied!" : "Copy code"}
          type="button"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}

/**
 * MarkdownOutput component for rendering Markdown content in notebook outputs
 *
 * Supports:
 * - GitHub Flavored Markdown (tables, strikethrough, task lists, autolinks)
 * - Math/LaTeX via KaTeX
 * - Syntax highlighted code blocks with copy button
 * - Raw HTML (when unsafe={true} and in iframe)
 */
export function MarkdownOutput({
  content,
  className = "",
  enableCopyCode = true,
  unsafe = false,
}: MarkdownOutputProps) {
  if (!content) {
    return null;
  }

  // Check iframe requirement for unsafe mode
  if (unsafe && typeof window !== "undefined" && !isInIframe()) {
    throw new Error(
      "MarkdownOutput with unsafe={true} must be rendered inside an iframe for security. " +
        "Use unsafe={false} to disable raw HTML rendering.",
    );
  }

  const remarkPlugins = [remarkGfm, remarkMath];
  const rehypePlugins = unsafe ? [rehypeKatex, rehypeRaw] : [rehypeKatex];

  return (
    <div
      data-slot="markdown-output"
      className={cn("not-prose py-2", className)}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          // Code blocks with syntax highlighting
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const language = match ? match[1] : "";
            const codeContent = String(children).replace(/\n$/, "");

            // Block code has newlines or a language class
            const isBlockCode = codeContent.includes("\n") || className;

            if (isBlockCode) {
              return (
                <CodeBlock language={language} enableCopy={enableCopyCode}>
                  {codeContent}
                </CodeBlock>
              );
            }

            // Inline code
            return (
              <code
                className="rounded bg-gray-100 px-1 py-0.5 text-sm text-gray-800"
                {...props}
              >
                {children}
              </code>
            );
          },

          // Links open in new tab
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                className="text-blue-600 hover:text-blue-800 hover:underline"
                rel="noopener noreferrer"
                target="_blank"
                {...props}
              >
                {children}
              </a>
            );
          },

          // Tables
          table({ children, ...props }) {
            return (
              <div className="my-4 overflow-x-auto">
                <table
                  className="min-w-full border-collapse border border-gray-300 bg-white text-sm"
                  {...props}
                >
                  {children}
                </table>
              </div>
            );
          },
          thead({ children, ...props }) {
            return (
              <thead className="bg-gray-50" {...props}>
                {children}
              </thead>
            );
          },
          tbody({ children, ...props }) {
            return (
              <tbody className="divide-y divide-gray-200" {...props}>
                {children}
              </tbody>
            );
          },
          tr({ children, ...props }) {
            return (
              <tr className="hover:bg-gray-50" {...props}>
                {children}
              </tr>
            );
          },
          th({ children, ...props }) {
            return (
              <th
                className="border border-gray-300 px-3 py-2 text-left font-semibold text-gray-900"
                {...props}
              >
                {children}
              </th>
            );
          },
          td({ children, ...props }) {
            return (
              <td
                className="border border-gray-300 px-3 py-2 text-gray-700"
                {...props}
              >
                {children}
              </td>
            );
          },

          // Headings
          h1({ children, ...props }) {
            return (
              <h1 className="mb-4 mt-6 text-2xl font-bold" {...props}>
                {children}
              </h1>
            );
          },
          h2({ children, ...props }) {
            return (
              <h2 className="mb-3 mt-5 text-xl font-bold" {...props}>
                {children}
              </h2>
            );
          },
          h3({ children, ...props }) {
            return (
              <h3 className="mb-2 mt-4 text-lg font-semibold" {...props}>
                {children}
              </h3>
            );
          },
          h4({ children, ...props }) {
            return (
              <h4 className="mb-2 mt-3 text-base font-semibold" {...props}>
                {children}
              </h4>
            );
          },
          h5({ children, ...props }) {
            return (
              <h5 className="mb-1 mt-2 text-sm font-semibold" {...props}>
                {children}
              </h5>
            );
          },
          h6({ children, ...props }) {
            return (
              <h6 className="mb-1 mt-2 text-sm font-medium" {...props}>
                {children}
              </h6>
            );
          },

          // Paragraphs
          p({ children, ...props }) {
            return (
              <p className="my-2 leading-relaxed" {...props}>
                {children}
              </p>
            );
          },

          // Lists
          ul({ children, ...props }) {
            return (
              <ul className="my-2 ml-6 list-disc" {...props}>
                {children}
              </ul>
            );
          },
          ol({ children, ...props }) {
            return (
              <ol className="my-2 ml-6 list-decimal" {...props}>
                {children}
              </ol>
            );
          },
          li({ children, ...props }) {
            return (
              <li className="my-1" {...props}>
                {children}
              </li>
            );
          },

          // Blockquotes
          blockquote({ children, ...props }) {
            return (
              <blockquote
                className="my-4 border-l-4 border-gray-300 pl-4 italic text-gray-600"
                {...props}
              >
                {children}
              </blockquote>
            );
          },

          // Horizontal rule
          hr({ ...props }) {
            return <hr className="my-6 border-t border-gray-300" {...props} />;
          },

          // Images
          img({ src, alt, ...props }) {
            if (!src) return null;
            return (
              <img
                src={src}
                alt={alt || ""}
                className="my-4 max-w-full h-auto"
                {...props}
              />
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
