(function (root) {
  "use strict";
  function bind({ element, exclude = () => false, next, back, now = Date.now }) {
    let pointer = null, suppressUntil = 0;
    function down(event) {
      suppressUntil = 0;
      if (event.isPrimary === false) { pointer = null; return; }
      if (!["touch", "pen"].includes(event.pointerType) || exclude(event.target)) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    }
    function move(event) {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) pointer.moved = true;
      if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        try { element.setPointerCapture?.(event.pointerId); } catch { /* Pointer may have been cancelled. */ }
      }
    }
    function up(event) {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      const moved = pointer.moved || Math.abs(dx) > 10 || Math.abs(dy) > 10;
      pointer = null;
      if (moved) suppressUntil = now() + 500;
      if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
      if (dx < 0) next(); else back();
    }
    function cancel() { if (pointer?.moved) suppressUntil = now() + 500; pointer = null; }
    function click(event) {
      // Keyboard activation has detail=0 and must remain available after a swipe.
      if (event.detail !== 0 && now() < suppressUntil) {
        suppressUntil = 0; event.preventDefault(); event.stopPropagation();
      }
    }
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    element.addEventListener("click", click, true);
    return { stop() {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("click", click, true);
    } };
  }
  const api = { bind };
  root.SECRET_FLASHCARD_GESTURES = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
