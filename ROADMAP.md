# Cooperative Language Tool Roadmap

This document tracks the agreed feature backlog. Mark an item `[x]` when its behavior is implemented and verified.

## Dictionary search

- [x] Add dictionary search by word spelling and definition, working alongside category filters. IPA search is not needed for this pass.

## Candidates, approval, and shared hearts

- [x] Add a Candidate section for newly defined words. Preserve all existing defined words in the Defined category when introducing this workflow.
- [x] Allow a different user to approve a candidate, moving it into Defined. A word's defining user cannot supply its second-person approval.
- [x] Temporary Defined-to-Candidate action used for the initial review; removed after that cleanup was completed.
- [x] Render words hearted by multiple distinct users in sunrise yellow. Keep hearts as personal preferences, with approval as an explicit action.

## Word notes

- [x] Add optional per-word notes with author and date, hidden in a collapsed area by default.
- [x] Show a small filled red heart as the unread-notes notification on a word. Track which notes each user has read, and clear the notification when they view those notes.

## Roots, related words, and word building

- [x] Add collapsed dictionary relationship panels with labeled, reciprocal links, multiple roots, ordered compound parts, explanations, shared editing, and confirmed removal.
- [x] Add a shared root/prefix/suffix inventory, including root-only entries, dictionary counterpart warnings, and candidate-root creation or connection to existing words.
- [x] Add an authenticated Word building page with searchable parts, editable assembly and IPA, rule warnings with explicit overrides, and optional written/requested meanings.
- [x] Generate related words using a chosen root at the start or end, with optional relationship saving only after the word is saved.
- [x] Preserve stable identities through renames and relationships through undefine; delete incident links without deleting connected words. Support conditional writes, partial-save retries, and cooperative refresh.

Temporary typed assembly parts are not added to the shared inventory or linked automatically. Save them as inventory entries to reuse and link them. Automatic sound changes, inflection paradigms, and family-tree visualizations remain deferred.

### Compound toolbox and workbench

- [x] Keep Word building authenticated but hidden from navigation and dictionary builder shortcuts; retain inventory and manual tools under collapsed Advanced controls.
- [x] Add movable dictionary-word cards, repeatable components, sense selection, literal glosses, editable definitions, and keyboard/touch button alternatives to dragging.
- [x] Remember each named user's toolbox and workbench locally in their browser; storage failures do not prevent building.
- [x] Store one ordered composition per saved result, with conditional replacement, stable endpoints, snapshots and attribution; preserve existing definitions and approval when using saved words.
- [x] Derive shared prefix/root/suffix position counts from saved component occurrences, including repetitions, without counting experiments or retries.
- [x] Display composition relationships, follow renamed endpoints, retain historical missing-component snapshots, and preserve drafts on failed or stale saves with composition-only retries.

Compounds require at least two saved components. Position counts describe compound structure, not grammatical affix categories. Existing manual relationships are preserved and do not create inferred recipes. Automated service/UI regressions pass; live AWS and desktop/mobile browser interaction checks remain manual verification tasks.

## Review words affected by rule changes

- [ ] When preparing to publish language/generator settings, show all existing words that mismatch the proposed rules, including spelling-rule mismatches and changed or undeterminable IPA mappings. Explain the mismatch for each word.
- [ ] Give every affected word an Update action and a Keep as-is action. Show the proposed update before applying it; when no unique correction can be inferred, allow an explicit spelling/IPA correction rather than guessing.
- [ ] Apply only explicitly selected word updates when the settings change is published. Keep as-is dismisses that word's review message, and any undecided words remain unchanged without blocking publication.

## Dictionary downloads

- [ ] Add a downloadable Markdown dictionary containing accepted Defined words in alphabetical order, with spelling, pronunciation, and definition, formatted like a readable dictionary.
- [ ] Offer optional notes and definition dates in the readable dictionary download.
- [ ] Add CSV export with richer structured data, including spelling, IPA, definition, category, definition author/date, hearts, notes, and root relationships where available.

## Meanings that need words

- [x] Add a shared list of desired definitions or concepts that do not yet have words, separate from undefined words that already have a spelling.
- [x] Make it easy to assign an existing word, a generated word, or a manually entered word to a desired definition. A newly defined assignment enters the Candidate approval workflow.
- [x] Mark desired definitions as fulfilled when assigned, while keeping unassigned concepts easy to find and work through.
- [x] Default the existing-word picker to undefined words, with an option to show all words and their definitions.
- [x] Let requesters edit or confirm deletion of their own unassigned concepts, preserving any associated dictionary word and hearts.
- [x] Suggest each word's most recent Candidate or Defined meaning when it matches any query word beneath an unassigned concept; ignore "to" in queries.
- [x] Offer an inline Select a definition picker and a Write a definition action for undefined dictionary words.

## Cooperative refresh

- [x] Automatically refresh shared dictionary changes while the page is visible and when returning to it, including hearts, definitions, candidates, approvals, and notes. Preserve active editing, cursor position, filters, and scroll position.

Refresh runs every 30 seconds while visible and focused, and on return. Dictionary and generator refresh defer during editing/saving and catch up afterward. The meanings-needed list refreshes too. Sunrise yellow applies to heart icons (not word text) when two or more named users have hearted a word; legacy identities do not count.

### Navigation and snapshot performance

- [x] Remove dictionary relationship panels and their UI import; preserve saved relationships and lazy rename/delete maintenance.
- [x] Index and memoize relationship grouping, endpoint resolution, choices, recipes, adjacency and position counts per snapshot.
- [x] Share a current-tab dictionary snapshot across generator/dictionary navigation, keyed by configuration and username, with 30-second freshness, coalesced complete scans and last-successful fallback.
- [x] Replace per-suggestion hydration scans with spelling-index lookups; restore all suggestions with one scan and update only changed rows.
- [x] Track confirmed writes in the cache, invalidate uncertain/partial mutations, reject read/write races, and clear session snapshots on sign-out.
- [x] Avoid settings startup waits when valid local rules exist; preserve local edits and restrict periodic settings reads to visible/focused pages.
- [x] Add deterministic read-count, navigation, cache-failure, startup and grouping regressions plus opt-in local performance diagnostics.

For diagnostics, set `sessionStorage.setItem('secret.performance.debug', '1')` in the browser console, then reload. Numeric-only measurements appear under “Language performance”; inspect `SECRET_DICTIONARY_CACHE.metrics` for counters and timings. Disable with `sessionStorage.removeItem('secret.performance.debug')`. No word/definition contents or remote telemetry are logged. Synthetic tests demonstrate one grouping for repeated relationship lookups and one cold scan for 50 restored suggestions; real browser/mobile navigation and live AWS latency remain manual checks.

## Language analytics

- [x] Add an authenticated analytics page and floating shortcut, with vowel/consonant charts, category filters, starts/ends views, and accessible count tables.
- [x] Count uniquely tokenized configured symbols, deduplicate saved spellings, and explain excluded words.
- [x] Refresh cooperatively without changing page-local selections; retain successful results when reads fail.

## Generator constraints and normalization

- [x] Rename the collapsed Starts with section to Constraints and support combined, symbol-aligned Starts with and Ends with inputs.
- [x] Add independent start, all-position, and end normalization with per-setting Defined, Candidates, and Undefined populations. Favor underrepresented symbols using separate vowel/consonant count baselines.
- [x] Apply weighted choices only to rule-valid completions; reuse cooperative dictionary refresh, preserve controls, and retain successful counts on read failures.

## Shared flashcards

- [x] Study Defined words and shared sentence/translation cards with shuffled rounds, randomized starting sides, Flip/Next, and page-local deck filters.
- [x] Allow either named user to manage shared sentence cards, with attribution, conditional-write conflict checks, delete confirmation, and retained failed-save drafts.
- [x] Reuse the shared snapshot cache and cooperative refresh; freeze active rounds and preserve editing state.
- [x] Add deterministic deck, service, cached-loading, and UI regressions.
- [ ] Manually verify live AWS persistence and desktop/mobile browser interaction after deployment.

## Deferred

Full undo and revision history are deferred. Separate shared-heart filter work is deferred in favor of the Candidate approval workflow and sunrise-yellow multi-heart styling.
