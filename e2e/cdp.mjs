/**
 * Minimal Chrome DevTools Protocol client for the Logseq e2e harness.
 * Node 22 ships a global WebSocket, so this needs no dependencies.
 */
const PORT = Number(process.env.LOGSEQ_CDP_PORT || 9224);

export async function targets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP not reachable on ${PORT} (is Logseq running with --remote-debugging-port?)`);
  return res.json();
}

export class CDP {
  static async connect({ type, match }) {
    const list = await targets();
    const target = list.find((entry) => entry.type === type && (!match || entry.url.includes(match)));
    if (!target) throw new Error(`no ${type} target matching ${match || "*"}`);
    const client = new CDP(target.webSocketDebuggerUrl);
    await client.open();
    return client;
  }

  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (event) => reject(new Error(`websocket error: ${event.message || "unknown"}`)));
      this.ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30000);
    });
  }

  async evaluate(expression, { awaitPromise = true } = {}) {
    const result = await this.call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`evaluate failed: ${detail}`);
    }
    return result.result?.value;
  }

  async insertText(text) {
    await this.call("Input.insertText", { text });
  }

  async key(key, code, keyCode, modifiers = 0) {
    await this.call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers });
    await this.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
  }

  async click(x, y) {
    await this.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }

  async screenshot(path) {
    const { writeFile } = await import("node:fs/promises");
    const { data } = await this.call("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(data, "base64"));
    return path;
  }

  close() {
    this.ws?.close();
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
