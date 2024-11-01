let outputArea = document.querySelector("#outputArea");

export function onMessage(msg) {
  switch (msg.header.msg_type) {
    case "display_data":
    case "execute_result":
      if ("text/html" in msg.content.data) {
        let div = document.createElement("div");
        div.innerHTML = msg.content.data["text/html"];
        outputArea.appendChild(div);
      } else if ("text/plain" in msg.content.data) {
        let pre = document.createElement("pre");
        pre.textContent = msg.content.data["text/plain"];
        outputArea.appendChild(pre);
      }
      break;
    case "stream":
      console.log("stream");
      break;
    default:
      console.log(msg);
  }
}
