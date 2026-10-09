# Cooperative Language Tool Roadmap

This document tracks the agreed feature backlog. Mark an item `[x]` when its behavior is implemented and verified.

## Dictionary search

- [x] Add dictionary search by word spelling and definition, working alongside category filters. IPA search is not needed for this pass.

## Candidates, approval, and shared hearts

- [ ] Add a Candidate section for newly defined words. Preserve all existing defined words in the Defined category when introducing this workflow.
- [ ] Allow a different user to approve a candidate, moving it into Defined. A word's defining user cannot supply its second-person approval.
- [ ] Add an action to return an accepted Defined word to Candidate for reconsideration.
- [ ] Render words hearted by multiple distinct users in sunrise yellow. Keep hearts as personal preferences, with approval as an explicit action.

## Word notes

- [ ] Add optional per-word notes with author and date, hidden in a collapsed area by default.
- [ ] Show a small filled red heart as the unread-notes notification on a word. Track which notes each user has read, and clear the notification when they view those notes.

## Roots and related words

- [ ] Add a simple, optional way to link a word to a root or related word and label the relationship, such as derived form, compound, or variant. Keep this out of the main editing flow unless opened.
- [ ] Make it easy to generate related candidates from a selected root using the existing Starts with feature.

## Review words affected by rule changes

- [ ] When preparing to publish language/generator settings, show all existing words that mismatch the proposed rules, including spelling-rule mismatches and changed or undeterminable IPA mappings. Explain the mismatch for each word.
- [ ] Give every affected word an Update action and a Keep as-is action. Show the proposed update before applying it; when no unique correction can be inferred, allow an explicit spelling/IPA correction rather than guessing.
- [ ] Apply only explicitly selected word updates when the settings change is published. Keep as-is dismisses that word's review message, and any undecided words remain unchanged without blocking publication.

## Dictionary downloads

- [ ] Add a downloadable Markdown dictionary containing accepted Defined words in alphabetical order, with spelling, pronunciation, and definition, formatted like a readable dictionary.
- [ ] Offer optional notes and definition dates in the readable dictionary download.
- [ ] Add CSV export with richer structured data, including spelling, IPA, definition, category, definition author/date, hearts, notes, and root relationships where available.

## Meanings that need words

- [ ] Add a shared list of desired definitions or concepts that do not yet have words, separate from undefined words that already have a spelling.
- [ ] Make it easy to assign an existing word, a generated word, or a manually entered word to a desired definition. A newly defined assignment enters the Candidate approval workflow.
- [ ] Mark desired definitions as fulfilled when assigned, while keeping unassigned concepts easy to find and work through.

## Cooperative refresh

- [ ] Automatically refresh shared dictionary changes while the page is visible and when returning to it, including hearts, definitions, candidates, approvals, and notes. Preserve active editing, cursor position, filters, and scroll position.

## Deferred

Full undo and revision history are deferred. Separate shared-heart filter work is deferred in favor of the Candidate approval workflow and sunrise-yellow multi-heart styling.
