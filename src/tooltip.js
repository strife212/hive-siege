// Hover tooltips in the house style, in place of the browser's own `title` ones. tip(el, content) gives an element
// one: content is plain text, or a function returning HTML that is read again four times a second while the tip is
// up (so a cooldown in it counts down). Elements in the page with a data-tip attribute get theirs at load. The tip
// sits above its element (below it when there is no room), kept on screen, with a pointer at the element. Mouse only.
const DELAY = 350, CHAIN = 400;                // ms before a tip shows; moving straight on to the next one skips the wait
const GAP = 10, MARGIN = 8;                    // px between the tip and its element, and kept clear of the screen edge

let root = null, box = null, arrow = null;
let anchor = null, content = null, html = '', timer = 0, poll = 0, lastHide = -1e9;

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function build() {
  root = document.createElement('div');
  root.id = 'tip';
  root.innerHTML = '<div class="box"></div><div class="arrow"></div>';
  box = root.firstChild;
  arrow = root.lastChild;
  document.body.appendChild(root);
}

function render() {
  if (!anchor?.isConnected || !anchor.getClientRects().length) return hide();   // its element went away or was hidden
  const next = typeof content === 'function' ? content() : esc(content);
  if (next !== html) { html = next; box.innerHTML = html; }
  const r = anchor.getBoundingClientRect(), w = root.offsetWidth, h = root.offsetHeight, mid = r.left + r.width / 2;
  const below = r.top - GAP - h < MARGIN;
  const x = Math.min(Math.max(mid - w / 2, MARGIN), innerWidth - w - MARGIN);
  root.style.left = `${x}px`;
  root.style.top = `${below ? r.bottom + GAP : r.top - GAP - h}px`;
  root.classList.toggle('below', below);
  arrow.style.left = `${Math.min(Math.max(mid - x, 14), w - 14)}px`;
}

function show(el, c) {
  if (!root) build();
  anchor = el;
  content = c;
  html = '';
  root.classList.toggle('rich', typeof c === 'function');
  render();
  if (!anchor) return;
  root.classList.add('on');
  clearInterval(poll);
  poll = setInterval(render, 250);
}

function hide() {
  clearTimeout(timer);
  clearInterval(poll);
  timer = 0;
  if (anchor && root?.classList.contains('on')) lastHide = performance.now();
  anchor = null;
  root?.classList.remove('on');
}

export function tip(el, c) {
  el.removeAttribute('title');
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(timer);
    timer = setTimeout(() => show(el, c), performance.now() - lastHide < CHAIN ? 0 : DELAY);
  });
  el.addEventListener('pointerleave', hide);
  el.addEventListener('pointerdown', hide);
}

addEventListener('blur', hide);
for (const el of document.querySelectorAll('[data-tip]')) tip(el, el.dataset.tip);
