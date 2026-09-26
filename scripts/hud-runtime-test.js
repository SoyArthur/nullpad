'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class ClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach((n) => this.set.add(n)); }
  remove(...names) { names.forEach((n) => this.set.delete(n)); }
  toggle(name, force) {
    const next = force === undefined ? !this.set.has(name) : !!force;
    if (next) this.set.add(name); else this.set.delete(name);
    return next;
  }
  contains(name) { return this.set.has(name); }
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.id = '';
    this.parentNode = null;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.classList = new ClassList();
    this.listeners = new Map();
    this.clientWidth = 0;
    this.clientHeight = 0;
    this._rect = { left: 0, top: 0, width: 50, height: 50 };
    this.textContent = '';
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    for (const match of this._innerHTML.matchAll(/id=\"([^\"]+)\"/g)) {
      const child = new FakeElement('button');
      child.id = match[1];
      this.appendChild(child);
    }
  }
  get innerHTML() { return this._innerHTML || ''; }
  insertBefore(child, before) {
    child.parentNode = this;
    const idx = this.children.indexOf(before);
    this.children.splice(idx < 0 ? this.children.length : idx, 0, child);
    return child;
  }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { ...this._rect }; }
  contains(el) { return el === this || this.children.some((c) => c === el || c.contains(el)); }
  closest(selector) {
    if (selector.includes('[data-btn]') && this.dataset.btn) return this;
    if (selector.includes('[data-stick-click]') && this.dataset.stickClick) return this;
    if (selector.includes('#nullpad-layout-editor') && this.id === 'nullpad-layout-editor') return this;
    if (selector.includes('#nullpad-layout-button') && this.id === 'nullpad-layout-button') return this;
    if (selector.includes('#topbar') && this.id === 'topbar') return this;
    return this.parentNode ? this.parentNode.closest(selector) : null;
  }
  querySelector(selector) {
    if (selector.startsWith('#')) return this.find((el) => el.id === selector.slice(1));
    return null;
  }
  querySelectorAll(selector) {
    const wantBtn = selector.includes('[data-btn]');
    const wantStick = selector.includes('[data-stick-click]');
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if ((wantBtn && child.dataset.btn) || (wantStick && child.dataset.stickClick)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find(predicate);
      if (nested) return nested;
    }
    return null;
  }
}

function createContext() {
  const body = new FakeElement('body');
  const head = new FakeElement('head');
  const topbar = new FakeElement('div'); topbar.id = 'topbar';
  const conn = new FakeElement('div'); conn.id = 'conn-dot';
  topbar.appendChild(conn); body.appendChild(topbar);
  const root = new FakeElement('div'); root.id = 'xbox-wrap'; body.appendChild(root);

  const a = new FakeElement('button'); a.id = 'a'; a.dataset.btn = 'a'; a.textContent = 'A'; a._rect = { left: 80, top: 100, width: 50, height: 50 };
  const b = new FakeElement('button'); b.id = 'b'; b.dataset.btn = 'b'; b.textContent = 'B'; b._rect = { left: 180, top: 100, width: 50, height: 50 };
  root.appendChild(a); root.appendChild(b);

  const document = {
    readyState: 'complete', body, head,
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => body.find((el) => el.id === id),
    querySelector: (selector) => selector === '#topbar' ? topbar : selector === '#xbox-wrap' ? root : body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    addEventListener: () => {},
    documentElement: { clientWidth: 400, clientHeight: 300 },
  };
  const window = {
    location: { pathname: '/xbox.html' },
    innerWidth: 400, innerHeight: 300,
    addEventListener: () => {},
  };
  const storage = { data: new Map(), getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }, setItem(k, v) { this.data.set(k, String(v)); }, removeItem(k) { this.data.delete(k); } };
  return { body, head, topbar, conn, root, a, b, document, window, storage };
}

const c = createContext();
const documentListeners = new Map();
c.document.addEventListener = (type, fn) => documentListeners.set(type, fn);
const MutationObserver = class { observe() {} disconnect() {} };
const context = {
  document: c.document,
  window: c.window,
  localStorage: c.storage,
  MutationObserver,
  HTMLElement: FakeElement,
  console,
  Math,
  Number,
  String,
  Object,
  Array,
  JSON,
  setTimeout,
  clearTimeout,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../client/layout.js'), 'utf8'), context, { filename: 'layout.js' });

const editorButton = c.body.find((el) => el.id === 'nullpad-layout-button');
assert(editorButton?.listeners.get('click'), 'HUD editor button must be wired');
editorButton.listeners.get('click')();
assert.strictEqual(c.body.classList.contains('nullpad-hud-editing'), true);

const pointerdown = documentListeners.get('pointerdown');
const pointermove = documentListeners.get('pointermove');
const pointerup = documentListeners.get('pointerup');
assert(pointerdown && pointermove && pointerup, 'HUD pointer lifecycle must be wired');

const bLeftBefore = c.b.style.left;
pointerdown({ target: c.a, pointerId: 1, clientX: 105, clientY: 125, preventDefault() {}, stopPropagation() {} });
pointermove({ target: c.a, pointerId: 1, clientX: 260, clientY: 190, preventDefault() {}, stopPropagation() {} });
pointerup({ target: c.a, pointerId: 1, clientX: 260, clientY: 190, preventDefault() {}, stopPropagation() {} });
assert.strictEqual(c.b.style.left, bLeftBefore, 'moving A must not move B');
assert.notStrictEqual(c.a.style.left, undefined, 'A must receive a custom X position');

const plus = c.body.find((el) => el.id === 'nullpad-layout-plus');
const scaleBefore = JSON.parse(c.storage.getItem('nullpad.hud.v4.xbox')).controls['id:a'].scale;
plus.listeners.get('click')();
const scaleAfter = JSON.parse(c.storage.getItem('nullpad.hud.v4.xbox')).controls['id:a'].scale;
assert(scaleAfter > scaleBefore, '+ must enlarge the selected control');

pointerdown({ target: c.a, pointerId: 2, clientX: 260, clientY: 190, preventDefault() {}, stopPropagation() {} });
pointerdown({ target: c.a, pointerId: 3, clientX: 290, clientY: 190, preventDefault() {}, stopPropagation() {} });
pointermove({ target: c.a, pointerId: 3, clientX: 340, clientY: 190, preventDefault() {}, stopPropagation() {} });
pointerup({ target: c.a, pointerId: 3, clientX: 340, clientY: 190, preventDefault() {}, stopPropagation() {} });
pointerup({ target: c.a, pointerId: 2, clientX: 260, clientY: 190, preventDefault() {}, stopPropagation() {} });
const scalePinch = JSON.parse(c.storage.getItem('nullpad.hud.v4.xbox')).controls['id:a'].scale;
assert(scalePinch > scaleAfter, 'pinch-out must enlarge the selected control');

console.log('HUD RUNTIME SMOKE TEST: PASS');
