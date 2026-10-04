// Press-and-hold gesture: fires after HOLD_MS if the pointer hasn't moved or lifted, and also
// on the native contextmenu event (right-click, or a touch long-press the browser turns into
// one itself). Suppresses the click that would otherwise follow on an <a> or button.
const HOLD_MS = 480;
const MOVE_TOLERANCE = 10;

/**
 * @param {Element} el
 * @param {(clientX: number, clientY: number, target: EventTarget) => void} onLongPress
 * @returns {() => void} cleanup
 */
export function onLongPress(el, onLongPressFn) {
  let timer = null;
  let start = null;

  const cancel = () => { clearTimeout(timer); timer = null; start = null; };
  const suppressNextClick = () => {
    const block = (e) => { e.preventDefault(); e.stopPropagation(); };
    el.addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', block, { capture: true }), 700);
  };

  const down = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (start) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    timer = setTimeout(() => {
      start = null;
      if (navigator.vibrate) navigator.vibrate(12);
      suppressNextClick();
      onLongPressFn(e.clientX, e.clientY, e.target);
    }, HOLD_MS);
  };
  const move = (e) => {
    if (!start || e.pointerId !== start.id) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE) cancel();
  };
  const up = (e) => { if (start?.id === e.pointerId) cancel(); };
  const onContextMenu = (e) => {
    e.preventDefault();
    cancel();
    onLongPressFn(e.clientX, e.clientY, e.target);
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', onContextMenu);
  return () => {
    cancel();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('contextmenu', onContextMenu);
  };
}
