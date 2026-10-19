import { t, lang } from "./i18n.js";
const $ = id => document.getElementById(id);
const element = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item; };

export function createAiAssistant({ api, isSaving }) {
  let enabled = false, available = false, busy = false, version = 0, connectionVersion = 0, composerVersion = 0;
  let result = null, source = null, record = "", recordTitle = "", message = "", failed = false;
  const draft = () => ({ title: $("entry-title").value, description: $("entry-description").value, language: lang() });
  const sameSource = () => source && JSON.stringify(source.draft) === JSON.stringify(draft());
  const needsText = () => source && source.description !== $("entry-description").value;
  const scroll = () => { $("ai-chat-scroll").scrollTop = $("ai-chat-scroll").scrollHeight; };
  function open() {
    $("ai-chat").hidden = false; $("ai-launcher").setAttribute("aria-expanded", "true");
    $("ai-chat-input").focus(); scroll();
  }
  function close(focus = true) {
    $("ai-chat").hidden = true; $("ai-launcher").setAttribute("aria-expanded", "false");
    if (focus) $("ai-launcher").focus();
  }
  function render() {
    $("ai-chat-input").placeholder = t("aiPlaceholder");
    $("ai-analyze").disabled = !enabled || busy || isSaving();
    $("ai-analyze").textContent = t(busy ? "aiAnalyzing" : "aiSend");
    $("ai-import").disabled = busy || isSaving();
    $("ai-use-text").disabled = isSaving();
    $("ai-apply").disabled = busy || isSaving() || Boolean(needsText() && !$("ai-use-text").checked) || Boolean($("ai-chat-input").value.trim());
    $("ai-status").textContent = t(message || (!available ? "aiChecking" : !enabled ? "aiDisabled" : "aiChatReady"));
    $("ai-status").classList.toggle("error", failed);
    $("ai-result").hidden = !result;
    $("ai-messages").setAttribute("aria-busy", String(busy));
  }
  function invalidate(messageKey = "") {
    version++; busy = false; result = null; source = null; message = messageKey; failed = false;
    $("ai-details").replaceChildren(); render();
  }
  function clear() {
    invalidate(); record = ""; recordTitle = ""; $("ai-chat-input").value = ""; $("ai-messages").replaceChildren();
  }
  function bubble(role, text) {
    const item = element("div", undefined, `ai-bubble ai-bubble-${role}`);
    item.append(element("strong", t(role === "user" ? "aiYou" : "aiTitle")), element("p", text));
    $("ai-messages").append(item);
    while ($("ai-messages").children.length > 10) $("ai-messages").firstElementChild.remove();
    scroll();
  }
  function showResult() {
    const details = $("ai-details"); details.replaceChildren(); const list = document.createElement("dl");
    for (const [label, value] of [["unit", result.equipment === "GENERAL" ? t("general") : result.equipment === "UNKNOWN" ? t("aiUnknown") : result.equipment],
      ["aiCategory", t(`aiCategory${result.category}`)], ["kind", t(result.kind)],
      ["aiReviewPriority", t(result.priority === "UNKNOWN" ? "aiUnknown" : result.priority)], ["aiReason", result.rationale], ["aiUncertainty", result.uncertainty]]) {
      list.append(element("dt", t(label)), element("dd", value));
    }
    details.append(list, element("h4", t("aiEvidence")));
    const evidence = document.createElement("ul"); result.evidence.forEach(quote => evidence.append(element("li", quote))); details.append(evidence);
    details.append(element("h4", t("aiQuestions")));
    const questions = document.createElement("ul"); result.questions.forEach(question => questions.append(element("li", question)));
    details.append(result.questions.length ? questions : element("p", t("aiNoQuestions")));
    for (const [id, valid] of [["ai-use-unit", result.equipment !== "UNKNOWN"], ["ai-use-kind", true], ["ai-use-priority", result.priority !== "UNKNOWN"]]) {
      $(id).disabled = !valid; $(id).checked = valid;
    }
    $("ai-text-option").hidden = !needsText(); $("ai-use-text").checked = Boolean(needsText());
    render(); scroll();
  }
  $("ai-launcher").addEventListener("click", () => $("ai-chat").hidden ? open() : close());
  $("ai-chat-close").addEventListener("click", () => close());
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !$("ai-chat").hidden && !document.querySelector("dialog[open]")) { event.preventDefault(); close(); }
  });
  $("ai-chat-input").addEventListener("keydown", event => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $("ai-chat-form").requestSubmit(); }
  });
  $("ai-import").addEventListener("click", () => {
    if (busy || isSaving()) return;
    if (record || $("ai-chat-input").value.trim()) { if (!confirm(t("aiReplaceChat"))) return; }
    clear(); recordTitle = $("entry-title").value; $("ai-chat-input").value = $("entry-description").value;
    message = "aiImported"; render(); $("ai-chat-input").focus();
  });
  $("ai-clear").addEventListener("click", () => {
    if ((record || $("ai-chat-input").value.trim()) && !confirm(t("aiClearConfirm"))) return;
    clear(); $("ai-chat-input").focus();
  });
  $("ai-chat-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy || isSaving() || !enabled) return;
    const text = $("ai-chat-input").value.trim();
    if (!text && !record) { message = "aiNeedMessage"; failed = true; render(); $("ai-chat-input").focus(); return; }
    const description = record && text ? `${record}\n${text}` : record || text;
    if (description.length > 4000) { message = "aiChatLimit"; failed = true; render(); return; }
    invalidate(); const requestVersion = ++version, snapshot = draft(), sentComposerVersion = composerVersion;
    const submitted = { title: recordTitle, description, language: lang() };
    busy = true; if (text) bubble("user", text); render();
    try {
      const response = await api("/ai/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submitted) });
      const data = await response.json();
      if (requestVersion !== version || JSON.stringify(snapshot) !== JSON.stringify(draft())) return;
      result = data.analysis; source = { draft: snapshot, description, title: submitted.title };
      record = description;
      // Keep text typed during the request; clear only the message that was actually sent.
      if (composerVersion === sentComposerVersion && $("ai-chat-input").value.trim() === text) $("ai-chat-input").value = "";
      message = "aiReview"; bubble("assistant", result.rationale); showResult();
    } catch (error) {
      if (requestVersion !== version || error.name === "AbortError") return;
      message = "aiFailed"; failed = true;
    } finally { if (requestVersion === version) {
      busy = false; render();
      const reply = $("ai-messages").lastElementChild;
      if (result && reply) $("ai-chat-scroll").scrollTop += reply.getBoundingClientRect().top - $("ai-chat-scroll").getBoundingClientRect().top - 12;
      else scroll();
    } }
  });
  $("ai-use-text").addEventListener("change", render);
  $("ai-chat-input").addEventListener("input", () => { composerVersion++; render(); });
  $("ai-apply").addEventListener("click", () => {
    if (!result || busy || isSaving() || $("ai-chat-input").value.trim()) return;
    if (!sameSource()) return invalidate("aiStale");
    if (needsText() && !$("ai-use-text").checked) return;
    if (needsText()) {
      $("entry-description").value = source.description;
      $("entry-title").value = source.title || (source.description.split(/[\n.!?]/)[0].trim() || source.description).slice(0,160);
    }
    if ($("ai-use-unit").checked && result.equipment !== "UNKNOWN") $("entry-unit").value = result.equipment === "GENERAL" ? "" : result.equipment;
    if ($("ai-use-kind").checked) $("entry-kind").value = result.kind;
    if ($("ai-use-priority").checked && result.priority !== "UNKNOWN") $("entry-priority").value = result.priority;
    invalidate("aiApplied"); $("draft-hint").hidden = false;
  });
  $("ai-dismiss").addEventListener("click", () => { invalidate("aiDismissed"); $("ai-chat-input").focus(); });
  for (const id of ["entry-title", "entry-description"]) $(id).addEventListener("input", () => {
    if (busy || result) invalidate("aiStale");
  });
  $("entry-form").addEventListener("reset", () => invalidate());
  window.addEventListener("languagechange", () => { invalidate(result || busy ? "aiStale" : ""); });
  return {
    render,
    dirty: () => Boolean(record || $("ai-chat-input").value.trim()),
    snapshot: () => ({ record, recordTitle, text: $("ai-chat-input").value }),
    restore(saved) { if (!saved) return; clear(); record = saved.record; recordTitle = saved.recordTitle; $("ai-chat-input").value = saved.text; message = "aiChatRestored"; render(); },
    reset() { connectionVersion++; enabled = false; available = false; clear(); close(false); },
    beforeSave() { invalidate(); },
    async load() {
      const requestVersion = connectionVersion;
      try { const response = await api("/ai/status"); const data = await response.json(); if (requestVersion !== connectionVersion) return; enabled = data.enabled === true; }
      catch { if (requestVersion !== connectionVersion) return; enabled = false; }
      if (requestVersion === connectionVersion) { available = true; render(); }
    }
  };
}
