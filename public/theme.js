(() => {
  const key = "vardiya-theme";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const valid = (value) => value === "light" || value === "dark" ? value : null;
  let preference = null;
  try { preference = valid(localStorage.getItem(key)); } catch { /* Storage may be disabled. */ }

  function apply() {
    const theme = preference || (system.matches ? "dark" : "light");
    const dark = theme === "dark";
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111c19" : "#f6f7f4");
    document.querySelectorAll("[data-theme-toggle]").forEach(button => {
      button.textContent = window.appI18n ? window.appI18n.t(dark ? "light" : "dark") : dark ? "Açık mod" : "Koyu mod";
      button.setAttribute("aria-label", window.appI18n ? window.appI18n.t(dark ? "lightLabel" : "darkLabel") : dark ? "Açık moda geç" : "Koyu moda geç");
      button.setAttribute("aria-pressed", String(dark));
    });
  }
  apply();
  document.addEventListener("DOMContentLoaded", () => {
    apply();
    document.querySelectorAll("[data-theme-toggle]").forEach(button => {
      button.addEventListener("click", () => {
        preference = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        try { localStorage.setItem(key, preference); } catch { /* Keep the in-memory choice. */ }
        apply();
      });
    });
  });
  window.addEventListener("languagechange", apply);
  system.addEventListener("change", () => { if (!preference) apply(); });
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) { preference = valid(event.newValue); apply(); }
  });
})();
