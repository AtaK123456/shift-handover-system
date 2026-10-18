const $ = (id) => document.getElementById(id);
const dateFormat = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "short", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
const roles = { WORKER: "Çalışan", SUPERVISOR: "Sorumlu", MANAGER: "Yönetici" };
let token = null;
let user = null;
let current;
let signingUp = false;
let shiftBusy = false;
let loading = false;
let exporting = false;
let page = 1;
let total = 0;
let applied = new URLSearchParams();
let listVersion = 0;
let session = new AbortController();

function notify(text, error = false) {
  const target = token ? $("dashboard-message") : $("auth-message");
  target.textContent = text;
  target.classList.toggle("error", error);
}
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
async function failure(response) {
  try { return (await response.json()).error || "İşlem tamamlanamadı. Tekrar dene."; }
  catch { return "İşlem tamamlanamadı. Tekrar dene."; }
}
function logout() {
  session.abort();
  session = new AbortController();
  token = null; user = null; current = undefined;
  listVersion++;
  $("dashboard").hidden = true;
  $("auth-view").hidden = false;
  $("login-form").reset();
  $("filter-form").reset();
  $("shift-rows").replaceChildren();
  $("account-name").textContent = "";
  $("greeting-name").textContent = "";
  $("scope-field").hidden = true;
  $("auth-message").textContent = "";
  $("dashboard-message").textContent = "";
  $("email").focus();
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, signal: session.signal,
      headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.");
  }
  if (response.status === 401) {
    logout();
    throw new Error("Oturumun sona erdi. Lütfen tekrar giriş yap.");
  }
  if (!response.ok) throw new Error(await failure(response));
  return response;
}
function showError(error) {
  if (error.name !== "AbortError") notify(error.message || "Bir hata oluştu. Tekrar dene.", true);
}
function setPasswordVisible(visible) {
  $("password").type = visible ? "text" : "password";
  $("toggle-password").textContent = visible ? "Gizle" : "Göster";
  $("toggle-password").setAttribute("aria-label", visible ? "Şifreyi gizle" : "Şifreyi göster");
  $("toggle-password").setAttribute("aria-pressed", String(visible));
}
$("toggle-password").addEventListener("click", () => {
  setPasswordVisible($("password").type === "password");
});
$("login-form").addEventListener("reset", () => setPasswordVisible(false));

function authMode(register) {
  setPasswordVisible(false);
  signingUp = register;
  $("name-field").hidden = !register;
  $("name").required = register;
  $("password-hint").hidden = !register;
  $("password").minLength = register ? 12 : 1;
  $("password").autocomplete = register ? "new-password" : "current-password";
  $("auth-title").textContent = register ? "Birlikte başlayalım." : "Tekrar hoş geldin.";
  $("auth-description").textContent = register ? "Kendi vardiyalarını takip etmek için hesabını oluştur." : "Vardiyalarını takip etmek için hesabına giriş yap.";
  $("login-button").textContent = register ? "Hesap oluştur →" : "Giriş yap →";
  $("switch-label").textContent = register ? "Zaten hesabın var mı?" : "Henüz hesabın yok mu?";
  $("switch-auth").textContent = register ? "Giriş yap" : "Hesap oluştur";
  $("auth-message").textContent = "";
}
$("switch-auth").addEventListener("click", () => authMode(!signingUp));
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const register = signingUp;
  $("login-button").disabled = true;
  $("switch-auth").disabled = true;
  notify(register ? "Hesabın oluşturuluyor…" : "Giriş yapılıyor…");
  try {
    const response = await fetch(register ? "/register" : "/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("email").value, password: $("password").value,
        ...(register ? { name: $("name").value } : {}) })
    });
    if (!response.ok) throw new Error(await failure(response));
    if (register) {
      $("password").value = "";
      authMode(false);
      notify("Hesabın oluşturuldu. Şimdi giriş yapabilirsin.");
      $("password").focus();
      return;
    }
    const data = await response.json();
    token = data.token; user = data.user; current = undefined;
    setPasswordVisible(false);
    $("password").value = "";
    $("account-name").textContent = user.name;
    $("account-role").textContent = roles[user.role] || "Çalışan";
    $("greeting-name").textContent = user.name.trim().split(/\s+/)[0];
    $("avatar").textContent = user.name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join("").toLocaleUpperCase("tr-TR");
    $("scope-field").hidden = user.role !== "MANAGER";
    $("auth-view").hidden = true;
    $("dashboard").hidden = false;
    $("today").textContent = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
    applied = new URLSearchParams(); page = 1;
    $("dashboard-message").textContent = "";
    renderCurrent();
    await Promise.all([loadCurrent(), loadHistory()]);
  } catch (error) {
    if (error instanceof TypeError) notify("Sunucuya ulaşılamadı. Lütfen tekrar dene.", true);
    else showError(error);
  } finally { $("login-button").disabled = false; $("switch-auth").disabled = false; }
});
$("logout").addEventListener("click", () => { logout(); notify("Çıkış yapıldı."); });

function elapsedText(start) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, "0")).join(":");
}
function renderCurrent() {
  const known = current !== undefined;
  const active = Boolean(current);
  $("shift-badge").textContent = !known ? "Kontrol ediliyor" : active ? "Vardiya aktif" : "Vardiya kapalı";
  $("shift-badge").classList.toggle("active", active);
  $("shift-title").textContent = !known ? "Vardiyan kontrol ediliyor…" : active ? "Vardiyan devam ediyor." : "Yeni bir vardiyaya hazır mısın?";
  $("shift-description").textContent = !known ? "Durumunu yeniden kontrol etmek için butonu kullanabilirsin." : active ? "İşin bittiğinde vardiyanı buradan sonlandırabilirsin." : "Başladığında saatin otomatik olarak kayıt altına alınır.";
  $("shift-details").hidden = !active;
  $("current-start").textContent = active ? `${timeFormat.format(new Date(current.startTime))} · ${dateFormat.format(new Date(current.startTime))}` : "—";
  $("elapsed").textContent = active ? elapsedText(current.startTime) : "—";
  $("shift-button").disabled = shiftBusy;
  $("shift-button").textContent = shiftBusy ? "İşleniyor…" : !known ? "Durumu kontrol et" : active ? "Vardiyayı bitir →" : "+ Vardiyayı başlat";
  $("shift-action-hint").textContent = active ? "Bitiş saatin otomatik kaydedilir." : "Başlangıç saatin otomatik kaydedilir.";
}
setInterval(() => { if (token && current) $("elapsed").textContent = elapsedText(current.startTime); }, 1000);
async function loadCurrent() {
  const identity = token;
  try { const result = await (await api("/shifts/current")).json(); if (token !== identity) return; current = result.currentShift; renderCurrent(); }
  catch (error) { showError(error); }
}
$("shift-button").addEventListener("click", async () => {
  if (shiftBusy) return;
  if (current === undefined) { await loadCurrent(); return; }
  const ending = Boolean(current);
  shiftBusy = true; renderCurrent();
  try {
    await api(ending ? "/shifts/end" : "/shifts/start", { method: "POST" });
    notify(ending ? "Vardiyan tamamlandı. Kaydını geçmişte görebilirsin." : "Vardiyan başladı. Kolay gelsin!");
  } catch (error) { showError(error); }
  finally {
    if (token) { page = 1; await Promise.all([loadCurrent(), loadHistory()]); }
    shiftBusy = false; renderCurrent();
  }
});
function dateCell(value) {
  if (!value) return node("td", "—");
  const cell = node("td"); const wrap = node("div", undefined, "date-cell");
  wrap.append(node("span", dateFormat.format(new Date(value))), node("small", timeFormat.format(new Date(value))));
  cell.append(wrap); return cell;
}
function duration(start, end) {
  if (!end) return "—";
  const minutes = Math.max(0, Math.floor((new Date(end) - new Date(start)) / 60000));
  return `${Math.floor(minutes / 60)} sa ${String(minutes % 60).padStart(2, "0")} dk`;
}
function renderRows(items) {
  const all = applied.get("scope") === "all";
  $("person-heading").hidden = !all;
  const rows = items.map(item => {
    const row = node("tr"); row.append(node("td", `#${String(item.id).padStart(4, "0")}`));
    if (all) row.append(node("td", item.user.name));
    row.append(dateCell(item.startTime), dateCell(item.endTime), node("td", duration(item.startTime, item.endTime)));
    const status = node("td"); status.append(node("span", item.status === "ACTIVE" ? "Devam ediyor" : "Tamamlandı", `status${item.status === "ACTIVE" ? " active" : ""}`));
    row.append(status); return row;
  });
  $("shift-rows").replaceChildren(...rows);
  $("table-wrap").hidden = items.length === 0;
  $("empty-state").hidden = items.length > 0;
  const filtered = Boolean(applied.get("from") || applied.get("to"));
  $("empty-title").textContent = filtered ? "Bu tarih aralığında kayıt bulunamadı." : "Henüz bir vardiya kaydı yok.";
  $("empty-description").textContent = filtered ? "Farklı bir tarih aralığı seçebilir veya filtreleri temizleyebilirsin." : "İlk kaydını oluşturmak için yukarıdan vardiyanı başlat.";
}
function updateControls() {
  $("previous").disabled = loading || page <= 1;
  $("next").disabled = loading || page * 20 >= total;
  $("filter-button").disabled = loading;
  $("export-button").disabled = loading || exporting || !filtersMatch();
}
function filterParams() {
  const params = new URLSearchParams();
  if ($("from").value) params.set("from", $("from").value);
  if ($("to").value) params.set("to", $("to").value);
  if (user?.role === "MANAGER" && $("scope").value === "all") params.set("scope", "all");
  return params;
}
function filtersMatch() { return filterParams().toString() === applied.toString(); }
async function loadHistory() {
  const version = ++listVersion;
  loading = true; updateControls();
  $("table-loading").hidden = false; $("table-wrap").hidden = true; $("empty-state").hidden = true;
  try {
    const query = new URLSearchParams(applied); query.set("page", String(page));
    const data = await (await api(`/shifts?${query}`)).json();
    if (version !== listVersion || !token) return;
    total = data.total;
    $("record-count").textContent = String(total);
    renderRows(data.items);
    $("page-label").textContent = total ? `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} / ${total} kayıt` : "0 kayıt";
    const from = applied.get("from"), to = applied.get("to");
    $("filter-note").textContent = from || to ? `${from || "İlk kayıttan"} → ${to || "Son kayda kadar"} · Başlangıç tarihine göre · İstanbul saati` : "Tüm tarihler gösteriliyor. Saatler İstanbul saatidir.";
    $("clear-filters").hidden = applied.size === 0;
  } catch (error) {
    if (version !== listVersion) return;
    showError(error);
    $("page-label").textContent = "Kayıtlar yüklenemedi. Uygula ile tekrar dene.";
  } finally {
    if (version === listVersion) { loading = false; $("table-loading").hidden = true; updateControls(); }
  }
}
$("filter-form").addEventListener("input", () => {
  updateControls();
  if (!filtersMatch()) notify("Seçtiğin filtreyi görmek ve Excel’e aktarmak için Uygula’ya bas.");
});
$("filter-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if ($("from").value && $("to").value && $("from").value > $("to").value) return notify("Bitiş tarihi başlangıçtan önce olamaz.", true);
  applied = filterParams(); page = 1; notify(""); await loadHistory();
});
$("clear-filters").addEventListener("click", async () => {
  $("filter-form").reset(); applied = new URLSearchParams(); page = 1; notify(""); await loadHistory();
});
$("previous").addEventListener("click", async () => { if (page > 1) { page--; await loadHistory(); } });
$("next").addEventListener("click", async () => { if (page * 20 < total) { page++; await loadHistory(); } });
$("export-button").addEventListener("click", async () => {
  if (!filtersMatch()) return;
  exporting = true; updateControls(); $("export-label").textContent = "Hazırlanıyor…";
  notify("Excel dosyan hazırlanıyor…");
  try {
    const response = await api(`/shifts/export?${applied}`);
    const url = URL.createObjectURL(await response.blob());
    const link = node("a"); link.href = url;
    link.download = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") || "")?.[1] || "vardiyalar.xlsx";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Excel dosyan hazır. İndirme başlatıldı.");
  } catch (error) { showError(error); }
  finally { exporting = false; $("export-label").textContent = "Excel’e aktar"; updateControls(); }
});
