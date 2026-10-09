(function (root) {
  "use strict";
  function fingerprint(value) {
    function stable(item) {
      if (Array.isArray(item)) return item.map(stable);
      if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map(key => [key, stable(item[key])]));
      return item;
    }
    return JSON.stringify(value.map(stable).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  function start({ read, apply, isBusy = () => false, version = () => 0, onSuccess = () => {},
    onError = error => console.warn("Shared refresh failed; keeping the current view.", error), scope = root,
    interval = 30000 }) {
    const doc = scope.document;
    let running = false;
    let stopped = false;
    let pending = false;
    let retryTimer;
    let lastFingerprint;
    let lastAppliedVersion;
    const active = () => doc.visibilityState !== "hidden" && (!doc.hasFocus || doc.hasFocus());
    function retry() {
      if (stopped || !pending || retryTimer || !active()) return;
      retryTimer = scope.setTimeout(() => { retryTimer = null; void request(); }, 1000);
    }
    async function request() {
      if (stopped || !active() || running) return;
      if (isBusy()) { pending = true; retry(); return; }
      running = true;
      pending = false;
      const revision = version();
      try {
        const data = await read();
        if (stopped) return;
        if (!active() || isBusy() || revision !== version()) {
          pending = true;
          return;
        }
        const signature = fingerprint(data);
        if (signature !== lastFingerprint || revision !== lastAppliedVersion) {
          await apply(data);
          lastFingerprint = signature;
          lastAppliedVersion = revision;
        }
        onSuccess();
      } catch (error) { onError(error); }
      finally { running = false; retry(); }
    }
    const wake = () => { void request(); };
    const resume = () => { if (pending) retry(); };
    scope.addEventListener("focus", wake);
    doc.addEventListener("visibilitychange", wake);
    doc.addEventListener("focusout", resume);
    doc.addEventListener("compositionend", resume);
    const timer = scope.setInterval(wake, interval);
    return { request, seed: data => { lastFingerprint = fingerprint(data); lastAppliedVersion = version(); }, stop() {
      stopped = true;
      scope.clearInterval(timer);
      scope.clearTimeout(retryTimer);
      scope.removeEventListener("focus", wake);
      doc.removeEventListener("visibilitychange", wake);
      doc.removeEventListener("focusout", resume);
      doc.removeEventListener("compositionend", resume);
    } };
  }
  const api = { start, fingerprint };
  root.SECRET_COOPERATIVE_REFRESH = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
