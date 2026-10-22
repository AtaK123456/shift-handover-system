// Keep floating panels inside the visible area when a phone keyboard opens.
// No keyboard detection is needed to resize dialogs; the heuristic only hides
// floating navigation that would otherwise compete with the editor.
const root = document.documentElement;
const viewport = window.visualViewport;
const mobile = matchMedia("(max-width:700px), (max-width:1000px) and (max-height:500px)");
let frame = 0, baselineHeight = innerHeight, baselineWidth = innerWidth, previousHeight = 0;
function update() {
  frame = 0;
  // Preserve native pinch zoom rather than interpreting it as a keyboard.
  if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
  const height = viewport?.height || innerHeight, top = Math.max(0, viewport?.offsetTop || 0);
  const active = document.activeElement;
  const editing = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement && ["text", "email", "password", "search", "tel", "url", "number"].includes(active.type);
  if (innerWidth !== baselineWidth || !editing) { baselineWidth = innerWidth; baselineHeight = innerHeight; }
  const keyboard = mobile.matches && editing && Math.max(baselineHeight, innerHeight, root.clientHeight) - height > 120;
  const wasOpen = root.classList.contains("keyboard-open");
  root.classList.toggle("keyboard-open", keyboard);
  for (const [name, value] of [["--visible-viewport-height", `${height}px`], ["--visible-viewport-top", `${top}px`]]) {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }
  if (keyboard && (!wasOpen || height < previousHeight) && active?.closest('dialog[open], #ai-chat:not([hidden])')) {
    requestAnimationFrame(() => { if (active === document.activeElement) active.scrollIntoView({ block: "nearest", inline: "nearest" }); });
  }
  previousHeight = height;
}
function schedule() { if (!frame) frame = requestAnimationFrame(update); }
viewport?.addEventListener("resize", schedule);
viewport?.addEventListener("scroll", schedule);
window.addEventListener("resize", schedule);
window.addEventListener("orientationchange", schedule);
document.addEventListener("focusin", schedule);
document.addEventListener("focusout", schedule);
mobile.addEventListener?.("change", schedule);
update();
