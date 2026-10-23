import { t, locale } from "./i18n.js";

export function createConnectionStatus({ retry }) {
  const root = document.getElementById("connection-status"), label = document.getElementById("connection-label");
  const time = document.getElementById("connection-time"), button = document.getElementById("connection-retry");
  const failures = new Set(), versions = new Map();
  let lastResponse = null, reachable = null, busy = false, version = 0;
  const resource = path => path.split("?")[0];
  function render() {
    const state = !navigator.onLine || reachable === false ? "offline" : failures.size ? "warning" : reachable ? "online" : "checking";
    root.dataset.state = state;
    label.textContent = t(`connection${state}`);
    // This is server contact time, not a claim that every displayed record was refreshed.
    time.textContent = lastResponse ? t("connectionLastResponse", { time: new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastResponse) }) : "";
    button.hidden = state === "online";
    button.disabled = busy || !navigator.onLine;
    button.textContent = t(busy ? "processing" : "connectionRetry");
  }
  async function check() {
    if (busy || !navigator.onLine) return;
    busy = true; render();
    try { await retry(); } finally { busy = false; render(); }
  }
  button.addEventListener("click", check);
  window.addEventListener("offline", render);
  window.addEventListener("online", () => { reachable = null; render(); void check(); });
  window.addEventListener("languagechange", render);
  render();
  return {
    begin(path, method = "GET") {
      const key = resource(path), request = ++version;
      const dataRead = ["GET", "HEAD"].includes(method) && !path.startsWith("/ai/");
      versions.set(key, request);
      return {
        response(status) {
          if (versions.get(key) !== request) return;
          reachable = true; lastResponse = new Date();
          // Provider/write errors have their own messages. Failed data reads
          // stay marked until that resource succeeds, even if another does.
          if (dataRead) { if (status >= 500) failures.add(key); else failures.delete(key); }
          render();
        },
        failed() {
          if (versions.get(key) !== request) return;
          if (dataRead) failures.add(key);
          reachable = false; render();
        }
      };
    },
    reset() { failures.clear(); versions.clear(); lastResponse = null; reachable = null; render(); }
  };
}
