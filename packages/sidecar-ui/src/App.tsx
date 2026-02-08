import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { MediaRouter } from "@runtimed/ui/components/outputs/media-router";
import { MediaProvider } from "@runtimed/ui/components/outputs/media-provider";
// Register built-in ipywidgets (IntSlider, etc.)
import "@runtimed/ui/components/widgets/controls";
import "@runtimed/ui/components/widgets/ipycanvas";
import {
  AnsiStreamOutput,
  AnsiErrorOutput,
} from "@runtimed/ui/components/outputs/ansi-output";
import { WidgetDebugger } from "@/components/widget-debugger";
import {
  WidgetStoreProvider,
  useWidgetStoreRequired,
} from "@runtimed/ui/components/widgets/widget-store-context";
import { WidgetView } from "@runtimed/ui/components/widgets/widget-view";
import type {
  JupyterMessage,
  JupyterOutput,
  MimeBundle,
  MimeMetadata,
  KernelInfoReplyContent,
} from "./types";
import {
  isDisplayData,
  isExecuteResult,
  isStream,
  isError,
  isClearOutput,
  isKernelInfoReply,
} from "./types";
import { cn } from "@runtimed/ui/lib/utils";
import { IconBrandDeno, IconBrandPython, IconLetterR } from "@tabler/icons-react";

interface OutputCellProps {
  output: JupyterOutput;
  index: number;
}

function OutputCell({ output, index }: OutputCellProps) {
  if (output.output_type === "stream") {
    return (
      <AnsiStreamOutput
        text={output.text}
        streamName={output.name}
        className="px-4"
      />
    );
  }

  if (output.output_type === "error") {
    return (
      <AnsiErrorOutput
        ename={output.ename}
        evalue={output.evalue}
        traceback={output.traceback}
        className="px-4"
      />
    );
  }

  // display_data or execute_result - MediaRouter handles widget detection
  // via the injected renderer from MediaProvider
  return (
    <div className="output-cell" data-index={index}>
      {output.execution_count != null && (
        <div className="px-4 py-1 text-xs text-muted-foreground font-mono">
          Out[{output.execution_count}]:
        </div>
      )}
      <div className="px-4">
        <MediaRouter
          data={output.data as Record<string, unknown>}
          metadata={output.metadata}
        />
      </div>
    </div>
  );
}

type SidecarGlobal = typeof globalThis & {
  onMessage?: (msg: unknown) => void;
  __sidecarPendingMessages?: unknown[];
  onSidecarInfo?: (msg: unknown) => void;
  __sidecarPendingInfoMessages?: unknown[];
};
type SidecarInfoMessage = { type: "kernel_cwd"; cwd: string };

function AppContent() {
  const [outputs, setOutputs] = useState<JupyterOutput[]>([]);
  const [kernelStatus, setKernelStatus] = useState<string>("unknown");
  const [kernelInfo, setKernelInfo] = useState<KernelInfoReplyContent | null>(
    null,
  );
  const [kernelCwd, setKernelCwd] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const outputAreaRef = useRef<HTMLDivElement>(null);
  const lastSeenCountRef = useRef(0);
  const outputsLengthRef = useRef(0);
  const { handleMessage: handleWidgetMessage } = useWidgetStoreRequired();
  const showWidgetDebugger = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("debug-widgets");
  }, []);
  const kernelLanguage = useMemo(() => {
    return kernelInfo?.language_info?.name?.toLowerCase() ?? null;
  }, [kernelInfo]);
  const KernelLogo = useMemo(() => {
    const impl = kernelInfo?.implementation?.toLowerCase() ?? "";
    if (impl.includes("deno")) {
      return IconBrandDeno;
    }
    if (kernelLanguage === "python") {
      return IconBrandPython;
    }
    if (kernelLanguage === "r") {
      return IconLetterR;
    }
    return null;
  }, [kernelLanguage, kernelInfo]);
  const kernelInfoLines = useMemo(() => {
    if (!kernelInfo) {
      return { primary: "kernel", secondary: null as string | null };
    }
    const implementation = kernelInfo.implementation?.trim() || "kernel";
    const implementationVersion = kernelInfo.implementation_version?.trim() || "";
    const languageName = kernelInfo.language_info?.name?.trim() || "lang";
    const languageVersion = kernelInfo.language_info?.version?.trim() || "";
    const primary = `${languageName} ${languageVersion}`.trim() || "kernel";
    const secondary = `${implementation} ${implementationVersion}`.trim();
    const dedupedSecondary =
      secondary && secondary.toLowerCase() !== primary.toLowerCase()
        ? secondary
        : null;
    return { primary, secondary: dedupedSecondary };
  }, [kernelInfo]);
  const kernelCwdText = useMemo(() => {
    if (!kernelCwd) {
      return null;
    }
    let cwd = kernelCwd.trim();
    if (
      (cwd.startsWith("'") && cwd.endsWith("'")) ||
      (cwd.startsWith('"') && cwd.endsWith('"'))
    ) {
      cwd = cwd.slice(1, -1);
    }
    cwd = cwd.replace(/^\/Users\/[^/]+/, "~");
    cwd = cwd.replace(/^\/home\/[^/]+/, "~");
    return cwd;
  }, [kernelCwd]);

  // Convert message to output format
  const messageToOutput = useCallback(
    (message: JupyterMessage): JupyterOutput | null => {
      if (isDisplayData(message)) {
        return {
          output_type: "display_data",
          data: message.content.data as MimeBundle,
          metadata: message.content.metadata as MimeMetadata,
        };
      }

      if (isExecuteResult(message)) {
        return {
          output_type: "execute_result",
          data: message.content.data as MimeBundle,
          metadata: message.content.metadata as MimeMetadata,
          execution_count: message.content.execution_count,
        };
      }

      if (isStream(message)) {
        return {
          output_type: "stream",
          name: message.content.name,
          text: message.content.text,
        };
      }

      if (isError(message)) {
        return {
          output_type: "error",
          ename: message.content.ename,
          evalue: message.content.evalue,
          traceback: message.content.traceback,
        };
      }

      return null;
    },
    [],
  );

  // Handle incoming Jupyter messages
  const handleMessage = useCallback(
    (message: JupyterMessage) => {
      // Decode base64 buffers to DataView (matching JupyterLab's format)
      // JupyterLab services deserializes buffers as DataView[], not ArrayBuffer[]
      // This is important for anywidgets like quak that expect buffers[i].buffer
      if (message.buffers && Array.isArray(message.buffers)) {
        message.buffers = message.buffers.map((b64) => {
          if (typeof b64 === "string") {
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            return new DataView(bytes.buffer);
          }
          // If already a DataView or ArrayBuffer, wrap in DataView for consistency
          if (b64 instanceof ArrayBuffer) {
            return new DataView(b64);
          }
          return b64;
        });
      }

      // Route comm messages to widget store
      const msgType = message.header.msg_type;
      if (
        msgType === "comm_open" ||
        msgType === "comm_msg" ||
        msgType === "comm_close"
      ) {
        handleWidgetMessage(
          message as Parameters<typeof handleWidgetMessage>[0],
        );
      }

      // Handle kernel info
      if (isKernelInfoReply(message)) {
        setKernelInfo(message.content);
        setKernelStatus("idle");
        return;
      }

      // Handle clear_output
      if (isClearOutput(message)) {
        if (message.content.wait) {
          // TODO: handle wait flag (clear on next output)
        } else {
          setOutputs([]);
        }
        return;
      }

      // Handle status updates
      if (message.header.msg_type === "status") {
        const status = (message as { content: { execution_state: string } })
          .content.execution_state;
        setKernelStatus(status);
        return;
      }

      // Convert to output and append
      const output = messageToOutput(message);
      if (output) {
        setOutputs((prev) => {
          // Merge consecutive stream outputs of the same type
          if (output.output_type === "stream" && prev.length > 0) {
            const lastOutput = prev[prev.length - 1];
            if (
              lastOutput.output_type === "stream" &&
              lastOutput.name === output.name
            ) {
              return [
                ...prev.slice(0, -1),
                {
                  ...lastOutput,
                  text: lastOutput.text + output.text,
                },
              ];
            }
          }
          return [...prev, output];
        });
      }
    },
    [messageToOutput, handleWidgetMessage],
  );

  // Register global message handler
  useEffect(() => {
    // @ts-expect-error - globalThis.onMessage is set by Rust
    globalThis.onMessage = handleMessage;
    const sidecarGlobal = globalThis as SidecarGlobal;
    const pending = sidecarGlobal.__sidecarPendingMessages;
    if (pending && pending.length > 0) {
      sidecarGlobal.__sidecarPendingMessages = [];
      pending.forEach((message) => {
        handleMessage(message as JupyterMessage);
      });
    }
    const handleSidecarInfo = (message: SidecarInfoMessage) => {
      if (message.type === "kernel_cwd") {
        setKernelCwd(message.cwd);
      }
    };
    sidecarGlobal.onSidecarInfo = (message: unknown) => {
      handleSidecarInfo(message as SidecarInfoMessage);
    };
    const pendingInfo = sidecarGlobal.__sidecarPendingInfoMessages;
    if (pendingInfo && pendingInfo.length > 0) {
      sidecarGlobal.__sidecarPendingInfoMessages = [];
      pendingInfo.forEach((message) => {
        handleSidecarInfo(message as SidecarInfoMessage);
      });
    }
    fetch("/ready", { method: "POST" }).catch((err) => {
      console.error("[sidecar] Failed to notify ready:", err);
    });

    return () => {
      // @ts-expect-error - cleanup
      delete globalThis.onMessage;
      delete sidecarGlobal.onSidecarInfo;
    };
  }, [handleMessage]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const scrollEl = document.scrollingElement ?? document.documentElement;
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior });
  }, []);

  // Track scrolling state to determine whether to auto-scroll
  useEffect(() => {
    const handleScroll = () => {
      const scrollEl = document.scrollingElement ?? document.documentElement;
      const distanceFromBottom =
        scrollEl.scrollHeight - (scrollEl.scrollTop + scrollEl.clientHeight);
      const atBottom = distanceFromBottom < 120;
      if (atBottom) {
        setAutoScroll(true);
        setUnseenCount(0);
        lastSeenCountRef.current = outputsLengthRef.current;
      } else {
        setAutoScroll(false);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Auto-scroll to bottom on new outputs unless user scrolled up
  useEffect(() => {
    outputsLengthRef.current = outputs.length;
    if (autoScroll) {
      scrollToBottom();
      lastSeenCountRef.current = outputs.length;
      setUnseenCount(0);
      return;
    }

    if (outputs.length > lastSeenCountRef.current) {
      setUnseenCount(outputs.length - lastSeenCountRef.current);
    }
  }, [outputs, autoScroll, scrollToBottom]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="grid h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-4">
          <h1 className="flex min-w-0 items-center gap-2 justify-self-start">
            {KernelLogo ? (
              <KernelLogo className="h-4 w-4 text-muted-foreground" stroke={1.8} />
            ) : null}
            <span className="flex flex-col leading-tight text-muted-foreground">
              <span className="text-[11px]">{kernelInfoLines.primary}</span>
              {kernelInfoLines.secondary ? (
                <span className="text-[10px] opacity-90">{kernelInfoLines.secondary}</span>
              ) : null}
            </span>
          </h1>
          <div className="max-w-[55vw] truncate text-center text-xs font-mono text-muted-foreground">
            {kernelCwdText}
          </div>
          <div className="flex items-center gap-2 justify-self-end">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                kernelStatus === "idle" && "bg-green-500",
                kernelStatus === "busy" && "bg-amber-500",
                kernelStatus === "starting" && "bg-blue-500",
                kernelStatus === "unknown" && "bg-gray-400",
              )}
            />
            <span className="text-xs text-muted-foreground capitalize">
              {kernelStatus}
            </span>
          </div>
        </div>
      </header>

      {/* Output Area */}
      <main ref={outputAreaRef} className="max-w-4xl mx-auto py-4">
        {outputs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <p className="text-sm">Waiting for outputs...</p>
            <p className="text-xs mt-1">
              Execute code in your repl to see results here
            </p>
          </div>
        ) : (
          outputs.map((output, index) => (
            <OutputCell key={index} output={output} index={index} />
          ))
        )}
      </main>

      {/* Widget Debugger Panel */}
      {showWidgetDebugger ? <WidgetDebugger /> : null}

      {/* Outputs below indicator */}
      {!autoScroll && unseenCount > 0 ? (
        <button
          type="button"
          className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border bg-background/95 px-4 py-2 text-xs font-medium shadow-sm backdrop-blur supports-backdrop-filter:bg-background/60"
          onClick={() => {
            scrollToBottom("smooth");
            setAutoScroll(true);
            setUnseenCount(0);
            lastSeenCountRef.current = outputs.length;
          }}
        >
          {unseenCount} output{unseenCount === 1 ? "" : "s"} below
        </button>
      ) : null}
    </div>
  );
}

export default function App() {
  const sendMessage = useCallback(
    (
      msg: Parameters<typeof fetch>[1] extends { body: infer B } ? B : unknown,
    ) => {
      fetch("/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(msg),
      }).catch((err) => {
        console.error("[sidecar] Failed to send message:", err);
      });
    },
    [],
  );

  return (
    <WidgetStoreProvider sendMessage={sendMessage}>
      <MediaProvider
        renderers={{
          "application/vnd.jupyter.widget-view+json": ({ data }) => {
            const { model_id } = data as { model_id: string };
            return <WidgetView modelId={model_id} />;
          },
        }}
      >
        <AppContent />
      </MediaProvider>
    </WidgetStoreProvider>
  );
}
