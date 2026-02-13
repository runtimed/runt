export interface CodeCell {
  cell_type: "code";
  id: string;
  source: string;
  execution_count: number | null;
  outputs: JupyterOutput[];
}

export interface MarkdownCell {
  cell_type: "markdown";
  id: string;
  source: string;
}

export interface RawCell {
  cell_type: "raw";
  id: string;
  source: string;
}

export type NotebookCell = CodeCell | MarkdownCell | RawCell;

export type JupyterOutput =
  | {
      output_type: "execute_result" | "display_data";
      data: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      execution_count?: number | null;
    }
  | {
      output_type: "stream";
      name: "stdout" | "stderr";
      text: string;
    }
  | {
      output_type: "error";
      ename: string;
      evalue: string;
      traceback: string[];
    };

export interface KernelspecInfo {
  name: string;
  display_name: string;
  language: string;
}

export interface JupyterMessage {
  header: {
    msg_id: string;
    msg_type: string;
    session: string;
    username: string;
    date: string;
    version: string;
  };
  parent_header?: {
    msg_id: string;
    msg_type: string;
    session: string;
    username: string;
    date: string;
    version: string;
  };
  metadata: Record<string, unknown>;
  content: Record<string, unknown>;
  buffers?: unknown[];
  channel?: string;
  cell_id?: string;
}

// Environment preparation progress events
export type EnvProgressPhase =
  | { phase: "starting"; env_hash: string }
  | { phase: "cache_hit"; env_path: string }
  | { phase: "fetching_repodata"; channels: string[] }
  | { phase: "repodata_complete"; record_count: number; elapsed_ms: number }
  | { phase: "solving"; spec_count: number }
  | { phase: "solve_complete"; package_count: number; elapsed_ms: number }
  | { phase: "installing"; total: number }
  | { phase: "install_complete"; elapsed_ms: number }
  | { phase: "ready"; env_path: string; python_path: string }
  | { phase: "error"; message: string };

export type EnvProgressEvent = EnvProgressPhase & {
  env_type: "conda" | "uv";
};
