const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('dictionary.html', 'utf8');
const toolbar = html.match(/<div class="dictionary-toolbar-group dictionary-toolbar-group-right">([\s\S]*?)<\/div>/)[1];
assert.match(toolbar, /id="dictionaryAddWordBtn"/);
assert.match(toolbar, /id="dictionaryRetry"/);
assert.ok(toolbar.indexOf('id="dictionaryRetry"') < toolbar.indexOf('id="dictionaryAddWordBtn"'), 'Refresh precedes Add Word in the opposite-aligned action row');
assert.equal((html.match(/id="dictionaryRetry"/g) || []).length, 1);
assert.match(toolbar, /class="dictionary-toggle-btn dictionary-refresh-btn"/);
assert.match(toolbar, /aria-label="Refresh dictionary"/);
assert.match(toolbar, /<svg[^>]*aria-hidden="true"/);
assert.doesNotMatch(html, /Refresh \/ Retry/);
console.log('Dictionary refresh toolbar tests passed.');
