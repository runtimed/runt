// @ts-check
/// <reference lib="dom" />

/** @type {Map<string, Model>} */
let MODELS = new Map();

/**
 * @param {number} n
 * @returns {HTMLDivElement}
 */
function createOutputCell(n) {
  let cell = document.createElement("div");
  cell.className = "cell";
  if (n !== undefined) {
    // @ts-expect-error this field is required in the css
    cell.dataset.n = n;
  }
  let outputArea = document.querySelector("#outputArea");
  assert(outputArea, "outputArea not found");
  outputArea.appendChild(cell);
  return cell;
}

/**
 * @param {import("./types.ts").JupyterMessage} msg
 * @returns {msg is import("./types.ts").DisplayData | import("./types.ts").ExecuteResult}
 */
function isDisplayDataOrExecuteResult(msg) {
  return msg.header.msg_type === "display_data" ||
    msg.header.msg_type === "execute_result";
}

/**
 * @param {import("./types.ts").JupyterMessage} msg
 */
export function onMessage(msg) {
  if (isDisplayDataOrExecuteResult(msg)) {
    let { data, execution_count } = msg.content;
    let output = createOutputCell(execution_count);
    if (data["application/vnd.jupyter.widget-view+json"]) {
      displayWidget(data["application/vnd.jupyter.widget-view+json"], output);
    } else if (data["text/html"]) {
      output.innerHTML = data["text/html"];
    } else if (data["text/plain"]) {
      let pre = document.createElement("pre");
      pre.textContent = data["text/plain"];
      output.appendChild(pre);
    }
    return;
  }

  if (msg.header.msg_type === "comm_open") {
    let bufferPaths = msg.content.data.buffer_paths;
    let state = msg.content.data.state;
    let id = msg.content.comm_id;
    if (MODELS.has(id)) {
      return;
    }
    MODELS.set(id, new Model(state, { id }));
    return;
  }

  if (msg.header.msg_type === "stream") {
    console.log("stream");
    return;
  }

  console.log(msg.header.msg_type, msg);
}

/**
 * @param {import("./types.ts").JupyterWidgetDisplayData} widget
 * @param {HTMLDivElement} root
 */
async function displayWidget(widget, root) {
  let shadowRoot = root.attachShadow({ mode: "open" });

  let model = MODELS.get(widget.model_id);
  if (!model) {
    console.warn("Model not found", widget.model_id);
    return;
  }

  let css = model.get("_css");
  if (typeof css == "string") {
    let stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(css);
    shadowRoot.adoptedStyleSheets = [stylesheet];
  }

  let esm = model.get("_esm");
  assert(typeof esm === "string", "esm not found");

  let el = document.createElement("div");
  {
    let blob = new Blob([esm], { type: "application/javascript" });
    let url = URL.createObjectURL(blob);
    let mod = await import(url);

    if (!mod.default) return;
    await mod.default.initialize?.({ model });
    await mod.default.render?.({ model, el });
  }

  shadowRoot.appendChild(el);
}

class Model {
  /** @type {Record<string, unknown>} */
  #state = {};
  /** @type {EventTarget} */
  #target = new EventTarget();
  /** @type {string} */
  #id;

  /**
   * @param {import("./types.ts").JupyterMessage} msg
   */
  async #send(msg) {
    await fetch("/message", { method: "POST", body: JSON.stringify(msg) });
  }

  /**
   * @param {Record<string, unknown>} initialState
   * @param {{ id: string }} options
   */
  constructor(initialState, { id }) {
    this.#state = initialState;
    this.#id = id;
  }
  /**
   * @param {string} key
   * @returns {unknown}
   */
  get(key) {
    return this.#state[key];
  }
  /**
   * @param {string} key
   * @param {unknown} value
   */
  set(key, value) {
    this.#state[key] = value;
    this.#target.dispatchEvent(new CustomEvent(`change:${key}`));
    this.#target.dispatchEvent(new CustomEvent("change"));
  }
  /**
   * @param {string} event
   * @param {() => void} handler
   */
  on(event, handler) {
    this.#target.addEventListener(event, handler);
  }
  /**
   * @param {string} event
   * @param {() => void} handler
   */
  off(event, handler) {
    this.#target.removeEventListener(event, handler);
  }
  /**
   * @param {unknown} msg
   */
  send(msg) {
    // not implemented
  }
  save_changes() {}
}

class Comm {
  target_name = "jupyter.widget";

  /** @param {string} id */
  constructor(id) {
    /** @type {string} */
    this.comm_id = id;
  }

  /**
   * Opens a sibling comm in the backend
   * @param {object} data
   * @param {unknown=} callbacks
   * @param {unknown=} metadata
   * @param {ArrayBuffer[]=} buffers
   * @return msg id
   */
  open(data, callbacks, metadata, buffers) {
    console.log("open", data);
  }

  /**
   * Sends a message to the sibling comm in the backend
   * @param {object} data
   * @param {unknown=} callbacks
   * @param {unknown=} metadata
   * @param {ArrayBuffer[]=} buffers
   */
  send(data, callbacks, metadata, buffers) {
    console.log("send", data);
  }

  /**
   * Closes the sibling comm in the backend
   * @param {object} data
   * @param {unknown=} callbacks
   * @param {unknown=} metadata
   * @param {ArrayBuffer[]=} buffers
   */
  close(data, callbacks, metadata, buffers) {
    console.log("close", data);
  }

  /**
   * Register a message handler
   * @param {(msg: unknown) => void} callback, which is given a message
   */
  on_msg(callback) {
    console.log("on_msg", callback);
  }

  /**
   * Register a handler for when the comm is closed by the backend
   * @param {(msg: unknown) => void} callback, which is given a message
   */
  on_close(callback) {
    console.log("on_close", callback);
  }
}

/**
 * @param {unknown} cond
 * @param {string} message
 * @returns {asserts cond}
 */
function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}
