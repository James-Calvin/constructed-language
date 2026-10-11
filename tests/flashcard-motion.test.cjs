const assert = require('node:assert/strict');
const { create } = require('../flashcard-motion.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function run() {
  const animations = [];
  let reduced = false, flips = 0, next = 0;
  const element = { animate(frames, options) {
    let resolve, reject;
    const animation = { frames, options, cancelled: false,
      finished: new Promise((done, fail) => { resolve = done; reject = fail; }),
      finish() { resolve(); }, cancel() { this.cancelled = true; reject(new Error('cancelled')); }
    };
    animations.push(animation); return animation;
  } };
  const motion = create({ element, reducedMotion: () => reduced });
  const flip = motion.flip(() => flips++);
  assert.equal(flips, 0, 'Old side remains visible during the first half');
  assert.match(animations[0].frames[1].transform, /rotateY\(90deg\)/);
  await motion.flip(() => flips++);
  assert.equal(animations.length, 1, 'Repeated taps cannot queue extra flips');
  animations[0].finish(); await flush();
  assert.equal(flips, 1, 'Content switches at the edge-on midpoint');
  assert.match(animations[1].frames[0].transform, /rotateY\(-90deg\)/);
  assert.equal(animations[0].cancelled, true);
  animations[1].finish(); await flip;
  assert.equal(animations[1].cancelled, true, 'Completed effects leave no transforms behind');
  const interrupted = motion.flip(() => flips++);
  motion.slide(() => next++);
  assert.equal(next, 1, 'Next changes the card before its entrance animation');
  assert.equal(animations[2].cancelled, true);
  assert.match(animations[3].frames[0].transform, /translateX/);
  assert.equal(animations[3].frames[0].opacity, 0);
  assert.equal(animations[3].frames[1].opacity, 1);
  await interrupted;
  assert.equal(flips, 1, 'A cancelled flip cannot change the incoming card');
  motion.cancel(); await flush();
  assert.equal(animations[3].cancelled, true, 'Shuffle/navigation cancels the entrance effect');
  const midFlip = motion.flip(() => flips++);
  animations[4].finish(); await flush();
  assert.equal(flips, 2);
  motion.slide(() => next++, -1); await midFlip;
  assert.equal(animations[6].frames[0].transform, 'translateX(-24px)', 'Back enters from the opposite direction');
  animations[6].finish(); await flush();
  assert.equal(next, 2); assert.equal(flips, 2);
  reduced = true;
  const before = animations.length;
  await motion.flip(() => flips++); motion.slide(() => next++);
  assert.equal(animations.length, before, 'Reduced motion bypasses all animation');
  assert.equal(flips, 3); assert.equal(next, 3);
  const fallback = create({ element: {}, reducedMotion: () => false });
  await fallback.flip(() => flips++); fallback.slide(() => next++);
  assert.equal(flips, 4); assert.equal(next, 4, 'Older browsers keep fully functional controls');
  console.log('Flashcard flip timing, slide cues, cancellation and reduced-motion tests passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
