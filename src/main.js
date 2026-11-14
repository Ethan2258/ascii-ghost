// The page around the sky: theme toggle with a circular wipe, hash routing, and record mode.
import { mount } from "./scene.js";

const canvas = document.getElementById("sky");
const params = new URLSearchParams(location.search);

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
  const storedTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } };

  const initialLight = storedTheme() ? storedTheme() === "light" : prefersLight.matches;
  const sky = mount(canvas, { theme: initialLight ? "light" : "dark" });
  window.bloodMoon = sky;

  function applyTheme(isLight, at) {
    document.documentElement.dataset.theme = isLight ? "light" : "dark";
    themeButton.setAttribute("aria-checked", String(isLight));
    document.querySelector('meta[name="theme-color"]').setAttribute("content", isLight ? "#f5f0eb" : "#0c0405");
    sky.setTheme(isLight, at);
  }

  themeButton.addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const isLight = document.documentElement.dataset.theme !== "light";
    applyTheme(isLight, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    try { localStorage.setItem(THEME_KEY, isLight ? "light" : "dark"); } catch (e) {}
  });
  prefersLight.addEventListener("change", () => { if (!storedTheme()) applyTheme(prefersLight.matches); });

  const SITE_TITLE = document.title;
  const views = [...document.querySelectorAll("[data-view]")];
  const navLinks = [...document.querySelectorAll("nav a")];
  function route() {
    const wanted = location.hash.replace(/^#\/?/, "") || "moon";
    const active = views.some((v) => v.dataset.view === wanted) ? wanted : "moon";
    for (const v of views) v.toggleAttribute("data-active", v.dataset.view === active);
    for (const a of navLinks) {
      const target = a.getAttribute("href").replace(/^#\/?/, "") || "moon";
      if (target === active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    document.title = active === "moon" ? SITE_TITLE : `${SITE_TITLE} — ${active}`;
    requestAnimationFrame(() => sky.measure());
  }
  addEventListener("hashchange", route);
  addEventListener("resize", () => requestAnimationFrame(() => sky.measure()));
  applyTheme(initialLight);
  route();
}
