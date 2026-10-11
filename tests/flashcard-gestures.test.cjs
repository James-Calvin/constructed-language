const assert = require('node:assert/strict');
const { bind } = require('../flashcard-gestures.js');
const listeners = new Map();
let next = 0, back = 0, clock = 1000, captured = 0;
const element = {
  addEventListener(name, handler) { listeners.set(name, handler); },
  removeEventListener(name) { listeners.delete(name); },
  setPointerCapture() { captured++; }
};
const gesture = bind({ element, next: () => next++, back: () => back++, exclude: target => target === 'sound' || target === 'buffer', now: () => clock });
function event(type, values = {}) {
  const e = { pointerId: 1, pointerType: 'touch', isPrimary: true, target: 'face', clientX: 100, clientY: 100, detail: 1,
    prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
  listeners.get(type)?.(e); return e;
}
event('pointerdown'); event('pointermove', { clientX: 20 }); event('pointerup', { clientX: 20 });
assert.equal(next, 1); assert.equal(back, 0); assert.equal(captured, 1);
const click = event('click'); assert.equal(click.prevented, true); assert.equal(click.stopped, true, 'A swipe cannot also flip or play audio');
event('pointerdown'); event('pointerup', { clientX: 180 }); assert.equal(back, 1);
const keyboard = event('click', { detail: 0 }); assert.equal(keyboard.prevented, false, 'Keyboard flipping is never suppressed');
event('pointerdown'); event('pointerup', { clientX: 103 });
assert.equal(event('click').prevented, false, 'Ordinary taps still flip');
for (const target of ['sound', 'buffer']) {
  event('pointerdown', { target }); event('pointermove', { clientX: 10 }); event('pointerup', { clientX: 10 });
}
assert.equal(next, 1); assert.equal(back, 1, 'Sound presses and their no-op buffer do not navigate');
event('pointerdown'); event('pointermove', { clientX: 110, clientY: 200 }); event('pointerup', { clientX: 110, clientY: 200 });
assert.equal(next, 1); assert.equal(back, 1, 'Vertical scrolling does not navigate');
assert.equal(event('click').prevented, true, 'Scrolling cannot accidentally flip');
event('pointerdown'); event('pointerup', { clientX: 145, clientY: 101 });
assert.equal(back, 1, 'A short drag is not a swipe');
event('pointerdown'); event('pointerup', { clientX: 180, clientY: 180 });
assert.equal(back, 1, 'Diagonal scrolling is not a horizontal swipe');
event('pointerdown'); event('pointermove', { clientX: 10 }); event('pointercancel'); event('pointerup', { clientX: 10 });
assert.equal(next, 1, 'Cancelled gestures never navigate');
event('pointerdown'); event('pointerdown', { pointerId: 2, isPrimary: false }); event('pointerup', { clientX: 10 });
assert.equal(next, 1, 'Multi-touch/pinch cancels navigation');
event('pointerdown', { pointerType: 'mouse' }); event('pointerup', { pointerType: 'mouse', clientX: 10 });
assert.equal(next, 1, 'Mouse text selection does not trigger navigation');
event('pointerdown', { pointerType: 'pen' }); event('pointerup', { pointerType: 'pen', clientX: 10 }); assert.equal(next, 2);
clock += 501; assert.equal(event('click').prevented, false, 'Click suppression expires');
gesture.stop(); assert.equal(listeners.size, 0);
console.log('Flashcard swipes, sound exclusion, click suppression and scroll/pinch safety tests passed.');
