(function (root) {
  "use strict";
  function create({ element, reducedMotion = () => root.matchMedia?.("(prefers-reduced-motion: reduce)").matches }) {
    let animation = null, version = 0, flipping = false;
    function cancel() {
      version++; flipping = false;
      animation?.cancel(); animation = null;
    }
    const enabled = () => typeof element.animate === "function" && !reducedMotion();
    async function flip(change) {
      if (flipping) return;
      cancel();
      if (!enabled()) { change(); return; }
      flipping = true;
      const current = version;
      try {
        animation = element.animate([
          { transform: "perspective(900px) rotateY(0deg)" },
          { transform: "perspective(900px) rotateY(90deg)" }
        ], { duration: 130, easing: "ease-in", fill: "forwards" });
        await animation.finished;
        if (current !== version) return;
        // Switch the content only when the card is edge-on, so neither side
        // appears mirrored or changes visibly before the turn.
        change();
        animation.cancel();
        animation = element.animate([
          { transform: "perspective(900px) rotateY(-90deg)" },
          { transform: "perspective(900px) rotateY(0deg)" }
        ], { duration: 160, easing: "ease-out" });
        await animation.finished;
      } catch { /* Cancellation is expected on Next, Shuffle or navigation. */ }
      finally {
        if (current === version) { animation?.cancel(); animation = null; flipping = false; }
      }
    }
    function slide(change, direction = 1) {
      cancel(); change();
      if (!enabled()) return;
      const current = version;
      animation = element.animate([
        { transform: `translateX(${24 * direction}px)`, opacity: 0 },
        { transform: "translateX(0)", opacity: 1 }
      ], { duration: 240, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" });
      animation.finished.catch(() => {}).finally(() => {
        if (current === version) { animation?.cancel(); animation = null; }
      });
    }
    return { flip, slide, cancel };
  }
  const api = { create };
  root.SECRET_FLASHCARD_MOTION = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
