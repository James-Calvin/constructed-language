const assert = require('node:assert/strict');
const { create } = require('../flashcard-audio.js');
async function run() {
  let requests = 0, plays = 0, pauses = 0, ready = true, pending = null, fail = false;
  const params = [], urls = [], revoked = [];
  const runtime = {
    isPlaybackConfigured: true,
    awsConfig: { region: 'us-east-1', voiceId: 'Joanna', engine: 'neural', outputFormat: 'mp3' },
    ensureAwsCredentials: async () => ready,
    getPollyClient: () => ({ synthesizeSpeech(input) {
      requests++; params.push(input);
      return { promise: async () => {
        if (fail) throw new Error('denied');
        if (pending) return pending;
        return { AudioStream: 'audio' };
      } };
    } })
  };
  const audio = { currentTime: 0, pause() { pauses++; }, async play() { plays++; } };
  const utils = { escapeXml: value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    toAudioBlob: (stream, format) => ({ stream, format }) };
  const player = create({ runtime, audio, utils, url: {
    createObjectURL(blob) { assert.equal(blob.format, 'mp3'); const source = `blob:${urls.length}`; urls.push(source); return source; },
    revokeObjectURL(source) { revoked.push(source); }
  } });
  assert.equal(await player.play('ka<&', 'k"a'), true);
  assert.match(params[0].Text, /ph="k&quot;a">ka&lt;&amp;<\/phoneme>/);
  assert.equal(params[0].VoiceId, 'Joanna'); assert.equal(params[0].TextType, 'ssml');
  assert.equal(await player.play('ka<&', 'k"a'), true);
  assert.equal(requests, 1, 'Repeated playback reuses synthesized audio');
  assert.equal(plays, 2);
  let resolve;
  pending = new Promise(done => { resolve = done; });
  const delayed = player.play('other', 'o');
  await new Promise(done => setImmediate(done));
  player.stop(); resolve({ AudioStream: 'late' });
  assert.equal(await delayed, false, 'Navigating away cancels pending playback');
  assert.equal(plays, 2); assert.equal(urls.length, 1);
  pending = null; fail = true;
  await assert.rejects(player.play('error', 'e'), /denied/);
  fail = false; ready = false;
  await assert.rejects(player.play('not ready', 'n'), /unavailable/);
  ready = true;
  player.dispose();
  assert.deepEqual(revoked, urls, 'Audio URLs are released when leaving the page');
  assert.equal(await player.play('disposed', 'd'), false);
  assert.ok(pauses > 0);
  console.log('Flashcard pronunciation caching, SSML safety, failures and cancellation tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
