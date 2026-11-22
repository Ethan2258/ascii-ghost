// The page around the scene: theme toggle (in-scene palette blend synced with CSS), hash routing
// with cross-fading views, and record mode.
import { mount } from "./scene.js";

const canvas = document.getElementById("sky");
const params = new URLSearchParams(location.search);
const root = document.documentElement;

if (params.has("record")) {
  // ?record=1320,450,240,24[&embed]  →  window.__sky.frame(i) returns frame i as a PNG data URL;
  // with &embed it is drawn on GitHub's README background colour, with no backdrop of its own.
  const [width, height, frames, fps] = (params.get("record") || "").split(",").map(Number);
  const sky = mount(canvas, { record: { width: width || 1320, height: height || 450, frames: frames || 240, fps: fps || 24, embed: params.has("embed") } });
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

  const THEME_FADE = 560; // ms; index.html's --theme-fade matches it
  function applyTheme(isLight, animate = false) {
    root.dataset.theme = isLight ? "light" : "dark"; // the page colours blend over --theme-fade (CSS)
    themeButton.setAttribute("aria-checked", String(isLight));
    document.querySelector('meta[name="theme-color"]').setAttribute("content", isLight ? "#b8bfbd" : "#060808");
    return sky.setTheme(isLight, { duration: animate ? THEME_FADE : 0 }); // and the scene blends with them
  }

  /** The scene blends its own palette from one theme to the other while the ghosts drift on, and
   *  the page colours follow by CSS in the same time and ease: no snapshots, no masks. Switching
   *  again mid-way simply turns round from where it has got to. */
  function switchTheme() {
    const isLight = root.dataset.theme !== "light";
    try { localStorage.setItem(THEME_KEY, isLight ? "light" : "dark"); } catch (e) {}
    applyTheme(isLight, true);
  }

  themeButton.addEventListener("click", () => switchTheme());
  prefersLight.addEventListener("change", () => { if (!storedTheme()) applyTheme(prefersLight.matches, true); });

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
    requestAnimationFrame(() => sky.measure()); // measure immediately on the new active view
  }
  addEventListener("hashchange", route);
  addEventListener("resize", () => requestAnimationFrame(() => sky.measure()));
  applyTheme(initialLight);
  route();
}
