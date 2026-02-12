/**
 * Jupyter Protocol Message Types for Sidecar UI
 */

export interface Header<MsgType extends string = string> {
  msg_id: string;
  msg_type: MsgType;
  username: string;
  session: string;
  date: string;
  version: string;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface JupyterWidgetDisplayData {
  model_id: string;
  version_major: number;
  version_minor: number;
}

export type MimeBundle = {
  "text/plain"?: string;
  "text/html"?: string;
  "text/markdown"?: string;
  "image/png"?: string;
  "image/jpeg"?: string;
  "image/gif"?: string;
  "image/svg+xml"?: string;
  "application/json"?: JsonValue;
  "application/vnd.jupyter.widget-view+json"?: JupyterWidgetDisplayData;
  [mimeType: string]: unknown;
};

export type MimeMetadata = {
  [mimeType: string]:
    | {
        width?: number;
        height?: number;
        [key: string]: unknown;
      }
    | undefined;
};

// Output types
export interface DisplayDataContent {
  data: MimeBundle;
  metadata?: MimeMetadata;
  transient?: { display_id?: string };
}

export interface ExecuteResultContent {
  data: MimeBundle;
  metadata?: MimeMetadata;
  execution_count: number | null;
}

export interface StreamContent {
  name: "stdout" | "stderr";
  text: string;
}

export interface ErrorContent {
  ename: string;
  evalue: string;
  traceback: string[];
}

export interface CommOpenContent {
  comm_id: string;
  target_name: string;
  data: {
    buffer_paths?: string[];
    state: Record<string, unknown>;
  };
}

export interface CommMsgContent {
  comm_id: string;
  data: Record<string, unknown>;
}

export interface CommCloseContent {
  comm_id: string;
  data?: Record<string, unknown>;
}

export interface ExecuteInputContent {
  code: string;
  execution_count: number;
}

export interface StatusContent {
  execution_state: "busy" | "idle" | "starting";
}

export interface ClearOutputContent {
  wait: boolean;
}

export interface KernelInfoReplyContent {
  status: string;
  protocol_version: string;
  implementation: string;
  implementation_version: string;
  language_info: {
    name: string;
    version: string;
    mimetype?: string;
    file_extension?: string;
    pygments_lexer?: string;
    codemirror_mode?: unknown;
    nbconvert_exporter?: string;
  };
  banner?: string;
  help_links?: Array<{ text: string; url: string }>;
  debugger?: boolean;
  error?: unknown;
}

// Message types
export interface DisplayDataMessage {
  header: Header<"display_data">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: DisplayDataContent;
  buffers: unknown[];
  channel?: string;
}

export interface ExecuteResultMessage {
  header: Header<"execute_result">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: ExecuteResultContent;
  buffers: unknown[];
  channel?: string;
}

export interface StreamMessage {
  header: Header<"stream">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: StreamContent;
  buffers: unknown[];
  channel?: string;
}

export interface ErrorMessage {
  header: Header<"error">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: ErrorContent;
  buffers: unknown[];
  channel?: string;
}

export interface CommOpenMessage {
  header: Header<"comm_open">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: CommOpenContent;
  buffers: unknown[];
  channel?: string;
}

export interface CommMsgMessage {
  header: Header<"comm_msg">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: CommMsgContent;
  buffers: unknown[];
  channel?: string;
}

export interface CommCloseMessage {
  header: Header<"comm_close">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: CommCloseContent;
  buffers: unknown[];
  channel?: string;
}

export interface ExecuteInputMessage {
  header: Header<"execute_input">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: ExecuteInputContent;
  buffers: unknown[];
  channel?: string;
}

export interface StatusMessage {
  header: Header<"status">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: StatusContent;
  buffers: unknown[];
  channel?: string;
}

export interface ClearOutputMessage {
  header: Header<"clear_output">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: ClearOutputContent;
  buffers: unknown[];
  channel?: string;
}

export interface KernelInfoReplyMessage {
  header: Header<"kernel_info_reply">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: KernelInfoReplyContent;
  buffers: unknown[];
  channel?: string;
}

export interface UpdateDisplayDataMessage {
  header: Header<"update_display_data">;
  parent_header: Header | null;
  metadata: Record<string, unknown>;
  content: DisplayDataContent;
  buffers: unknown[];
  channel?: string;
}

export type JupyterMessage =
  | DisplayDataMessage
  | ExecuteResultMessage
  | StreamMessage
  | ErrorMessage
  | CommOpenMessage
  | CommMsgMessage
  | CommCloseMessage
  | ExecuteInputMessage
  | StatusMessage
  | ClearOutputMessage
  | KernelInfoReplyMessage
  | UpdateDisplayDataMessage;

// Type guards
export function isDisplayData(msg: JupyterMessage): msg is DisplayDataMessage {
  return msg.header.msg_type === "display_data";
}

export function isExecuteResult(
  msg: JupyterMessage,
): msg is ExecuteResultMessage {
  return msg.header.msg_type === "execute_result";
}

export function isStream(msg: JupyterMessage): msg is StreamMessage {
  return msg.header.msg_type === "stream";
}

export function isError(msg: JupyterMessage): msg is ErrorMessage {
  return msg.header.msg_type === "error";
}

export function isCommOpen(msg: JupyterMessage): msg is CommOpenMessage {
  return msg.header.msg_type === "comm_open";
}

export function isCommMsg(msg: JupyterMessage): msg is CommMsgMessage {
  return msg.header.msg_type === "comm_msg";
}

export function isCommClose(msg: JupyterMessage): msg is CommCloseMessage {
  return msg.header.msg_type === "comm_close";
}

export function isExecuteInput(
  msg: JupyterMessage,
): msg is ExecuteInputMessage {
  return msg.header.msg_type === "execute_input";
}

export function isStatus(msg: JupyterMessage): msg is StatusMessage {
  return msg.header.msg_type === "status";
}

export function isClearOutput(msg: JupyterMessage): msg is ClearOutputMessage {
  return msg.header.msg_type === "clear_output";
}

export function isKernelInfoReply(
  msg: JupyterMessage,
): msg is KernelInfoReplyMessage {
  return msg.header.msg_type === "kernel_info_reply";
}

export function isUpdateDisplayData(
  msg: JupyterMessage,
): msg is UpdateDisplayDataMessage {
  return msg.header.msg_type === "update_display_data";
}

export function hasDisplayData(
  msg: JupyterMessage,
): msg is DisplayDataMessage | ExecuteResultMessage {
  return isDisplayData(msg) || isExecuteResult(msg);
}

// Jupyter output type (for storing in state)
export type JupyterOutput =
  | {
      output_type: "execute_result" | "display_data";
      data: MimeBundle;
      metadata?: MimeMetadata;
      execution_count?: number | null;
      display_id?: string;
      parentMsgId?: string;
    }
  | {
      output_type: "stream";
      name: "stdout" | "stderr";
      text: string;
      parentMsgId?: string;
    }
  | {
      output_type: "error";
      ename: string;
      evalue: string;
      traceback: string[];
      parentMsgId?: string;
    };
