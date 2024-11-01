function createOutputCell(n) {
  let cell = document.createElement("div");
  cell.className = "cell";
  if (n !== undefined) {
    cell.dataset.n = n;
  }
  document.querySelector("#outputArea").appendChild(cell);
  return cell;
}

/** @type {Map<string, Model>} */
let models = new Map;

export function onMessage(msg) {
  switch (msg.header.msg_type) {
    case "display_data":
    case "execute_result": {
      let { data, execution_count } = msg.content;
      if ("application/vnd.jupyter.widget-view+json" in data) {
        displayWidget(data["application/vnd.jupyter.widget-view+json"], execution_count);
      } else if ("text/html" in data) {
        displayHtml(data["text/html"], execution_count);
      } else if ("text/plain" in data) {
        displayText(data["text/plain"], execution_count);
      }
      break;
    }
    case "comm_open": {
      let bufferPaths = msg.content.data.buffer_paths;
      let state = msg.content.data.state;
      let id = msg.content.comm_id;
      if (models.has(id)) {
        return;
      }
      models.set(id, new Model(state, { id }));
    }
    case "stream":
      console.log("stream");
      break;
    default:
      console.log(msg.header.msg_type, msg);
  }
}

function displayHtml(html, execution_count) {
  let output = createOutputCell(execution_count);
  output.innerHTML = html;
}

function displayText(text, execution_count) {
  let output = createOutputCell(execution_count);
  let pre = document.createElement("pre");
  pre.textContent = text;
  output.appendChild(pre);
}

async function displayWidget(widget, execution_count) {
  let model = models.get(widget.model_id);
  if (!model) {
    console.warn("Model not found", widget.model_id);
    return;
  }

  let root = createOutputCell(execution_count);
  let shadowRoot = root.attachShadow({ mode: "open" });

  if (model.get("_css")) {
    let css = model.get("_css");
    let stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(css);
    shadowRoot.adoptedStyleSheets = [stylesheet];
  }

  let el = document.createElement("div");
  {
    let esm = model.get("_esm");
    let blob = new Blob([esm], { type: "application/javascript" });
    let url = URL.createObjectURL(blob);
    let mod = await import(url);

    if (!mod.default) return;
    await mod.default.initialize?.({ model })
    await mod.default.render?.({ model, el });
  }

  shadowRoot.appendChild(el);
}

class Model {
  #state = {};
  #target = new EventTarget();
  #id;

  constructor(initialState, { id }) {
    this.#state = initialState;
    this.#id = id;
  }
  get(key) {
    return this.#state[key];
  }
  set(key, value) {
    this.#state[key] = value;
    this.#target.dispatchEvent(new CustomEvent(`change:${key}`));
    this.#target.dispatchEvent(new CustomEvent("change"));
  }
  on(event, handler) {
    this.#target.addEventListener(event, handler);
  }
  off(event, handler) {
    this.#target.removeEventListener(event, handler);
  }
  send(msg, buffers) {}
  save_changes() {}
}
