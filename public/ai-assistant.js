import { t, lang } from "./i18n.js";
const $ = id => document.getElementById(id);
const element = (tag, text) => { const item = document.createElement(tag); item.textContent = text; return item; };

export function createAiAssistant({ api, isSaving }) {
  let enabled = false, available = false, busy = false, version = 0, connectionVersion = 0, result = null, source = null, message = "", failed = false;
  const input = () => ({ title: $("entry-title").value, description: $("entry-description").value, language: lang() });
  const sameSource = () => source && JSON.stringify(source) === JSON.stringify(input());
  function render() {
    $("ai-analyze").disabled = !enabled || busy || isSaving();
    $("ai-analyze").textContent = t(busy ? "aiAnalyzing" : "aiAnalyze");
    $("ai-status").textContent = t(message || (!available ? "aiChecking" : !enabled ? "aiDisabled" : "aiReady"));
    $("ai-status").classList.toggle("error", failed);
    $("ai-result").hidden = !result;
    $("ai-result").setAttribute("aria-busy", String(busy));
  }
  function invalidate(messageKey = "") {
    version++; busy = false; result = null; source = null; message = messageKey; failed = false;
    $("ai-details").replaceChildren(); render();
  }
  function showResult() {
    const details = $("ai-details"); details.replaceChildren();
    const list = document.createElement("dl");
    for (const [label, value] of [["unit", result.equipment === "GENERAL" ? t("general") : result.equipment === "UNKNOWN" ? t("aiUnknown") : result.equipment],
      ["aiCategory", t(`aiCategory${result.category}`)], ["kind", t(result.kind)],
      ["aiReviewPriority", t(result.priority === "UNKNOWN" ? "aiUnknown" : result.priority)],
      ["aiReason", result.rationale], ["aiUncertainty", result.uncertainty]]) {
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
    render();
  }
  $("ai-analyze").addEventListener("click", async () => {
    if (busy || isSaving() || !enabled) return;
    if (!$("entry-description").value.trim()) { message = "aiNeedDescription"; failed = true; render(); $("entry-description").focus(); return; }
    invalidate(); const requestVersion = ++version, submitted = input(); busy = true; render();
    try {
      const response = await api("/ai/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submitted) });
      const data = await response.json();
      if (requestVersion !== version || JSON.stringify(submitted) !== JSON.stringify(input())) return;
      result = data.analysis; source = submitted; message = "aiReview"; showResult();
    } catch (error) {
      if (requestVersion !== version || error.name === "AbortError") return;
      message = "aiFailed"; failed = true;
    } finally { if (requestVersion === version) { busy = false; render(); } }
  });
  $("ai-apply").addEventListener("click", () => {
    if (!result || isSaving()) return;
    if (!sameSource()) return invalidate("aiStale");
    if ($("ai-use-unit").checked && result.equipment !== "UNKNOWN") $("entry-unit").value = result.equipment === "GENERAL" ? "" : result.equipment;
    if ($("ai-use-kind").checked) $("entry-kind").value = result.kind;
    if ($("ai-use-priority").checked && result.priority !== "UNKNOWN") $("entry-priority").value = result.priority;
    invalidate("aiApplied");
    $("draft-hint").hidden = false;
  });
  $("ai-dismiss").addEventListener("click", () => { invalidate("aiDismissed"); $("ai-analyze").focus(); });
  for (const id of ["entry-title", "entry-description"]) $(id).addEventListener("input", () => {
    if (busy || result) invalidate("aiStale");
  });
  $("entry-form").addEventListener("reset", () => invalidate());
  window.addEventListener("languagechange", () => invalidate(result || busy ? "aiStale" : ""));
  return {
    render,
    reset() { connectionVersion++; enabled = false; available = false; invalidate(); },
    beforeSave() { invalidate(); },
    async load() {
      const requestVersion = connectionVersion;
      try { const response = await api("/ai/status"); const data = await response.json(); if (requestVersion !== connectionVersion) return; enabled = data.enabled === true; }
      catch { if (requestVersion !== connectionVersion) return; enabled = false; }
      if (requestVersion === connectionVersion) { available = true; render(); }
    }
  };
}
