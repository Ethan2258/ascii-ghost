// The page around the scene: theme toggle (a circular view-transition wipe), hash routing
// with cross-fading views, and record mode.
import { mount } from "./scene.js";

const canvas = document.getElementById("sky");
const params = new URLSearchParams(location.search);
const root = document.documentElement;

if (params.has("record")) {
  // ?record=1320,450,240,24  →  window.__sky.frame(i) returns frame i as a PNG data URL.
  const [width, height, frames, fps] = (params.get("record") || "").split(",").map(Number);
  const sky = mount(canvas, { record: { width: width || 1320, height: height || 450, frames: frames || 240, fps: fps || 24 } });
  sky.setTheme(params.get("theme") === "light");
  window.__sky = sky;
} else {
  const THEME_KEY = "theme";
  const themeButton = document.querySelector("nav button");
  const prefersLight = matchMedia("(prefers-color-scheme: light)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const storedTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } };

  const initialLight = storedTheme() ? storedTheme() === "light" : prefersLight.matches;
  const sky = mount(canvas, { theme: initialLight ? "light" : "dark" });
  window.ghostRealm = sky;

  function applyTheme(isLight) {
    root.dataset.theme = isLight ? "light" : "dark";
    themeButton.setAttribute("aria-checked", String(isLight));
    document.querySelector('meta[name="theme-color"]').setAttribute("content", isLight ? "#e2e1de" : "#0a0a0c");
    sky.setTheme(isLight);
  }

  /** The browser snapshots the old page; the new one (canvas still running) is revealed in a growing circle. */
  let switching = false;
  function switchTheme(x, y) {
    if (switching) return;
    const isLight = root.dataset.theme !== "light";
    try { localStorage.setItem(THEME_KEY, isLight ? "light" : "dark"); } catch (e) {}
    if (!document.startViewTransition || reducedMotion.matches) { applyTheme(isLight); return; }
    switching = true;
    root.dataset.transition = "theme";
    const vt = document.startViewTransition(() => { applyTheme(isLight); sky.redraw(); });
    vt.ready.then(() => {
      const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 850, easing: "cubic-bezier(.7, 0, .3, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    }).catch(() => {});
    vt.finished.finally(() => { delete root.dataset.transition; switching = false; });
  }

  themeButton.addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    switchTheme(r.left + r.width / 2, r.top + r.height / 2);
  });
  prefersLight.addEventListener("change", () => { if (!storedTheme()) applyTheme(prefersLight.matches); });

  const SITE_TITLE = document.title;
  const views = [...document.querySelectorAll("[data-view]")];
  const navLinks = [...document.querySelectorAll("nav a")];
  function route() {
    const wanted = location.hash.replace(/^#\/?/, "") || "realm";
    const active = views.some((v) => v.dataset.view === wanted) ? wanted : "realm";
    for (const v of views) v.toggleAttribute("data-active", v.dataset.view === active);
    for (const a of navLinks) {
      const target = a.getAttribute("href").replace(/^#\/?/, "") || "realm";
      if (target === active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    document.title = active === "realm" ? SITE_TITLE : `${SITE_TITLE} — ${active}`;
    setTimeout(() => sky.measure(), 520); // after the cross-fade settles
  }
  addEventListener("hashchange", route);
  addEventListener("resize", () => requestAnimationFrame(() => sky.measure()));
  applyTheme(initialLight);
  route();
}
