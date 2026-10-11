(function (root) {
  "use strict";
  function fingerprint(value) {
    function stable(item) {
      if (Array.isArray(item)) return item.map(stable);
      if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map(key => [key, stable(item[key])]));
      return item;
    }
    // Serialize each row once, rather than again for every sort comparison.
    return `[${Array.from(value,item=>JSON.stringify(stable(item))??"null").sort((a,b)=>a.localeCompare(b)).join(",")}]`;
  }
  function start({ read, apply, isBusy = () => false, version = () => 0, onSuccess = () => {},
    onError = error => console.warn("Shared refresh failed; keeping the current view.", error), scope = root,
    interval = 30000, nextDelay = null }) {
    const doc = scope.document;
    let running = false;
    let stopped = false;
    let pending = false;
    let retryTimer;
    let lastFingerprint;
    let lastAppliedVersion;
    let timer;
    function schedule(){if(nextDelay&&!stopped){scope.clearTimeout(timer);timer=scope.setTimeout(()=>{void request();},Math.max(1,nextDelay()));}}
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
      finally { running = false; retry(); schedule(); }
    }
    const wake = () => { void request(); };
    const resume = () => { if (pending) retry(); };
    scope.addEventListener("focus", wake);
    doc.addEventListener("visibilitychange", wake);
    doc.addEventListener("focusout", resume);
    doc.addEventListener("compositionend", resume);
    if(nextDelay)schedule();else timer=scope.setInterval(wake, interval);
    return { request, seed: data => { lastFingerprint = fingerprint(data); lastAppliedVersion = version(); }, stop() {
      stopped = true;
      if(nextDelay)scope.clearTimeout(timer);else scope.clearInterval(timer);
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
