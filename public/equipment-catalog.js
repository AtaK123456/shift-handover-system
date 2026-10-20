import { t } from "./i18n.js";
const $ = id => document.getElementById(id);
export const equipmentLabel = item => item.name && item.name !== item.code ? `${item.code} · ${item.name}` : item.code;
export function createEquipmentCatalog({ api, getUser, onSaved }) {
  let rows = [], signature = "", editing = null, busy = false, generation = 0;
  function selectValue(value) {
    const select = $("entry-unit");
    if (value && ![...select.options].some(option => option.value === value)) select.add(new Option(value, value));
    select.value = value;
  }
  function selectors(force = false) {
    const next = JSON.stringify(rows.map(item => [item.code, item.name]));
    if (!force && next === signature) return;
    signature = next;
    for (const id of ["entry-unit", "operations-unit"]) {
      const select = $(id), selected = select.value;
      const options = id === "entry-unit" ? [new Option(t("general"), "")] : [new Option(t("allUnits"), ""), new Option(t("general"), "GENERAL")];
      options.push(...rows.map(item => new Option(equipmentLabel(item), item.code)));
      if (selected && !options.some(option => option.value === selected)) options.push(new Option(selected, selected));
      select.replaceChildren(...options); select.value = selected;
    }
  }
  function render(items) {
    rows = items; selectors();
    $("catalog-add").hidden = getUser()?.role !== "MANAGER";
  }
  function open(item = null) {
    if (getUser()?.role !== "MANAGER" || busy) return;
    editing = item ? { ...item } : null; $("catalog-form").reset();
    $("catalog-code").value = item?.code || ""; $("catalog-code").readOnly = Boolean(item);
    $("catalog-name").value = item?.name || item?.code || ""; $("catalog-message").textContent = "";
    $("catalog-dialog-title").textContent = t(item ? "catalogRename" : "catalogAdd");
    $("catalog-dialog").showModal(); $(item ? "catalog-name" : "catalog-code").focus();
  }
  $("catalog-add").addEventListener("click", () => open());
  $("catalog-code").addEventListener("input", () => { $("catalog-code").value = $("catalog-code").value.toUpperCase(); });
  $("catalog-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy || getUser()?.role !== "MANAGER") return;
    const ticket = generation; busy = true; $("catalog-save").disabled = true; $("catalog-message").textContent = "";
    const item = editing, body = item ? { name: $("catalog-name").value, version: item.version } : { code: $("catalog-code").value, name: $("catalog-name").value };
    $("catalog-code").disabled = true; $("catalog-name").disabled = true;
    try {
      await api(item ? `/operations/equipment/${encodeURIComponent(item.code)}` : "/operations/equipment", { method: item ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (ticket !== generation) return;
      $("catalog-dialog").close(); await onSaved();
    } catch (error) { if (ticket === generation && error.name !== "AbortError") $("catalog-message").textContent = error.message || t("failed"); }
    finally { if (ticket === generation) { busy = false; $("catalog-save").disabled = false; $("catalog-code").disabled = false; $("catalog-name").disabled = false; } }
  });
  window.addEventListener("languagechange", () => {
    selectors(true); $("catalog-dialog-title").textContent = t(editing ? "catalogRename" : "catalogAdd");
  });
  return { render, open, selectValue, reset() {
    generation++; busy = false; editing = null; rows = []; signature = ""; selectors(true);
    $("entry-unit").value = ""; $("operations-unit").value = "";
    for (const id of ["entry-unit", "operations-unit"]) [...$(id).options].filter(option => option.value && option.value !== "GENERAL").forEach(option => option.remove());
    $("catalog-add").hidden = true; $("catalog-form").reset(); $("catalog-message").textContent = ""; $("catalog-save").disabled = false; $("catalog-code").disabled = false; $("catalog-name").disabled = false;
  } };
}
