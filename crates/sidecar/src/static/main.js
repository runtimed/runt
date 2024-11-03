/** @import * as t from "./types.ts" */
// Helper function for logging
function log(level, ...args) {
  console[level](`[${new Date().toISOString()}]`, ...args);
}

/**
 * @param {number | undefined} executionCount
 */
function createOutputCell(executionCount) {
  const cell = document.createElement("div");
  cell.className = "cell";
  if (executionCount !== undefined) {
    cell.dataset.n = executionCount.toString();
  }
  const outputArea = document.querySelector("#outputArea");
  assert(outputArea, "outputArea not found");
  outputArea.appendChild(cell);
  return cell;
}

/**
 * @param {t.JupyterMessage} msg
 * @returns {msg is t.DisplayData | t.ExecuteResult}
 */
function isDisplayDataOrExecuteResult(msg) {
  return (
    msg.header.msg_type === "display_data" ||
    msg.header.msg_type === "execute_result"
  );
}

/** @param {t.JupyterMessage} message */
export async function onMessage(message) {
  log("info", "Received message:", message);

  // buffers are base64 encoded here, so we need to decode them into ArrayBuffers
  message.buffers = message.buffers.map((b64) =>
    // @ts-expect-error - Uint8Array is not an ArrayBuffer
    Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
  );
  log("debug", "Decoded buffers:", message.buffers);

  /** @type {import("npm:@jupyter-widgets/html-manager").HTMLManager} */
  const manager = globalThis.widgetManager;
  assert(manager, "widgetManager not found");
  log("debug", "Widget manager found");

  if (isDisplayDataOrExecuteResult(message)) {
    log("info", "Handling display data or execute result");
    const { data, execution_count } = message.content;
    const output = createOutputCell(execution_count);
    if (data["application/vnd.jupyter.widget-view+json"]) {
      log("debug", "Creating widget view");
      const { model_id } = data["application/vnd.jupyter.widget-view+json"];
      const model = await manager.get_model(model_id);
      log("debug", "Got model:", model);
      const view = await manager.create_view(model, {});
      log("debug", "Created view:", view);
      // @ts-expect-error - @jupyter-widgets/html-manager is incorrectly typed. I hate this package.
      await manager.display_view(view, { el: output });
      log("debug", "Displayed view");
    } else if (data["text/html"]) {
      log("debug", "Displaying HTML content");
      const range = document.createRange();
      const fragment = range.createContextualFragment(data["text/html"]);
      output.appendChild(fragment);
    } else if (data["text/plain"]) {
      log("debug", "Displaying plain text content");
      const pre = document.createElement("pre");
      pre.textContent = data["text/plain"];
      output.appendChild(pre);
    }
    return;
  }

  if (message.header.msg_type === "comm_open") {
    log("info", "Handling comm_open message");
    const commId = message.content.comm_id;
    const comm = new Comm(commId, message.header);
    log("debug", "Created new Comm:", comm);
    manager.handle_comm_open(
      comm,
      // I seriously don't get this API.
      // Half of the methods are `any` and the other half are super strictly typed.
      // @ts-expect-error - very strict and we have the right message.
      message,
    );
    log("debug", "Handled comm_open");
    return;
  }

  if (message.header.msg_type === "comm_msg") {
    log("info", "Handling comm_msg message");
    const commId = message.content.comm_id;
    manager.get_model(commId).then((model) => {
      log("debug", "Got model for comm_msg:", model);
      // @ts-expect-error we know our comm has this method
      model.comm?.handle_msg(message);
      log("debug", "Handled comm_msg");
    });
    return;
  }

  if (message.header.msg_type === "comm_close") {
    log("info", "Handling comm_close message");
    const commId = message.content.comm_id;
    manager.get_model(commId).then((model) => {
      log("debug", "Got model for comm_close:", model);
      // @ts-expect-error we know our comm has this method
      model.comm?.handle_close(message);
      log("debug", "Handled comm_close");
    });
    return;
  }

  if (message.header.msg_type === "stream") {
    console.log(message.content);
    return;
  }
}

// This class is a striped down version of Comm from @jupyter-widgets/base
export class Comm {
  /** @type {string} */
  comm_id;
  /** @type {"jupyter.widgets"} */
  get target_name() {
    return "jupyter.widgets";
  }
  /** @type {((x: any) => void) | undefined} */
  #on_msg = undefined;
  /** @type {((x: any) => void) | undefined} */
  #on_close = undefined;

  /** @type {Record<string, unknown>} */
  #header;

  /**
   * @param {string} modelId
   * @param {Record<string, unknown>} header
   */
  constructor(modelId, header) {
    this.comm_id = modelId;
    this.#header = header;
  }

  /**
   * @param {t.JsonValue} data
   * @param {unknown} _callbacks
   * @param {unknown} metadata
   * @param {Array<ArrayBuffer>} buffers
   */
  send(data, _callbacks, metadata, buffers) {
    log("info", "Comm.send called");
    const msg_id = crypto.randomUUID();

    const msg = {
      parent_header: this.#header,
      content: { comm_id: this.comm_id, data: data },
      metadata: metadata,
      // TODO: need to _encode_ any buffers into base64 (JSON.stringify just drops them)
      buffers: buffers || [],
      // this doesn't seem relevant to the widget?
      header: {
        msg_id,
        msg_type: "comm_msg",
        date: new Date().toISOString(),
        username: "sidecar",
        session: "fake-todo",
        version: "5.0",
      },
    };

    log("debug", "Sending message:", msg);
    // await this?
    fetch("/message", { method: "POST", body: JSON.stringify(msg) })
      .then(() => log("debug", "Message sent successfully"))
      .catch((error) => log("error", "Error sending message:", error));

    return this.comm_id;
  }
  open() {
    // I don't think we need to do anything here?
    return this.comm_id;
  }
  close() {
    // I don't think we need to do anything here?
    return this.comm_id;
  }
  /** @param {(x: any) => void} cb */
  on_msg(cb) {
    this.#on_msg = cb.bind(this);
  }
  /** @param {(x: any) => void} cb */
  on_close(cb) {
    this.#on_close = cb.bind(this);
  }
  /** @param {unknown} msg */
  handle_msg(msg) {
    this.#on_msg?.(msg);
  }
  /** @param {unknown} msg */
  handle_close(msg) {
    this.#on_close?.(msg);
  }
}

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
