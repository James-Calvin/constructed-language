(function (root) {
  "use strict";
  const api = root.SECRET_SYMBOL_ANALYTICS;
  const rules = root.LOVE_LANGUAGE_RULES;
  const runtime = root.LOVE_LANGUAGE_SHARED.createAwsRuntime();
  const el = id => document.getElementById(id);
  const checks = [...document.querySelectorAll('input[name="category"]')];
  let rows = [];
  let loaded = false;
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function render() {
    const scroll = [root.scrollX, root.scrollY];
    const focusedTable = document.activeElement?.closest?.(".analytics-data")?.dataset.type;
    const categories = checks.filter(input => input.checked).map(input => input.value);
    const report = api.analyze(rows, rules.loadActiveRuleConfig(), {
      categories, position: el("analyticsPosition").value
    });
    el("analyticsSummary").textContent = !categories.length ? "Select at least one category to see its distribution."
      : `${report.selected} selected words · ${report.analyzed} analyzed · ${report.excluded.length} excluded · ${report.occurrences} symbol occurrences`;
    el("analyticsGuidance").hidden = report.symbols.length > 0;
    const charts = el("analyticsCharts");
    charts.replaceChildren();
    if (categories.length && report.symbols.length && loaded) {
      const max = Math.max(1, ...report.symbols.map(entry => entry.total));
      for (const type of ["vowels", "consonants"]) {
        const section = node("section", null, "analytics-chart");
        section.appendChild(node("h2", type === "vowels" ? "Vowels" : "Consonants"));
        const data = report.symbols.filter(entry => entry.type === type);
        if (!data.length) section.appendChild(node("p", "No symbols configured in this group."));
        const bars = node("div");
        bars.setAttribute("aria-hidden", "true");
        for (const entry of data) {
          const row = node("div", null, "analytics-bar-row");
          row.appendChild(node("span", entry.symbol, "analytics-symbol"));
          const track = node("div", null, "analytics-bar-track");
          const stack = node("div", null, "analytics-bar-stack");
          stack.style.width = `${entry.total / max * 100}%`;
          for (const category of api.categories) {
            const segment = node("span", null, `analytics-segment analytics-${category}`);
            segment.style.width = `${entry.total ? entry[category] / entry.total * 100 : 0}%`;
            stack.appendChild(segment);
          }
          track.appendChild(stack);
          row.appendChild(track);
          row.appendChild(node("span", `${entry.total} (${entry.percentage.toFixed(1)}%)`, "analytics-count"));
          bars.appendChild(row);
        }
        section.appendChild(bars);
        const details = node("details", null, "analytics-data");
        details.dataset.type = type;
        details.open = openTables.has(type);
        details.addEventListener("toggle", () => details.open ? openTables.add(type) : openTables.delete(type));
        details.appendChild(node("summary", "View counts as a table"));
        const wrapper = node("div", null, "analytics-table-scroll");
        const table = node("table");
        table.appendChild(node("caption", `${type === "vowels" ? "Vowel" : "Consonant"} symbol distribution`));
        const head = node("thead");
        const headings = node("tr");
        for (const label of ["Symbol", "Defined", "Candidates", "Undefined", "Total", "Share"]) {
          const cell = node("th", label); cell.setAttribute("scope", "col"); headings.appendChild(cell);
        }
        head.appendChild(headings); table.appendChild(head);
        const body = node("tbody");
        for (const entry of data) {
          const row = node("tr");
          const heading = node("th", entry.symbol); heading.setAttribute("scope", "row"); row.appendChild(heading);
          for (const value of [entry.defined, entry.candidate, entry.undefined, entry.total, `${entry.percentage.toFixed(1)}%`]) row.appendChild(node("td", value));
          body.appendChild(row);
        }
        table.appendChild(body); wrapper.appendChild(table); details.appendChild(wrapper); section.appendChild(details);
        charts.appendChild(section);
      }
    }
    el("analyticsDiagnostics").hidden = !categories.length || !report.excluded.length || !report.symbols.length;
    el("analyticsDiagnosticsTitle").textContent = `Excluded spellings (${report.excluded.length})`;
    el("analyticsExcluded").replaceChildren(...report.excluded.map(item => node("li", `${item.word} — ${item.reason}`)));
    if (focusedTable) charts.querySelector(`[data-type="${focusedTable}"] > summary`)?.focus({ preventScroll: true });
    root.scrollTo(...scroll);
  }
  const openTables = new Set();
  async function read() {
    if (!runtime.isHeartsConfigured || !await runtime.ensureAwsCredentials()) throw new Error("Database access is unavailable.");
    const result = [];
    let cursor;
    do {
      const page = await runtime.getHeartsTableClient().scan({ TableName: runtime.awsConfig.heartsTableName,
        ConsistentRead: true, ...(cursor ? { ExclusiveStartKey: cursor } : {}) }).promise();
      result.push(...(page.Items || []));
      cursor = page.LastEvaluatedKey;
    } while (cursor);
    return result;
  }
  // Chart nodes are non-interactive; controls and diagnostics remain mounted.
  // Defer replacement while a user is focused inside a data-table disclosure.
  const sync = root.SECRET_COOPERATIVE_REFRESH.start({
    read, apply(data) { rows = data; loaded = true; render(); },
    isBusy: () => el("analyticsCharts").contains(document.activeElement),
    onSuccess() { el("analyticsStatus").textContent = "Up to date. Refreshes every 30 seconds while this page is visible and focused."; },
    onError() { el("analyticsStatus").textContent = loaded
      ? "Could not refresh. Showing the last successful data; retrying while active. You can also press Refresh."
      : "Could not load saved words. Retrying while active; press Refresh to try again."; }
  });
  checks.forEach(input => input.addEventListener("change", render));
  el("analyticsPosition").addEventListener("change", render);
  el("analyticsRefresh").addEventListener("click", () => { void sync.request(); });
  root.addEventListener("secret-rules-imported", render);
  root.addEventListener("storage", event => { if (event.key === rules.storageKeys.active) render(); });
  root.addEventListener("beforeunload", () => sync.stop());
  render();
  void sync.request();
})(window);
