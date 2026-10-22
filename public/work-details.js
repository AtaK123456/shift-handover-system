import { t } from "./i18n.js";
const $ = id => document.getElementById(id);
const make = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
export function workStatus(item) { return item.closedAt ? "WORK_CLOSED_STATUS" : `WORK_${item.workStatus || "OPEN"}`; }
export function workSummary(item) {
  const parts = [t(workStatus(item))];
  if (item.responsibleTeam) parts.push(t("workTeamValue", { team: item.responsibleTeam }));
  if (item.nextStep) parts.push(t("workNextValue", { step: item.nextStep }));
  return parts.join(" · ");
}
export function createWorkDetails({ api, stamp, onSaved }) {
  let active = null, data = null, drafts = new Map(), version = 0, saveGeneration = 0, busy = false, loading = false, message = null;
  const fields = () => ({ workStatus: $("work-status").value, responsibleTeam: $("work-team").value, nextStep: $("work-next").value });
  const values = item => ({ workStatus: item.workStatus, responsibleTeam: item.responsibleTeam, nextStep: item.nextStep });
  function fill() {
    if (!active) return;
    const draft = drafts.get(active.id), value = draft || data?.entry;
    if (!value) return;
    $("work-status").value = !draft && data?.entry.closedAt ? "CLOSED" : value.workStatus;
    $("work-team").value = value.responsibleTeam; $("work-next").value = value.nextStep;
  }
  function render() {
    const draft = active && drafts.get(active.id), writable = Boolean(data?.canWrite && !active?.readOnly);
    $("work-title").textContent = active ? t("workTitle", { title: data?.entry?.title || active.title }) : "";
    $("work-form").hidden = !data && !draft;
    $("work-mode").textContent = data ? t(!data.canWrite ? "workClosedHint" : active.readOnly ? "workReadOnly" : "workEditHint") : "";
    $("work-draft").hidden = !draft;
    $("work-message").textContent = message ? message.key ? t(message.key) : message.text : loading ? t("loading") : "";
    $("work-message").classList.toggle("error", Boolean(message?.error));
    $("work-status").disabled = busy || loading || !writable;
    for (const id of ["work-team", "work-next"]) { $(id).readOnly = !writable; $(id).disabled = busy || loading; }
    $("work-save").hidden = !writable; $("work-save").disabled = busy || loading;
    for (const id of ["work-close", "work-reload"]) $(id).disabled = busy || (id === "work-reload" && loading);
    $("work-discard").hidden = !draft; $("work-discard").disabled = busy || loading;
    $("work-previous").disabled = busy || loading || !data || data.page <= 1;
    $("work-next-page").disabled = busy || loading || !data || data.page * 20 >= data.total;
    $("work-page").textContent = data?.total ? t("pageLabel", { from: (data.page-1)*20+1, to: Math.min(data.page*20,data.total), total: data.total }) : "";
  }
  function renderHistory() {
    $("work-history").replaceChildren(...(data?.items.length ? data.items.map(item => {
      const li = make("li", undefined, "update-note");
      li.append(make("p", `${item.author.name} · ${stamp(item.createdAt)}`, "hint"), make("p", workSummary(item), "update-body")); return li;
    }) : [make("li", t("workHistoryEmpty"), "hint")]));
  }
  async function load(page = 1, discard = false) {
    if (!active || busy) return;
    const current = ++version, entryId = active.id;
    loading = true; message = null; render();
    try {
      const result = await (await api(`/operations/entries/${entryId}/work?page=${page}`)).json();
      if (current !== version || active?.id !== entryId) return;
      if (!result.entry || !Array.isArray(result.items)) throw new Error(t("failed"));
      const valid = Math.min(result.page, Math.max(1, Math.ceil(result.total / 20)));
      if (valid !== result.page) return load(valid, discard);
      data = result;
      if (discard) drafts.delete(entryId);
      fill(); renderHistory();
    } catch (error) { if (current === version && error.name !== "AbortError") message = { text: error.message, error: true }; }
    finally { if (current === version) { loading = false; render(); } }
  }
  async function open(item, { readOnly = false } = {}) {
    if (busy) return;
    version++; active = { id: item.id, title: item.title, readOnly }; data = null; message = null;
    $("work-form").reset(); $("work-history").replaceChildren(); fill(); render();
    if (!$("work-dialog").open) $("work-dialog").showModal();
    await load();
  }
  $("work-form").addEventListener("input", () => {
    if (!active || !data?.canWrite || active.readOnly || busy || loading) return;
    const value = fields(), previous = drafts.get(active.id);
    if (JSON.stringify(value) === JSON.stringify(values(data.entry))) drafts.delete(active.id);
    else drafts.set(active.id, { id: active.id, title: active.title, ...value, version: previous?.version ?? data.entry.workVersion });
    render();
  });
  $("work-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!active || !data?.canWrite || active.readOnly || busy || loading) return;
    const current = version, saveId = ++saveGeneration, context = active, entryId = active.id, draft = drafts.get(entryId);
    const payload = { ...fields(), version: draft?.version ?? data.entry.workVersion };
    busy = true; message = null; render();
    try {
      const entry = await (await api(`/operations/entries/${entryId}/work`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })).json();
      if (current !== version || active?.id !== entryId) return;
      drafts.delete(entryId); data.entry = entry; busy = false;
      await load(); if (active === context) { message = { key: "workSaved" }; render(); await onSaved(); }
    } catch (error) {
      if (current === version && error.name !== "AbortError") {
        message = { text: error.message, error: true };
        if (error.code === "WORK_CLOSED") { data.canWrite = false; data.entry.closedAt = true; }
      }
    } finally { if (active === context && saveId === saveGeneration) { busy = false; render(); } }
  });
  $("work-reload").addEventListener("click", () => {
    if (active && (!drafts.has(active.id) || confirm(t("workReloadConfirm")))) load(1, true);
  });
  $("work-discard").addEventListener("click", () => {
    if (!active || busy || loading || !confirm(t("workReloadConfirm"))) return;
    drafts.delete(active.id); fill(); render();
  });
  $("work-previous").addEventListener("click", () => { if (data) load(data.page-1); });
  $("work-next-page").addEventListener("click", () => { if (data) load(data.page+1); });
  $("work-close").addEventListener("click", () => { if (!busy) $("work-dialog").close(); });
  $("work-dialog").addEventListener("cancel", event => { if (busy) event.preventDefault(); });
  $("work-dialog").addEventListener("close", () => { if (!$("work-dialog").open) { version++; active = null; data = null; loading = false; } });
  window.addEventListener("languagechange", () => { render(); if (data) renderHistory(); });
  return { open, dirty: () => drafts.size > 0, snapshot: () => [...drafts.values()], restore(items = []) { drafts = new Map(items.map(item => [item.id, item])); },
    reset() { version++; saveGeneration++; active = null; data = null; drafts.clear(); busy = false; loading = false; message = null; $("work-dialog").close(); $("work-form").reset(); $("work-history").replaceChildren(); render(); }
  };
}
