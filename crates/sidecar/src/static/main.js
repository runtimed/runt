/** @import * as t from "./types.ts" */

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
  // buffers are base64 encoded here, so we need to decode them into ArrayBuffers
  message.buffers = message.buffers.map((b64) =>
    // @ts-expect-error - Uint8Array is not an ArrayBuffer
    Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
  );

  /** @type {import("npm:@jupyter-widgets/html-manager").HTMLManager} */
  const manager = globalThis.widgetManager;
  assert(manager, "widgetManager not found");

  if (isDisplayDataOrExecuteResult(message)) {
    const { data, execution_count } = message.content;
    const output = createOutputCell(execution_count);
    if (data["application/vnd.jupyter.widget-view+json"]) {
      const { model_id } = data["application/vnd.jupyter.widget-view+json"];
      const model = await manager.get_model(model_id);
      const view = await manager.create_view(model, {});
      // @ts-expect-error - @jupyter-widgets/html-manager is incorrectly typed. I hate this package.
      await manager.display_view(view, { el: output });
    } else if (data["text/html"]) {
      output.innerHTML = data["text/html"];
    } else if (data["text/plain"]) {
      const pre = document.createElement("pre");
      pre.textContent = data["text/plain"];
      output.appendChild(pre);
    }
    return;
  }

  if (message.header.msg_type === "comm_open") {
    const commId = message.content.comm_id;
    const comm = new Comm(commId, message.header);
    manager.handle_comm_open(
      comm,
      // I seriously don't get this API.
      // Half of the methods are `any` and the other half are super strictly typed.
      // @ts-expect-error - very strict and we have the right message.
      message,
    );
    return;
  }

  if (message.header.msg_type === "comm_msg") {
    const commId = message.content.comm_id;
    manager.get_model(commId).then((model) => {
      // @ts-expect-error we know our comm has this method
      model.comm?.handle_msg(message);
    });
    return;
  }

  if (message.header.msg_type === "comm_close") {
    const commId = message.content.comm_id;
    manager.get_model(commId).then((model) => {
      // @ts-expect-error we know our comm has this method
      model.comm?.handle_close(message);
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

    console.log("Sending", msg);
    // await this?
    fetch("/message", { method: "POST", body: JSON.stringify(msg) });

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
