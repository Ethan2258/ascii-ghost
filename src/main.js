// The page around the scene: theme toggle (GPU-composited View Transition crossfade), hash routing
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

  function applyTheme(isLight) {
    root.dataset.theme = isLight ? "light" : "dark";
    themeButton.setAttribute("aria-checked", String(isLight));
    document.querySelector('meta[name="theme-color"]').setAttribute("content", isLight ? "#b8bfbd" : "#060808");
    sky.setTheme(isLight);
  }

  let switching = false;
  /** Swap themes in a circle that grows out of the button. View Transitions snapshot the old and
   *  new page once; the circle is a clip-path animation on the new snapshot, so it runs on the
   *  compositor and nothing (text halos, the canvas) repaints while it plays. */
  function switchTheme() {
    if (switching) return;
    const isLight = root.dataset.theme !== "light";
    try { localStorage.setItem(THEME_KEY, isLight ? "light" : "dark"); } catch (e) {}
    if (!document.startViewTransition || reducedMotion.matches) { applyTheme(isLight); return; }
    switching = true;
    sky.warm(isLight); // the new theme's sky and graves are ready before the old page is captured
    sky.hold(true); // the scene stands still while the circle grows: nothing competes for the frame
    const release = setTimeout(() => sky.hold(false), 1500); // never left frozen, whatever happens to the transition
    root.dataset.transition = "1";
    const vt = document.startViewTransition(() => {
      applyTheme(isLight);
      sky.redraw();
    });
    const b = themeButton.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    vt.ready.then(() => {
      try {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          { duration: 520, easing: "cubic-bezier(.4, 0, .2, 1)", pseudoElement: "::view-transition-new(root)" },
        );
      } catch (e) {} // no pseudo-element animation: the CSS fade still runs
    }).catch(() => {});
    vt.finished.finally(() => {
      delete root.dataset.transition;
      clearTimeout(release);
      if ((root.dataset.theme === "light") !== isLight) { applyTheme(isLight); sky.redraw(); } // the transition was skipped
      sky.hold(false);
      switching = false;
    }).catch(() => {});
  }

  themeButton.addEventListener("click", () => switchTheme());
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
    requestAnimationFrame(() => sky.measure()); // measure immediately on the new active view
  }
  addEventListener("hashchange", route);
  addEventListener("resize", () => requestAnimationFrame(() => sky.measure()));
  applyTheme(initialLight);
  route();
}
