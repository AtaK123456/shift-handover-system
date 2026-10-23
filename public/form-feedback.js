import { t } from "./i18n.js";

// Keep native validation and focus behavior, with persistent, translated errors
// beside the field. Values and existing hint associations are never replaced.
export function initializeFormFeedback() {
  const errors = new Map();
  function clear(field) {
    const message = errors.get(field);
    if (!message) return;
    field.removeAttribute("aria-invalid");
    const ids = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== message.id);
    if (ids.length) field.setAttribute("aria-describedby", ids.join(" "));
    else field.removeAttribute("aria-describedby");
    message.remove(); errors.delete(field);
  }
  function render(field) {
    if (!field.willValidate || field.validity.valid || field.closest("[hidden]")) return clear(field);
    let message = errors.get(field);
    if (!message) {
      message = document.createElement("p");
      message.id = `${field.id}-error`; message.className = "field-error";
      // Place password errors below the complete input/show-button group.
      (field.closest(".password-field") || field).after(message);
      errors.set(field, message);
      const ids = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      field.setAttribute("aria-describedby", [...ids, message.id].join(" "));
    }
    const validity = field.validity;
    message.textContent = validity.valueMissing ? t("fieldRequired")
      : validity.typeMismatch && field.type === "email" ? t("fieldEmail")
      : validity.tooShort ? t("fieldMinLength", { count: field.minLength })
      : validity.tooLong ? t("fieldMaxLength", { count: field.maxLength }) : t("fieldInvalid");
    field.setAttribute("aria-invalid", "true");
  }
  const eligible = field => field?.form && field.id && "validity" in field;
  document.addEventListener("invalid", event => { if (eligible(event.target)) render(event.target); }, true);
  // Show new errors on submission. Adding layout during focusout can move the
  // submit button between pointer-down and pointer-up and swallow the click.
  document.addEventListener("input", event => { if (errors.has(event.target)) render(event.target); });
  document.addEventListener("change", event => { if (errors.has(event.target)) render(event.target); });
  const reset = form => { for (const field of errors.keys()) if (field.form === form) clear(field); };
  document.addEventListener("reset", event => reset(event.target));
  window.addEventListener("languagechange", () => { for (const field of errors.keys()) render(field); });
  return { reset };
}
