import { t } from "./i18n.js";
const $ = id => document.getElementById(id);
const pages = { overview: ["navOverview", "overviewHint"], "new-record": ["navNew", "newRecordHint"], handover: ["navHandover", "handoverPageHint"], history: ["navHistory", "historyPageHint"] };
const make = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
export function createWorkspace({ authenticated, stamp }) {
  let contentKey = null;
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
  function details(item) {
    $("overview-detail-title").textContent = item.title;
    $("overview-detail-board").href = ["EVENT", "NOTE"].includes(item.kind) ? "#history" : "#handover";
    $("overview-detail-board").dataset.i18n = ["EVENT", "NOTE"].includes(item.kind) ? "openHistory" : "openHandover";
    $("overview-detail-board").textContent = t($("overview-detail-board").dataset.i18n);
    $("overview-detail-meta").textContent = `${item.equipmentCode || t("general")} · ${t(item.kind)} · ${item.createdAt ? stamp(item.createdAt) : "—"}`;
    $("overview-detail-description").textContent = item.description || t("detailsInHandover");
    $("overview-dialog").showModal();
  }
  function render(values = {}) {
    snapshot = { ...snapshot, ...values };
    const { current, summary, checkedAt, stale, currentStale } = snapshot;
    $("overview-shift-status").textContent = t(current === undefined ? "checking" : current ? "active" : "inactive");
    $("overview-shift-hours").textContent = current ? `${current.shiftDate} · ${current.scheduledStart}–${current.scheduledEnd}` : t(current === undefined ? "checkHint" : "overviewNoShift");
    $("overview-updated").textContent = stale || currentStale ? t("overviewStale") : checkedAt ? t("overviewUpdated", { date: stamp(checkedAt) }) : t("summaryLoading");
    $("overview-updated").classList.toggle("error", stale || currentStale);
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
    $("overview-dialog").close();
    for (const id of ["overview-detail-title", "overview-detail-meta", "overview-detail-description"]) $(id).textContent = "";
    snapshot = { current: undefined, summary: null, checkedAt: null, stale: false, currentStale: false }; render();
  } };
}
