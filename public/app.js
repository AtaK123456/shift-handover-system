import { createAiAssistant } from "./ai-assistant.js";
import { t, locale, lang, apiError, initializeLanguage } from "./i18n.js";
const $ = id => document.getElementById(id);
let token = null, user = null, current, signingUp = false, shiftBusy = false, loading = false, exporting = false;
let page = 1, total = 0, applied = new URLSearchParams(), listVersion = 0, currentVersion = 0;
let session = new AbortController(), equipment = [], selectedEquipment = null, closingEntry = null, photoUrl = null;
let board = { items: [], page: 1, total: 0 }, history = { items: [], page: 1, total: 0 }, shiftRows = [];
let operationsVersion = 0, summary = null, summaryBusy = false;
let selectedPhotos = [], interruptedDraft = null, entrySending = false;
let operationFilters = new URLSearchParams();
const aiAssistant = createAiAssistant({ api, isSaving: () => entrySending });
const df = () => new Intl.DateTimeFormat(locale(), { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", year: "numeric" });
const tf = () => new Intl.DateTimeFormat(locale(), { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
const localDate = value => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date(value));
const stamp = value => value ? `${df().format(new Date(value))} · ${tf().format(new Date(value))}` : "—";
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
function notify(message, error = false) { const el = token ? $("dashboard-message") : $("auth-message"); el.textContent = message; el.classList.toggle("error", error); }
function showError(error) { if (error.name !== "AbortError") notify(error.message || t("failed"), true); }
async function failure(response) { try { return apiError((await response.json()).error) || t("failed"); } catch { return t("failed"); } }
function releasePhoto() { if (photoUrl) URL.revokeObjectURL(photoUrl); photoUrl = null; $("entry-photo").removeAttribute("src"); }
function logout({ preserveDraft = false } = {}) {
  if (preserveDraft && user && (draftDirty() || aiAssistant.dirty())) interruptedDraft = { ownerId: user.id,
    values: Object.fromEntries(["entry-kind", "entry-priority", "entry-unit", "entry-title", "entry-description"].map(id => [id, $(id).value])),
    files: selectedPhotos.map(item => item.file), chat: aiAssistant.snapshot() };
  if (!preserveDraft) interruptedDraft = null;
  aiAssistant.reset();
  summary = null; renderSummary(); operationFilters = new URLSearchParams();
  session.abort(); session = new AbortController(); token = null; user = null; current = undefined; listVersion++; currentVersion++; operationsVersion++;
  document.querySelectorAll("dialog[open]").forEach(dialog => dialog.close()); releasePhoto();
  equipment = []; board = { items: [], page: 1, total: 0 }; history = { items: [], page: 1, total: 0 }; shiftRows = [];
  $("dashboard").hidden = true; $("auth-view").hidden = false;
  ["login-form", "filter-form", "entry-form", "shift-schedule", "operations-filter"].forEach(id => $(id).reset());
  ["shift-rows", "board-entries", "operation-entries", "equipment-grid"].forEach(id => $(id).replaceChildren());
  $("account-name").textContent = ""; $("greeting").textContent = ""; $("scope-field").hidden = true;
  $("auth-message").textContent = ""; $("dashboard-message").textContent = ""; $("email").focus();
}
async function api(path, options = {}) {
  const identity = token;
  let response;
  try { response = await fetch(path, { ...options, signal: session.signal, headers: { "Accept-Language": lang(), ...options.headers, Authorization: `Bearer ${token}` } }); }
  catch (error) { if (error.name === "AbortError") throw error; throw new Error(t("connection")); }
  if (identity !== token) throw new DOMException("Session changed", "AbortError");
  if (response.status === 401) { const unsaved = draftDirty() || aiAssistant.dirty(); logout({ preserveDraft: true }); const message = t(unsaved ? "expiredDraft" : "expired"); notify(message, true); throw new Error(message); }
  if (!response.ok) throw new Error(await failure(response));
  return response;
}
const json = (path, method, body) => api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
function passwordVisibility(visible) {
  $("password").type = visible ? "text" : "password"; $("toggle-password").textContent = t(visible ? "hide" : "show");
  $("toggle-password").setAttribute("aria-label", t(visible ? "hidePassword" : "showPassword"));
  $("toggle-password").setAttribute("aria-pressed", String(visible));
}
function renderAuth() {
  $("name-field").hidden = !signingUp; $("name").required = signingUp; $("password-hint").hidden = !signingUp;
  $("password").minLength = signingUp ? 12 : 1; $("password").autocomplete = signingUp ? "new-password" : "current-password";
  $("auth-title").textContent = t(signingUp ? "signupTitle" : "loginTitle"); $("auth-description").textContent = t(signingUp ? "signupDescription" : "loginDescription");
  $("login-button").textContent = t(signingUp ? "signup" : "login"); $("switch-label").textContent = t(signingUp ? "hasAccount" : "noAccount"); $("switch-auth").textContent = t(signingUp ? "login" : "signup");
  passwordVisibility($("password").type === "text");
}
$("toggle-password").addEventListener("click", () => passwordVisibility($("password").type === "password"));
$("login-form").addEventListener("reset", () => passwordVisibility(false));
$("switch-auth").addEventListener("click", () => { signingUp = !signingUp; passwordVisibility(false); renderAuth(); notify(""); });
$("login-form").addEventListener("submit", async event => {
  event.preventDefault(); const register = signingUp; $("login-button").disabled = true; $("switch-auth").disabled = true;
  notify(t(register ? "signupProgress" : "loginProgress"));
  try {
    const response = await fetch(register ? "/register" : "/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("email").value, password: $("password").value, ...(register ? { name: $("name").value } : {}) }) });
    if (!response.ok) throw new Error(await failure(response));
    if (register) { $("password").value = ""; signingUp = false; passwordVisibility(false); renderAuth(); notify(t("signupDone")); $("password").focus(); return; }
    const data = await response.json(); token = data.token; user = data.user; current = undefined; passwordVisibility(false); $("password").value = "";
    $("account-name").textContent = user.name; $("avatar").textContent = user.name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join("").toLocaleUpperCase(locale());
    $("scope-field").hidden = user.role !== "MANAGER"; $("auth-view").hidden = true; $("dashboard").hidden = false; $("dashboard-message").textContent = "";
    applied = new URLSearchParams(); page = 1; renderIdentity(); renderCurrent();
    if (interruptedDraft) {
      if (interruptedDraft.ownerId === user.id) {
        for (const [id, value] of Object.entries(interruptedDraft.values)) $(id).value = value;
        addPhotos(interruptedDraft.files); aiAssistant.restore(interruptedDraft.chat); notify(t("draftRestored"));
      }
      interruptedDraft = null;
    }
    await Promise.all([loadCurrent(), loadHistory(), loadOperations(), aiAssistant.load()]);
  } catch (error) { showError(error instanceof TypeError ? new Error(t("connection")) : error); }
  finally { $("login-button").disabled = false; $("switch-auth").disabled = false; }
});
$("logout").addEventListener("click", () => { if ((draftDirty() || aiAssistant.dirty() || interruptedDraft) && !confirm(t("discardDraft"))) return; logout(); notify(t("signedOut")); });
function renderIdentity() {
  if (!user) return;
  $("greeting").textContent = t("greeting", { name: user.name.trim().split(/\s+/)[0] }); $("account-role").textContent = t(user.role);
  $("today").textContent = new Intl.DateTimeFormat(locale(), { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
}
function renderCurrent() {
  const known = current !== undefined, active = Boolean(current);
  $("shift-badge").textContent = t(!known ? "loading" : active ? "active" : "inactive"); $("shift-badge").classList.toggle("active", active);
  $("shift-title").textContent = t(!known ? "checking" : active ? "shiftActiveTitle" : "shiftReady"); $("shift-description").textContent = t(!known ? "checkHint" : active ? "shiftActiveHint" : "shiftReadyHint");
  $("shift-button").disabled = shiftBusy; $("shift-button").textContent = t(shiftBusy ? "processing" : !known ? "checkStatus" : active ? "endShift" : "startShift");
  $("shift-date").disabled = active; $("shift-slot").disabled = active;
  $("shift-slot").querySelector('[data-legacy]')?.remove();
  if (active) {
    $("shift-date").value = current.shiftDate || localDate(current.startTime);
    const slot = current.scheduledStart && current.scheduledEnd ? `${current.scheduledStart}-${current.scheduledEnd}` : "";
    if (![...$("shift-slot").options].some(o => o.value === slot)) { const option = node("option", slot || t("unspecified")); option.value = slot; option.dataset.legacy = "true"; $("shift-slot").append(option); }
    $("shift-slot").value = slot;
  } else if (!$("shift-date").value) {
    $("shift-date").value = localDate(new Date());
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    $("shift-slot").value = hour < 8 ? "00:00-08:00" : hour < 16 ? "08:00-16:00" : "16:00-00:00";
  }
}
async function loadCurrent() {
  const identity = token, version = ++currentVersion;
  try {
    const data = await (await api("/shifts/current")).json();
    if (identity !== token || version !== currentVersion) return;
    const previouslyActive = Boolean(current);
    current = data.currentShift;
    if (previouslyActive && !current) { $("shift-schedule").reset(); $("shift-date").value = ""; }
    renderCurrent();
  } catch (error) { if (identity === token && version === currentVersion) showError(error); }
}
$("shift-schedule").addEventListener("submit", event => event.preventDefault());
$("shift-button").addEventListener("click", async () => {
  if (shiftBusy) return; if (current === undefined) return loadCurrent();
  const ending = Boolean(current), identity = token;
  if (!ending && !$("shift-schedule").reportValidity()) return;
  const [scheduledStart, scheduledEnd] = $("shift-slot").value.split("-");
  shiftBusy = true; renderCurrent();
  try { await json(ending ? "/shifts/end" : "/shifts/start", "POST", ending ? {} : { shiftDate: $("shift-date").value, scheduledStart, scheduledEnd }); notify(t(ending ? "shiftEnded" : "shiftStarted")); }
  catch (error) { showError(error); }
  finally { if (token === identity && token) { page = 1; await Promise.all([loadCurrent(), loadHistory(), loadOperations()]); } shiftBusy = false; renderCurrent(); }
});
function filterParams() { const params = new URLSearchParams(); if ($("from").value) params.set("from", $("from").value); if ($("to").value) params.set("to", $("to").value); if (user?.role === "MANAGER" && $("scope").value === "all") params.set("scope", "all"); return params; }
const filtersMatch = () => filterParams().toString() === applied.toString();
function updateControls() { $("previous").disabled = loading || page <= 1; $("next").disabled = loading || page * 20 >= total; $("filter-button").disabled = loading; $("export-button").disabled = loading || exporting || !filtersMatch(); }
function renderRows() {
  const all = applied.get("scope") === "all"; $("person-heading").hidden = !all;
  $("shift-rows").replaceChildren(...shiftRows.map(item => {
    const row = node("tr"); row.append(node("td", `#${item.id}`)); if (all) row.append(node("td", item.user.name));
    row.append(node("td", item.shiftDate || localDate(item.startTime)), node("td", item.scheduledStart && item.scheduledEnd ? `${item.scheduledStart}–${item.scheduledEnd}` : t("unspecified")), node("td", stamp(item.startTime)), node("td", stamp(item.endTime)));
    const status = node("td"); status.append(node("span", t(item.status === "ACTIVE" ? "inProgress" : "completed"), `status${item.status === "ACTIVE" ? " active" : ""}`)); row.append(status); return row;
  }));
  $("table-wrap").hidden = !shiftRows.length; $("empty-state").hidden = Boolean(shiftRows.length);
  const filtered = applied.has("from") || applied.has("to"); $("empty-title").textContent = t(filtered ? "noResults" : "noShift"); $("empty-description").textContent = t(filtered ? "noResultsHint" : "noShiftHint");
  $("record-count").textContent = total; $("page-label").textContent = total ? t("pageLabel", { from: (page - 1) * 20 + 1, to: Math.min(page * 20, total), total }) : t("zero");
  $("filter-note").textContent = filtered ? t("filterNote", { from: applied.get("from") || t("firstRecord"), to: applied.get("to") || t("lastRecord") }) : t("allDates"); $("clear-filters").hidden = applied.size === 0;
}
async function loadHistory() {
  const version = ++listVersion; loading = true; updateControls(); $("table-loading").hidden = false; $("table-wrap").hidden = true; $("empty-state").hidden = true;
  try { const query = new URLSearchParams(applied); query.set("page", page); const data = await (await api(`/shifts?${query}`)).json(); if (version !== listVersion || !token) return; shiftRows = data.items; total = data.total; renderRows(); }
  catch (error) { if (version === listVersion) { showError(error); $("page-label").textContent = t("historyFailed"); } }
  finally { if (version === listVersion) { loading = false; $("table-loading").hidden = true; updateControls(); } }
}
$("filter-form").addEventListener("input", () => { updateControls(); if (!filtersMatch()) notify(t("applyFirst")); });
$("filter-form").addEventListener("submit", async event => { event.preventDefault(); if ($("from").value && $("to").value && $("from").value > $("to").value) return notify(t("invalidRange"), true); applied = filterParams(); page = 1; notify(""); await loadHistory(); });
$("clear-filters").addEventListener("click", async () => { $("filter-form").reset(); applied = new URLSearchParams(); page = 1; notify(""); await loadHistory(); });
$("previous").addEventListener("click", async () => { if (page > 1) { page--; await loadHistory(); } });
$("next").addEventListener("click", async () => { if (page * 20 < total) { page++; await loadHistory(); } });
$("export-button").addEventListener("click", async () => {
  if (!filtersMatch()) return; exporting = true; updateControls(); $("export-label").textContent = t("processing"); notify(t("exporting"));
  try { const response = await api(`/shifts/export?${applied}`); const url = URL.createObjectURL(await response.blob()); const link = node("a"); link.href = url; link.download = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || "vardiyalar.xlsx"; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify(t("exportReady")); }
  catch (error) { showError(error); }
  finally { exporting = false; $("export-label").textContent = t("export"); updateControls(); }
});
function renderEquipment() {
  $("equipment-grid").replaceChildren(...equipment.map(item => {
    const card = node("article", undefined, "equipment-card"); const heading = node("div", undefined, "section-title"); heading.append(node("h3", item.code), node("span", t(item.status), `unit-status unit-${item.status.toLowerCase()}`));
    card.append(heading, node("p", item.note || "—", "equipment-note"), node("p", item.updatedAt ? `${item.updatedBy?.name || "—"} · ${stamp(item.updatedAt)}` : t("neverUpdated"), "hint"));
    const button = node("button", t("update"), "button secondary small"); button.type = "button";
    button.addEventListener("click", () => { selectedEquipment = { ...item }; $("equipment-dialog-title").textContent = `${item.code} · ${t("update")}`; $("equipment-status").value = item.status; $("equipment-note").value = item.note; $("equipment-message").textContent = ""; $("equipment-dialog").showModal(); });
    card.append(button); return card;
  }));
}
async function viewPhoto(id) {
  try { const response = await api(`/operations/photos/${encodeURIComponent(id)}`); const blob = await response.blob(); if (!token) return; releasePhoto(); photoUrl = URL.createObjectURL(blob); $("entry-photo").src = photoUrl; $("entry-photo").alt = t("photo"); $("photo-dialog").showModal(); } catch (error) { showError(error); }
}
function entryCard(item) {
  const card = node("article", undefined, `entry-card${item.priority === "HIGH" ? " important" : ""}`);
  const meta = node("div", undefined, "entry-meta"); meta.append(node("span", t(item.kind), "entry-kind"), node("span", item.equipmentCode || t("general"), "status")); if (item.priority === "HIGH") meta.append(node("span", t("HIGH"), "priority-high")); if (item.closedAt) meta.append(node("span", t("closed"), "status"));
  card.append(meta, node("h3", item.title), node("p", item.description, "entry-description"), node("p", `${item.author.name} · ${stamp(item.createdAt)}${item.shiftId ? ` · #${item.shiftId}` : ""}`, "hint"));
  const actions = node("div", undefined, "entry-actions");
  item.photos.forEach((photo, index) => { const button = node("button", t("viewPhoto", { number: index + 1 }), "button quiet small"); button.type = "button"; button.addEventListener("click", () => viewPhoto(photo.id)); actions.append(button); });
  if (!item.closedAt && ["VALVE", "ATTENTION", "TASK"].includes(item.kind)) {
    const close = node("button", t("closeItem"), "button secondary small"); close.type = "button"; close.addEventListener("click", () => { closingEntry = item.id; $("close-title").textContent = item.title; $("close-note").value = ""; $("close-message").textContent = ""; $("close-dialog").showModal(); }); actions.append(close);
  }
  if (item.closedAt) { card.append(node("p", t("closedBy", { name: item.closedBy?.name || "—", date: stamp(item.closedAt) }), "hint")); if (item.closeNote) card.append(node("p", item.closeNote, "close-note")); }
  card.append(actions); return card;
}
function renderEntries() {
  for (const [state, prefix] of [[board, "board"], [history, "operation"]]) {
    $(prefix === "board" ? "board-entries" : "operation-entries").replaceChildren(...(state.items.length ? state.items.map(entryCard) : [node("p", t(prefix === "board" ? "noOpen" : operationFilters.size ? "noOperationResults" : "noEntries"), "empty-state")]));
    $(prefix === "board" ? "board-count" : "operation-count").textContent = state.total;
    $(`${prefix}-page`).textContent = state.total ? t("pageLabel", { from: (state.page - 1) * 20 + 1, to: Math.min(state.page * 20, state.total), total: state.total }) : t("zero");
    $(`${prefix}-previous`).disabled = state.page <= 1; $(`${prefix}-next`).disabled = state.page * 20 >= state.total;
  }
}
async function loadOperations({ boardPage = board.page, historyPage = history.page } = {}) {
  const version = ++operationsVersion;
  $("refresh-operations").disabled = true;
  for (const prefix of ["board", "operation"]) for (const direction of ["previous", "next"]) $(`${prefix}-${direction}`).disabled = true;
  try {
    const query = new URLSearchParams(operationFilters);
    query.set("view", operationFilters.size ? "all" : "history"); query.set("page", historyPage);
    const [overview, open, entries] = await Promise.all([api("/operations/summary").then(r => r.json()), api(`/operations/entries?view=open&page=${boardPage}`).then(r => r.json()), api(`/operations/entries?${query}`).then(r => r.json())]);
    if (!token || version !== operationsVersion) return;
    const validBoardPage = Math.min(open.page, Math.max(1, Math.ceil(open.total / 20)));
    const validHistoryPage = Math.min(entries.page, Math.max(1, Math.ceil(entries.total / 20)));
    if (validBoardPage !== open.page || validHistoryPage !== entries.page) {
      return loadOperations({ boardPage: validBoardPage, historyPage: validHistoryPage });
    }
    summary = overview; equipment = overview.equipment; board = open; history = entries;
    renderSummary(); renderEquipment(); renderEntries();
  } catch (error) { if (version === operationsVersion) { showError(error); renderEntries(); } }
  finally { if (version === operationsVersion) $("refresh-operations").disabled = false; }
}
$("refresh-operations").addEventListener("click", loadOperations);
for (const [prefix, isBoard] of [["board", true], ["operation", false]]) for (const direction of ["previous", "next"]) {
  $(`${prefix}-${direction}`).addEventListener("click", async () => {
    const state = isBoard ? board : history, target = Math.max(1, state.page + (direction === "next" ? 1 : -1));
    await loadOperations(isBoard ? { boardPage: target } : { historyPage: target });
  });
}
$("equipment-form").addEventListener("submit", async event => {
  event.preventDefault(); if (!selectedEquipment) return; const identity = token; $("equipment-save").disabled = true; $("equipment-message").textContent = "";
  try { await json(`/operations/equipment/${selectedEquipment.code}`, "PUT", { status: $("equipment-status").value, note: $("equipment-note").value, version: selectedEquipment.version }); $("equipment-dialog").close(); notify(t("updated")); }
  catch (error) { if (identity === token && token && error.name !== "AbortError") $("equipment-message").textContent = error.message || t("failed"); }
  finally { $("equipment-save").disabled = false; if (token) await loadOperations(); }
});
$("entry-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (entrySending) return;
  if (selectedPhotos.length > 3 || selectedPhotos.some(item => item.file.size > 5 * 1024 * 1024)) return notify(t("photoLimit"), true);
  aiAssistant.beforeSave();
  const body = new FormData($("entry-form")); body.delete("photos");
  selectedPhotos.forEach(item => body.append("photos", item.file));
  const controls = [...$("entry-form").querySelectorAll("input,select,textarea,button"), ...document.querySelectorAll("[data-quick-kind]")].map(element => ({ element, disabled: element.disabled }));
  entrySending = true; aiAssistant.render(); controls.forEach(({ element }) => { element.disabled = true; }); $("entry-save").textContent = t("saveProgress");
  try { await api("/operations/entries", { method: "POST", body }); $("entry-form").reset(); board.page = 1; history.page = 1; notify(t("entrySaved")); await loadOperations(); }
  catch (error) { showError(error); }
  finally { entrySending = false; controls.forEach(({ element, disabled }) => { element.disabled = disabled; }); $("entry-save").textContent = t("save"); aiAssistant.render(); }
});
$("close-form").addEventListener("submit", async event => {
  event.preventDefault(); const identity = token; $("close-save").disabled = true; $("close-message").textContent = "";
  try { await json(`/operations/entries/${closingEntry}/close`, "POST", { closeNote: $("close-note").value }); $("close-dialog").close(); notify(t("itemClosed")); await loadOperations(); }
  catch (error) { if (identity === token && token && error.name !== "AbortError") $("close-message").textContent = error.message || t("failed"); }
  finally { $("close-save").disabled = false; }
});
document.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => $(button.dataset.close).close()));
$("photo-dialog").addEventListener("close", releasePhoto);
setInterval(() => { if (token && document.visibilityState === "visible") Promise.all([loadOperations(), loadCurrent()]); }, 30000);
window.addEventListener("languagechange", () => { renderAuth(); notify(""); if (token) { renderIdentity(); renderCurrent(); renderRows(); renderSummary(); renderEquipment(); renderEntries(); renderPhotos(); } });
function renderSummary() {
  if (!summary) {
    for (const id of ["summary-units", "summary-counts", "summary-important", "summary-recent"]) $(id).replaceChildren();
    $("summary-read-status").textContent = t("summaryLoading"); $("summary-read").textContent = t("summaryRead");
    $("summary-read").disabled = true; return;
  }
  $("summary-units").replaceChildren(...summary.equipment.map(item => node("span", `${item.code} · ${t(item.status)}`, `unit-status unit-${item.status.toLowerCase()}`)));
  $("summary-counts").replaceChildren(...[["summaryOpen", summary.counts.total], ["summaryImportant", summary.counts.important], ["summaryValves", summary.counts.VALVE], ["summaryTasks", summary.counts.TASK]].map(([key, value]) => {
    const card = node("div", undefined, "summary-stat"); card.append(node("strong", value), node("span", t(key))); return card;
  }));
  $("summary-important").replaceChildren(...(summary.important.length ? summary.important.map(item => node("li", `${item.equipmentCode || t("general")} · ${item.title}`)) : [node("li", t("noImportant"))]));
  $("summary-recent").replaceChildren(...(summary.recent.length ? summary.recent.map(item => node("li", `${t(item.kind)} · ${item.title}`)) : [node("li", t("noEntries"))]));
  const read = summary.receipt?.revision === summary.revision;
  $("summary-read").disabled = summaryBusy || !summary.activeShiftId || read;
  $("summary-read").textContent = t(summaryBusy ? "processing" : "summaryRead");
  $("summary-read-status").textContent = !summary.activeShiftId ? t("summaryStart") : read ? t("summaryReadDone", { date: stamp(summary.receipt.readAt) }) : summary.receipt ? t("summaryChanged") : "";
}
$("summary-read").addEventListener("click", async () => {
  if (!summary || summaryBusy) return; summaryBusy = true; renderSummary();
  try { await json("/operations/summary/read", "POST", { revision: summary.revision }); notify(t("summarySaved")); }
  catch (error) { showError(error); }
  finally { summaryBusy = false; if (token) await loadOperations(); }
});
function draftDirty() { return Boolean($("entry-title").value.trim() || $("entry-description").value.trim() || selectedPhotos.length); }
function renderPhotos() {
  $("photo-count").textContent = t("selectedPhotos", { count: selectedPhotos.length });
  $("draft-hint").hidden = !draftDirty();
  $("photo-previews").replaceChildren(...selectedPhotos.map(item => {
    const figure = node("figure", undefined, "photo-preview"); const image = node("img"); image.src = item.url; image.alt = item.file.name;
    const remove = node("button", t("removePhoto"), "text-button"); remove.type = "button";
    remove.addEventListener("click", () => { if (entrySending) return; URL.revokeObjectURL(item.url); selectedPhotos = selectedPhotos.filter(photo => photo !== item); renderPhotos(); });
    figure.append(image, node("figcaption", item.file.name), remove); return figure;
  }));
}
function addPhotos(files) {
  if (entrySending) return;
  if (selectedPhotos.length + files.length > 3 || files.some(file => file.size > 5 * 1024 * 1024)) { notify(t("photoLimit"), true); return; }
  for (const file of files) selectedPhotos.push({ file, url: URL.createObjectURL(file) });
  renderPhotos();
}
for (const id of ["entry-photos", "camera-photo"]) $(id).addEventListener("change", event => { addPhotos([...event.target.files]); event.target.value = ""; });
$("choose-photos").addEventListener("click", () => $("entry-photos").click());
$("take-photo").addEventListener("click", () => $("camera-photo").click());
$("entry-form").addEventListener("input", () => { $("draft-hint").hidden = !draftDirty(); });
$("entry-form").addEventListener("reset", () => { selectedPhotos.forEach(item => URL.revokeObjectURL(item.url)); selectedPhotos = []; queueMicrotask(renderPhotos); });
window.addEventListener("beforeunload", event => { if (draftDirty() || aiAssistant.dirty() || interruptedDraft) { event.preventDefault(); event.returnValue = ""; } });
document.querySelectorAll("[data-quick-kind]").forEach(button => button.addEventListener("click", () => {
  if (entrySending) return;
  $("entry-kind").value = button.dataset.quickKind;
  if (button.dataset.quickKind === "ATTENTION") $("entry-priority").value = "HIGH";
  $("entry-form").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
  $("entry-title").focus({ preventScroll: true });
}));
$("operations-filter").addEventListener("submit", async event => {
  event.preventDefault(); if ($("operations-from").value && $("operations-to").value && $("operations-from").value > $("operations-to").value) return notify(t("invalidRange"), true);
  operationFilters = new URLSearchParams();
  for (const [key, value] of new FormData($("operations-filter"))) if (String(value).trim()) operationFilters.set(key, String(value).trim());
  history.page = 1; await loadOperations();
});
$("operations-clear").addEventListener("click", async () => { $("operations-filter").reset(); operationFilters = new URLSearchParams(); history.page = 1; await loadOperations(); });
initializeLanguage(); renderAuth(); renderPhotos();
