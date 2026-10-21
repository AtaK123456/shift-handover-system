import { t } from "./i18n.js";
const $ = id => document.getElementById(id);
const make = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
// getRandomValues also works on LAN HTTP, where randomUUID may be unavailable.
function requestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
export function createProgressNotes({ api, stamp, onSaved }) {
  let drafts = new Map(), active = null, data = null, version = 0, epoch = 0, busy = false, loading = false, message = null;
  function render() {
    $("updates-title").textContent = active ? t("updatesTitle", { title: data?.entry.title || active.title }) : "";
    const writable = data?.canWrite && !active?.readOnly;
    $("updates-mode").textContent = data ? t(!data.canWrite ? "updatesClosed" : active.readOnly ? "updatesReadOnly" : "") : "";
    const hasDraft = Boolean(active && drafts.get(active.id)?.body.trim());
    $("updates-form").hidden = !data || (!writable && !hasDraft);
    $("updates-save").hidden = !writable; $("updates-body").readOnly = !writable;
    $("updates-draft-state").hidden = !hasDraft;
    $("updates-handover").hidden = !(data?.canWrite && active?.readOnly);
    $("updates-save").disabled = busy || loading;
    $("updates-body").disabled = busy;
    $("updates-close").disabled = busy;
    $("updates-discard").hidden = !active || !drafts.get(active.id)?.body.trim(); $("updates-discard").disabled = busy;
    $("updates-retry").disabled = busy || loading;
    $("updates-previous").disabled = busy || loading || !data || data.page <= 1;
    $("updates-next").disabled = busy || loading || !data || data.page * 20 >= data.total;
    $("updates-page").textContent = !data ? "" : data.total ? t("pageLabel", { from: (data.page-1)*20+1, to: Math.min(data.page*20,data.total), total: data.total }) : t("zero");
    $("updates-message").textContent = message ? message.key ? t(message.key) : message.text : loading ? t("loading") : "";
    $("updates-message").classList.toggle("error", Boolean(message?.error));
  }
  function renderList() {
    $("updates-list").replaceChildren(...(data?.items.length ? data.items.map(item => {
      const li = make("li", undefined, "update-note");
      li.append(make("p", `${item.author.name} · ${stamp(item.createdAt)}`, "hint"), make("p", item.body, "update-body")); return li;
    }) : [make("li", t("updatesEmpty"), "hint")]));
  }
  async function load(page = 1, clearMessage = true) {
    if (!active || busy) return;
    const current = ++version, entryId = active.id;
    loading = true; if (clearMessage) message = null; render();
    try {
      const result = await (await api(`/operations/entries/${entryId}/updates?page=${page}`)).json();
      if (current !== version || active?.id !== entryId) return;
      const valid = Math.min(result.page, Math.max(1, Math.ceil(result.total/20)));
      if (valid !== result.page) return load(valid);
      data = result; renderList();
    } catch (error) { if (current === version && error.name !== "AbortError") message = { text: error.message, error: true }; }
    finally { if (current === version) { loading = false; render(); } }
  }
  async function open(item, { readOnly = false } = {}) {
    if (busy) return;
    version++; epoch++; active = { id: item.id, title: item.title, readOnly }; data = null; message = null;
    $("updates-body").value = drafts.get(item.id)?.body || "";
    $("updates-list").replaceChildren(); render();
    if (!$("updates-dialog").open) $("updates-dialog").showModal();
    await load();
  }
  $("updates-body").addEventListener("input", () => {
    if (!active || busy) return;
    drafts.set(active.id, { id: active.id, title: active.title, body: $("updates-body").value, requestId: requestId() }); render();
  });
  $("updates-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!active || busy || loading || active.readOnly || !data?.canWrite) return;
    if (!$("updates-body").value.trim()) { message = { key: "UPDATE_INVALID_INPUT", error: true }; render(); return; }
    const entryId = active.id, current = version, currentEpoch = epoch;
    let draft = drafts.get(entryId);
    if (!draft || draft.body !== $("updates-body").value) { draft = { id: entryId, title: active.title, body: $("updates-body").value, requestId: requestId() }; drafts.set(entryId, draft); }
    busy = true; message = null; render();
    try {
      await api(`/operations/entries/${entryId}/updates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: draft.body, requestId: draft.requestId }) });
      if (current !== version || active?.id !== entryId) return;
      drafts.delete(entryId); $("updates-body").value = ""; message = { key: "updateSaved" }; busy = false;
      await load(1, false); if (currentEpoch === epoch) await onSaved();
    } catch (error) {
      if (current === version && error.name !== "AbortError") {
        message = { text: error.message, error: true };
        if (error.code === "UPDATE_ENTRY_CLOSED") { busy = false; await load(data?.page || 1, false); }
      }
    } finally { if (currentEpoch === epoch) { busy = false; render(); } }
  });
  $("updates-discard").addEventListener("click", () => { if (!active || busy) return; drafts.delete(active.id); $("updates-body").value = ""; render(); });
  $("updates-close").addEventListener("click", () => { if (!busy) $("updates-dialog").close(); });
  $("updates-dialog").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  $("updates-dialog").addEventListener("close", () => { version++; epoch++; active = null; data = null; loading = false; });
  $("updates-handover").addEventListener("click", () => $("updates-dialog").close());
  $("updates-retry").addEventListener("click", () => load(data?.page || 1));
  $("updates-previous").addEventListener("click", () => { if (data) load(data.page-1); });
  $("updates-next").addEventListener("click", () => { if (data) load(data.page+1); });
  window.addEventListener("languagechange", () => { render(); if (data) renderList(); });
  return { open, dirty: () => [...drafts.values()].some(item => item.body.trim()), snapshot: () => [...drafts.values()].filter(item => item.body.trim()),
    restore(values = []) { drafts = new Map(values.map(item => [item.id, item])); },
    reset() { version++; epoch++; active = null; data = null; drafts.clear(); busy = false; loading = false; message = null; $("updates-dialog").close(); $("updates-list").replaceChildren(); $("updates-body").value = ""; $("updates-title").textContent = ""; $("updates-message").textContent = ""; render(); }
  };
}
