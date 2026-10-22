import { t } from "./i18n.js";
const $ = id => document.getElementById(id);
const pages = { overview: ["navOverview", "overviewHint"], "new-record": ["navNew", "newRecordHint"], handover: ["navHandover", "handoverPageHint"], history: ["navHistory", "historyPageHint"] };
const make = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
export function createWorkspace({ authenticated, stamp }) {
  let contentKey = null, changesKey = null, detailItem = null;
  let selected = "overview", snapshot = { current: undefined, summary: null, checkedAt: null, stale: false, currentStale: false };
  function select(page, focus = true, emit = true) {
    const previous = selected;
    const boardTarget = page === "board-title";
    selected = boardTarget ? "handover" : Object.hasOwn(pages, page) ? page : "overview";
    for (const panel of document.querySelectorAll("[data-page]")) panel.hidden = panel.dataset.page !== selected;
    for (const link of document.querySelectorAll("[data-nav]")) {
      if (link.dataset.nav === selected) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
    }
    $("page-title").textContent = t(pages[selected][0]); $("page-description").textContent = t(pages[selected][1]);
    document.title = `${t(pages[selected][0])} · ${t("brand")}`;
    if (emit && previous !== selected && authenticated()) window.dispatchEvent(new CustomEvent("workspacechange", { detail: selected }));
    if (focus) { $("page-title").focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "instant" }); if (boardTarget) $("board-title").scrollIntoView(); }
  }
  function open(page) { if (location.hash === `#${page}`) select(page); else location.hash = page; }
  window.addEventListener("hashchange", () => { if (authenticated()) select(location.hash.slice(1)); });
  // AI remains available on every page; applying suggestions brings the form into view.
  window.addEventListener("ai-entry-applied", () => open("new-record"));
  $("overview-detail-board").addEventListener("click", () => $("overview-dialog").close());
  $("overview-detail-updates").addEventListener("click", () => {
    const item = detailItem;
    if (!item) return;
    $("overview-dialog").close(); window.dispatchEvent(new CustomEvent("entry-updates-open", { detail: { id: item.id, title: item.title } }));
  });
  function details(item) {
    detailItem = { id: item.id, title: item.title };
    $("overview-detail-updates").hidden = !["TASK", "VALVE", "ATTENTION"].includes(item.kind);
    $("overview-detail-updates").dataset.entryId = item.id;
    $("overview-detail-updates").textContent = t("updates", { count: item._count?.updates || 0 });
    $("overview-detail-title").textContent = item.title;
    $("overview-detail-board").href = ["EVENT", "NOTE"].includes(item.kind) ? "#history" : "#handover";
    $("overview-detail-board").dataset.i18n = ["EVENT", "NOTE"].includes(item.kind) ? "openHistory" : "openHandover";
    $("overview-detail-board").textContent = t($("overview-detail-board").dataset.i18n);
    $("overview-detail-meta").textContent = `${item.equipmentCode || t("general")} · ${t(item.kind)} · ${item.createdAt ? stamp(item.createdAt) : "—"}`;
    $("overview-detail-description").textContent = item.description || t("detailsInHandover");
    $("overview-dialog").showModal();
  }
  const changeLabels = { NEW_ENTRY: "changeNew", CLOSED_ENTRY: "changeClosed", PROGRESS: "changeProgress", EQUIPMENT: "changeEquipment" };
  function changeText(item) {
    if (item.type !== "EQUIPMENT") return item.body || t("changeNoNote");
    const status = item.fromStatus === item.toStatus ? t("changeEquipmentNote") : t("changeStatus", { from: t(item.fromStatus), to: t(item.toStatus) });
    return `${status}${item.body ? ` · ${item.body}` : ""}`;
  }
  function changeDetails(item) {
    detailItem = item.entryId ? { id: item.entryId, title: item.title } : null;
    $("overview-detail-updates").hidden = !item.entryId;
    $("overview-detail-updates").textContent = t("viewUpdates");
    if (item.entryId) $("overview-detail-updates").dataset.entryId = item.entryId; else delete $("overview-detail-updates").dataset.entryId;
    $("overview-detail-title").textContent = item.title;
    $("overview-detail-meta").textContent = `${t(changeLabels[item.type])} · ${item.actorName || t("unspecified")} · ${stamp(item.createdAt)}`;
    $("overview-detail-description").textContent = changeText(item);
    const history = item.type === "CLOSED_ENTRY";
    $("overview-detail-board").href = history ? "#history" : "#handover";
    $("overview-detail-board").dataset.i18n = history ? "openHistory" : "openHandover";
    $("overview-detail-board").textContent = t($("overview-detail-board").dataset.i18n);
    $("overview-dialog").showModal();
  }
  function renderChanges(changes) {
    const key = JSON.stringify([t("changesTitle"), changes]);
    if (key === changesKey) return;
    changesKey = key;
    $("changes-window").textContent = changes ? t("changesWindow", { date: changes.shiftDate, start: changes.scheduledStart, end: changes.scheduledEnd }) : "";
    $("changes-counts").replaceChildren(...(changes ? Object.entries(changeLabels).map(([type, label]) => {
      const group = make("div"); group.dataset.changeType = type;
      group.append(make("dt", t(label)), make("dd", String(changes.counts[type]))); return group;
    }) : []));
    const children = (changes?.items || []).map(item => {
      const row = make("li"), button = make("button", undefined, "observation-card change-card");
      button.type = "button"; button.dataset.changeType = item.type; button.dataset.changeId = item.id;
      const meta = make("span", undefined, "entry-meta");
      meta.append(make("span", t(changeLabels[item.type]), "change-label"));
      if (item.type !== "EQUIPMENT") meta.append(make("span", item.equipmentCode || t("general"), "status"));
      button.append(meta, make("strong", item.title), make("span", changeText(item), "observation-excerpt"), make("span", `${item.actorName || t("unspecified")} · ${stamp(item.createdAt)}`, "hint"));
      button.addEventListener("click", () => changeDetails(item)); row.append(button); return row;
    });
    if (!children.length) children.push(make("li", t(changes ? "changesEmpty" : "changesUnavailable"), "overview-empty"));
    $("changes-list").replaceChildren(...children);
    $("changes-preview").textContent = changes?.total > (changes?.items?.length || 0) ? t("changesPreview", { shown: changes.items.length, total: changes.total }) : "";
  }
  function render(values = {}) {
    snapshot = { ...snapshot, ...values };
    const { current, summary, checkedAt, stale, currentStale } = snapshot;
    $("overview-shift-status").textContent = t(current === undefined ? "checking" : current ? "active" : "inactive");
    $("overview-shift-hours").textContent = current ? `${current.shiftDate} · ${current.scheduledStart}–${current.scheduledEnd}` : t(current === undefined ? "checkHint" : "overviewNoShift");
    $("overview-updated").textContent = stale || currentStale ? t("overviewStale") : checkedAt ? t("overviewUpdated", { date: stamp(checkedAt) }) : t("summaryLoading");
    $("overview-updated").classList.toggle("error", stale || currentStale);
    renderChanges(summary?.changes);
    // Polls update freshness separately; unchanged data must keep card nodes and keyboard focus.
    const key = JSON.stringify([t("overviewOpenTitle"), summary && [summary.equipment, summary.counts, summary.openItems, summary.recent]]);
    if (key === contentKey) return;
    contentKey = key;
    $("overview-counts").replaceChildren(...[["summaryOpen", "total"], ["summaryImportant", "important"], ["overviewTasks", "TASK"], ["overviewAttention", "ATTENTION"]].map(([label, countKey]) => {
      const card = make("div", undefined, "overview-count"); card.dataset.category = countKey;
      card.append(make("strong", summary ? String(summary.counts[countKey]) : "—"), make("span", t(label)));
      return card;
    }));
    $("overview-equipment").replaceChildren(...(summary?.equipment || []).map(item => {
      const card = make("article", undefined, "equipment-card"); card.dataset.status = item.status; const head = make("div", undefined, "section-title");
      head.append(make("h3", item.code), make("span", t(item.status), `unit-status unit-${item.status.toLowerCase()}`));
      card.append(head, make("p", item.note || "—", "equipment-note"));
      card.title = item.updatedAt ? stamp(item.updatedAt) : t("neverUpdated");
      return card;
    }));
    for (const [id, items, count, recent] of [["overview-important", summary?.openItems, summary?.counts.total, false], ["overview-recent", summary?.recent, summary?.recent.length, true]]) {
      const list = $(id);
      if (!summary) { list.replaceChildren(make("p", t("summaryLoading"), "hint")); continue; }
      const children = (items || []).map(item => {
        const button = make("button", undefined, `observation-card${item.priority === "HIGH" ? " important" : ""}`); button.type = "button"; button.dataset.entryId = item.id;
        const meta = make("span", undefined, "entry-meta");
        meta.append(make("span", item.equipmentCode || t("general"), "status"), make("span", t(item.kind), `entry-kind kind-${item.kind}`));
        if (item.priority === "HIGH") meta.append(make("span", t("HIGH"), "priority-high"));
        button.append(meta, make("strong", item.title), make("span", item.description || t("viewDetails"), "observation-excerpt"));
        if (item.updates?.[0]) button.append(make("span", t("latestUpdate", { text: item.updates[0].body }), "latest-update"));
        if (item.createdAt) button.append(make("span", t(recent ? "recentOn" : "openedOn", { date: stamp(item.createdAt) }), "hint"));
        button.addEventListener("click", () => details(item)); return button;
      });
      if (!children.length) children.push(make("p", t(recent ? "noEntries" : "noOpen"), "overview-empty"));
      if (!recent && count > (items?.length || 0)) children.push(make("p", t("overviewPreview", { shown: items?.length || 0, total: count }), "hint preview-count"));
      list.replaceChildren(...children);
    }
  }
  window.addEventListener("languagechange", () => { select(selected, false, false); render(); });
  return { open, render, get page() { return selected; }, start() { select(location.hash.slice(1), false, false); }, reset() {
    history.replaceState(null, "", `${location.pathname}${location.search}#overview`); select("overview", false, false);
    detailItem = null; $("overview-dialog").close(); $("overview-detail-updates").hidden = true; $("overview-detail-updates").textContent = ""; delete $("overview-detail-updates").dataset.entryId;
    for (const id of ["overview-detail-title", "overview-detail-meta", "overview-detail-description"]) $(id).textContent = "";
    snapshot = { current: undefined, summary: null, checkedAt: null, stale: false, currentStale: false }; render();
  } };
}
