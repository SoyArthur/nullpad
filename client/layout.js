/**
 * NULLPAD — free HUD editor v4
 *
 * Every visible controller control can be positioned and scaled independently.
 * Layout is stored as normalized viewport coordinates so it survives viewport
 * size/orientation changes.
 *
 * Editor controls:
 *   - tap control: select
 *   - one-finger / mouse drag: move selected control
 *   - two-finger pinch: resize selected control
 *   - +/-: resize selected control (keyboard)
 *   - arrow keys: nudge selected control on desktop
 *   - Reset: restore the default layout and keep editing
 *   - Classic: remove custom layout and return to the original DOM layout
 */
'use strict';

(() => {
  const pathname = String((typeof window !== 'undefined' && window.location?.pathname) || '').toLowerCase();
  const profile = pathname.includes('dualsense') ? 'dualsense'
    : pathname.includes('joycon') ? 'joycon'
    : pathname.includes('wiimote') ? 'wiimote'
    : 'xbox';

  const ROOT_SELECTORS = {
    xbox: '#xbox-wrap',
    dualsense: '#ds-wrap',
    joycon: '.layout.active',
    wiimote: '#layout-wrap',
  };

  const STORAGE_PREFIX = 'nullpad.hud.v4';
  const MIN_SCALE = 0.40;
  const MAX_SCALE = 3.50;
  const STEP = 0.08;
  const NUDGE_PX = 5;
  const NUDGE_FAST_PX = 16;
  const SAVE_DEBOUNCE_MS = 120;

  let root = null;
  let editor = null;
  let selected = null;
  let editing = false;
  let pointers = new Map();
  let gesture = null;
  let originalInline = new WeakMap();
  let currentState = new Map();
  let saveTimer = null;

  // ── drag state: track whether user is actively dragging ──────────────────────
  let _isDragging = false;

  function isHTMLElement(value) {
    return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
  }

  function modeKey() {
    if (profile !== 'joycon') return profile;
    const active = document.querySelector('.layout.active');
    return active?.id ? `joycon:${active.id.replace(/^layout-/, '')}` : 'joycon:right';
  }

  function storageKey() { return `${STORAGE_PREFIX}.${modeKey()}`; }

  function findRoot() {
    const selector = ROOT_SELECTORS[profile];
    return selector ? document.querySelector(selector) : null;
  }

  function controls() {
    if (!root) return [];
    return [...root.querySelectorAll('[data-btn], [data-stick-click]')]
      .filter(isHTMLElement);
  }

  function controlId(el) {
    if (el.dataset.nullpadHudId) return el.dataset.nullpadHudId;
    if (el.id) {
      el.dataset.nullpadHudId = `id:${el.id}`;
      return el.dataset.nullpadHudId;
    }

    const base = el.dataset.btn ? `button:${el.dataset.btn}` : `stick:${el.dataset.stickClick || 'unknown'}`;
    const siblings = controls().filter((candidate) => {
      const candidateBase = candidate.dataset.btn
        ? `button:${candidate.dataset.btn}`
        : `stick:${candidate.dataset.stickClick || 'unknown'}`;
      return candidateBase === base;
    });
    const index = Math.max(0, siblings.indexOf(el));
    el.dataset.nullpadHudId = `${base}:${index}`;
    return el.dataset.nullpadHudId;
  }

  function labelFor(el) {
    if (!el) return 'Ningún control';
    const text = String(el.dataset.btn || el.dataset.stickClick || el.textContent || '')
      .replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 24) : 'Control';
  }

  function clampScale(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, n));
  }

  function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0.5;
    return Math.max(0, Math.min(1, n));
  }

  function readStored() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !parsed.controls) return null;
      return parsed;
    } catch (error) {
      console.warn('[HUD] Failed to read saved layout:', error);
      return null;
    }
  }

  function writeStored() {
    const payload = { version: 4, controls: {} };
    for (const el of controls()) {
      const state = currentState.get(controlId(el));
      if (!state) continue;
      payload.controls[controlId(el)] = {
        x: clamp01(state.x),
        y: clamp01(state.y),
        scale: clampScale(state.scale),
      };
    }
    try {
      localStorage.setItem(storageKey(), JSON.stringify(payload));
    } catch (error) {
      console.warn('[HUD] Failed to save layout:', error);
    }
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeStored();
    }, SAVE_DEBOUNCE_MS);
  }

  function snapshotOriginal(el) {
    if (originalInline.has(el)) return;
    originalInline.set(el, {
      position: el.style.position,
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      height: el.style.height,
      margin: el.style.margin,
      transform: el.style.transform,
      transformOrigin: el.style.transformOrigin,
      zIndex: el.style.zIndex,
      translate: el.style.translate,
      scale: el.style.scale,
    });
  }

  function restoreOriginal(el) {
    const original = originalInline.get(el);
    if (!original) return;
    el.style.position = original.position;
    el.style.left = original.left;
    el.style.top = original.top;
    el.style.width = original.width;
    el.style.height = original.height;
    el.style.margin = original.margin;
    el.style.transform = original.transform;
    el.style.transformOrigin = original.transformOrigin;
    el.style.zIndex = original.zIndex;
    el.style.translate = original.translate;
    el.style.scale = original.scale;
    delete el.dataset.nullpadHudCustom;
  }

  function currentRectState(el) {
    const rect = el.getBoundingClientRect();
    const width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const height = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    return {
      x: clamp01((rect.left + rect.width / 2) / width),
      y: clamp01((rect.top + rect.height / 2) / height),
      scale: 1,
    };
  }

  function ensureState() {
    currentState = new Map();
    const saved = readStored();
    for (const el of controls()) {
      snapshotOriginal(el);
      const id = controlId(el);
      const restored = saved?.controls?.[id];
      const initial = currentRectState(el);
      currentState.set(id, restored ? {
        x: clamp01(restored.x),
        y: clamp01(restored.y),
        scale: clampScale(restored.scale),
      } : initial);
    }
  }

  function applyElement(el) {
    const state = currentState.get(controlId(el));
    if (!state) return;

    el.style.position = 'fixed';
    el.style.left = `${clamp01(state.x) * 100}%`;
    el.style.top = `${clamp01(state.y) * 100}%`;
    el.style.margin = '0';
    el.style.transformOrigin = 'center center';
    el.style.transform = `translate(-50%, -50%) scale(${clampScale(state.scale)})`;
    el.style.zIndex = '40';
    el.dataset.nullpadHudCustom = '1';
  }

  function applyAll() {
    root = findRoot();
    if (!root) return;
    if (currentState.size === 0) ensureState();
    for (const el of controls()) applyElement(el);
    updateSelectionVisuals();
    updateEditorText();
  }

  function getSelectedState() {
    return selected ? currentState.get(controlId(selected)) || null : null;
  }

  function select(el) {
    if (!el || !root?.contains(el)) return;
    selected = el;
    updateSelectionVisuals();
    updateEditorText();
  }

  function setSelectedScale(next) {
    const state = getSelectedState();
    if (!state) return;
    state.scale = clampScale(next);
    applyElement(selected);
    writeStored();
    updateEditorText();
  }

  function setSelectedPosition(x, y) {
    const state = getSelectedState();
    if (!state) return;
    state.x = clamp01(x);
    state.y = clamp01(y);
    applyElement(selected);
    queueSave();
    updateEditorText();
  }

  function nudgeSelected(dx, dy) {
    const state = getSelectedState();
    if (!state) return;
    const width = Math.max(1, window.innerWidth || 1);
    const height = Math.max(1, window.innerHeight || 1);
    setSelectedPosition(state.x + dx / width, state.y + dy / height);
  }

  function controlCenter(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // ── editor panel visibility during drag ──────────────────────────────────────
  function setEditorVisible(visible) {
    if (!editor) return;
    editor.style.opacity = visible ? '' : '0';
    editor.style.pointerEvents = visible ? '' : 'none';
  }

  function beginPointer(event) {
    if (!editing) return;
    const target = event.target;
    if (!isHTMLElement(target)) return;
    if (target.closest('#nullpad-layout-editor, #nullpad-layout-button, #topbar')) return;

    const el = target.closest('[data-btn], [data-stick-click]');
    if (!isHTMLElement(el) || !root?.contains(el)) return;

    event.preventDefault();
    event.stopPropagation();
    select(el);

    const point = { id: event.pointerId, x: event.clientX, y: event.clientY, control: el };
    pointers.set(event.pointerId, point);
    try { el.setPointerCapture(event.pointerId); } catch (_) {}

    if (pointers.size === 1) {
      const center = controlCenter(el);
      gesture = {
        control: el,
        mode: 'drag',
        offsetX: center.x - event.clientX,
        offsetY: center.y - event.clientY,
        startX: event.clientX,
        startY: event.clientY,
      };
    } else {
      const pair = [...pointers.values()].filter((p) => p.control === el);
      if (pair.length >= 2) {
        const a = pair[0];
        const b = pair[1];
        const state = getSelectedState();
        if (state) {
          gesture = {
            control: el,
            mode: 'pinch',
            startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
            startScale: state.scale,
          };
        }
      }
    }

    // Hide editor panel while dragging so it doesn't interfere visually
    _isDragging = true;
    setEditorVisible(false);

    updateEditorText();
  }

  function movePointer(event) {
    if (!editing) return;
    const point = pointers.get(event.pointerId);
    if (!point || point.control !== selected || !gesture || gesture.control !== selected) return;

    point.x = event.clientX;
    point.y = event.clientY;
    pointers.set(event.pointerId, point);

    const state = getSelectedState();
    if (!state) return;

    const pair = [...pointers.values()].filter((p) => p.control === selected);
    if (gesture.mode === 'pinch' && pair.length >= 2) {
      event.preventDefault();
      event.stopPropagation();
      const a = pair[0];
      const b = pair[1];
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      setSelectedScale(gesture.startScale * (distance / gesture.startDistance));
      return;
    }

    if (gesture.mode === 'drag' && pair.length === 1) {
      event.preventDefault();
      event.stopPropagation();
      const width = Math.max(1, window.innerWidth || 1);
      const height = Math.max(1, window.innerHeight || 1);
      setSelectedPosition(
        (event.clientX + gesture.offsetX) / width,
        (event.clientY + gesture.offsetY) / height,
      );
    }
  }

  function endPointer(event) {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    pointers.delete(event.pointerId);
    try { point.control.releasePointerCapture(event.pointerId); } catch (_) {}

    if (pointers.size === 0) {
      gesture = null;
      // Restore editor panel when all fingers lift
      if (_isDragging) {
        _isDragging = false;
        setEditorVisible(true);
      }
    } else if (gesture?.mode === 'pinch') {
      gesture = null;
    }
    writeStored();
  }

  function updateSelectionVisuals() {
    for (const el of controls()) {
      el.classList.toggle('nullpad-hud-selected', editing && el === selected);
    }
  }

  function updateEditorText() {
    if (!editor) return;
    const label = editor.querySelector('#nullpad-layout-selected');
    const scale = editor.querySelector('#nullpad-layout-scale');
    const pos = editor.querySelector('#nullpad-layout-pos');
    const state = getSelectedState();
    if (label) label.textContent = selected ? labelFor(selected).toUpperCase() : '— tap a control —';
    if (scale) scale.textContent = state ? `${Math.round(state.scale * 100)}%` : '—';
    if (pos) pos.textContent = state ? `${Math.round(state.x * 100)}·${Math.round(state.y * 100)}` : '—';
  }

  function addStyle() {
    if (document.getElementById('nullpad-hud-style')) return;
    const style = document.createElement('style');
    style.id = 'nullpad-hud-style';
    style.textContent = `
      /* ── Topbar: adaptive height, no fixed 44px ─────────────────────────── */
      #topbar {
        height: clamp(36px, 5.5dvh, 52px) !important;
        padding: 0 clamp(10px, 3vw, 20px) !important;
      }
      #topbar a { font-size: clamp(11px, 2.5vw, 14px) !important; }
      .title    { font-size: clamp(12px, 2.8vw, 15px) !important; }

      /* ── Controller wrapper: no forced margin-top, adapts to topbar ─────── */
      #xbox-wrap, #ds-wrap, #layout-wrap {
        margin-top: clamp(40px, 6dvh, 56px) !important;
        /* Remove decorative shape — clean HUD canvas */
        border-radius: 12px !important;
        box-shadow: none !important;
        background: transparent !important;
        padding: 8px !important;
      }

      /* ── Editing mode ────────────────────────────────────────────────────── */
      body.nullpad-hud-editing [data-btn],
      body.nullpad-hud-editing [data-stick-click],
      body.nullpad-hud-editing [data-nullpad-hud-custom="1"] {
        touch-action: none !important;
      }
      body.nullpad-hud-editing [data-nullpad-hud-custom="1"] {
        outline: 1px dashed rgba(168,85,247,.45);
        outline-offset: 4px;
      }
      body.nullpad-hud-editing .nullpad-hud-selected {
        outline: 2px solid rgba(192,132,252,.95) !important;
        outline-offset: 6px !important;
        filter: brightness(1.15) !important;
      }
      body.nullpad-hud-editing [data-nullpad-hud-custom="1"].pressed {
        filter: brightness(1.35) !important;
      }

      /* ── Edit-mode toggle button in topbar ───────────────────────────────── */
      #nullpad-layout-button {
        width: clamp(28px, 6vw, 36px);
        height: clamp(24px, 4.5dvh, 32px);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 7px;
        background: rgba(255,255,255,.05);
        color: inherit;
        font: inherit;
        font-size: clamp(13px, 2.8vw, 16px);
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        -webkit-tap-highlight-color: transparent;
        flex-shrink: 0;
      }
      #nullpad-layout-button.active { background: rgba(124,58,237,.28); border-color: rgba(124,58,237,.5); }

      /* ── HUD editor pill — ghost/passthrough when idle ───────────────────── */
      #nullpad-layout-editor {
        position: fixed;
        left: 50%;
        bottom: clamp(8px, 2dvh, 16px);
        transform: translateX(-50%);
        z-index: 1000;
        /* Compact single-row pill */
        width: max-content;
        max-width: min(96vw, 420px);
        padding: clamp(6px, 1.5dvh, 10px) clamp(8px, 2vw, 14px);
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 40px;
        background: rgba(8,8,14,.82);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        color: #e2e8f0;
        user-select: none; -webkit-user-select: none;
        touch-action: none;
        transition: opacity 0.18s;
        /* Passthrough: clicks fall through to buttons below */
        pointer-events: none;
      }
      /* Re-enable pointer events only on the interactive children */
      #nullpad-layout-editor .np-hud-interactive {
        pointer-events: auto;
      }
      #nullpad-layout-editor[hidden] { display: none; }

      /* Single row layout */
      .np-hud-row {
        display: flex;
        align-items: center;
        gap: clamp(4px, 1.2vw, 8px);
        flex-wrap: nowrap;
      }
      /* Selected label + scale inline */
      .np-hud-chip {
        font-size: clamp(9px, 2vw, 11px);
        font-weight: 700;
        letter-spacing: .05em;
        color: #c4b5fd;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: clamp(60px, 20vw, 110px);
        flex-shrink: 1;
      }
      #nullpad-layout-scale {
        font-size: clamp(9px, 2vw, 11px);
        font-weight: 800;
        color: #94a3b8;
        min-width: 34px;
        text-align: center;
        flex-shrink: 0;
      }
      /* Action buttons */
      .np-hud-btn {
        height: clamp(28px, 5dvh, 36px);
        min-width: clamp(28px, 5dvh, 36px);
        border: 1px solid rgba(255,255,255,.11);
        border-radius: 20px;
        background: rgba(255,255,255,.07);
        color: #fff;
        font: inherit;
        font-size: clamp(11px, 2.4vw, 14px);
        font-weight: 700;
        cursor: pointer;
        flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        padding: 0 clamp(6px, 1.5vw, 10px);
        -webkit-tap-highlight-color: transparent;
      }
      .np-hud-btn:active { transform: scale(.93); }
      #nullpad-layout-reset  { font-size: clamp(9px, 2vw, 11px); }
      #nullpad-layout-classic { font-size: clamp(9px, 2vw, 11px); color: #fca5a5; }
      #nullpad-layout-done   { font-size: clamp(9px, 2vw, 11px); background: rgba(124,58,237,.22); border-color: rgba(124,58,237,.4); }

      /* ── Press feedback: non-face buttons ────────────────────────────────── */
      .bumper-btn.pressed, .bump-btn.pressed {
        transform: scale(0.93) !important;
        filter: brightness(1.8);
      }
      .trigger-btn.pressed, .trig-btn.pressed {
        transform: scaleY(0.93) !important;
        filter: brightness(2);
      }
      .dpad-btn.pressed, .dp.pressed {
        transform: scale(0.93) !important;
        filter: brightness(2);
      }
      .sys-btn.pressed, .menu-btn.pressed {
        transform: scale(0.93) !important;
        filter: brightness(2);
      }
      .jc-btn.pressed {
        transform: translateY(2px) scale(0.95) !important;
      }
      .dpad-btn.pressed, .sys-btn.pressed, .a-btn.pressed, .b-btn.pressed, .num-btn.pressed {
        transform: scale(0.93) translateY(2px) !important;
      }

      /* ── NULLPAD identity: 2D pixel-style sprites ────────────────────────── */
      /* Face buttons: crisp pixel-border look */
      .face-btn, #fa, #fb, #fx, #fy,
      #btn-cross, #btn-circle, #btn-square, #btn-triangle {
        image-rendering: pixelated;
        font-family: 'SF Mono', 'Consolas', monospace !important;
        font-size: clamp(9px, 2vw, 13px) !important;
        font-weight: 900 !important;
        letter-spacing: 0 !important;
        border: 2px solid rgba(0,0,0,0.55) !important;
        box-shadow: inset 0 -3px 0 rgba(0,0,0,0.4), 0 2px 0 rgba(0,0,0,0.5) !important;
      }
      /* Dpad: pixel arrow style */
      .dp:not(.center), .dpad-btn:not(.center) {
        font-family: monospace !important;
        font-size: clamp(8px, 1.8vw, 11px) !important;
        font-weight: 900 !important;
        border-radius: 3px !important;
        border: 1px solid rgba(255,255,255,.08) !important;
      }
      /* Sticks: 2D concentric ring look */
      .stick-zone {
        border: 2px solid rgba(255,255,255,.12) !important;
        box-shadow: inset 0 0 0 4px rgba(0,0,0,.35), inset 0 0 0 8px rgba(255,255,255,.04) !important;
      }
      .stick-knob {
        box-shadow: inset 0 -2px 0 rgba(0,0,0,0.5), 0 1px 3px rgba(0,0,0,.7) !important;
      }
      /* Triggers: pixel ramp */
      .trig-btn, .trigger-btn {
        border-radius: 3px 3px 0 0 !important;
        border-top: 2px solid rgba(255,255,255,.10) !important;
      }
      /* Bumpers: label uppercase mono */
      .bump-btn, .bumper-btn {
        font-family: 'SF Mono', 'Consolas', monospace !important;
        font-size: clamp(8px, 1.8vw, 11px) !important;
        font-weight: 900 !important;
        letter-spacing: .06em !important;
        border-radius: 4px !important;
        border: 1px solid rgba(255,255,255,.10) !important;
      }

      /* ── NULLPAD wordmark glow in topbar ─────────────────────────────────── */
      .title {
        font-family: 'SF Mono', 'Consolas', monospace !important;
        font-weight: 900 !important;
        letter-spacing: .08em !important;
        text-shadow: 0 0 8px rgba(124,58,237,.6) !important;
      }

      /* ── Button size adaptive: scale with viewport ───────────────────────── */
      .face-btn, #fa, #fb, #fx, #fy,
      #btn-cross, #btn-circle, #btn-square, #btn-triangle {
        width:  clamp(28px, 7vw, 42px) !important;
        height: clamp(28px, 7vw, 42px) !important;
      }
      .stick-zone {
        width:  clamp(60px, 16vw, 84px) !important;
        height: clamp(60px, 16vw, 84px) !important;
      }
      .stick-knob {
        width:  clamp(28px, 7.5vw, 40px) !important;
        height: clamp(28px, 7.5vw, 40px) !important;
      }
      .bump-btn, .bumper-btn {
        height: clamp(36px, 7dvh, 48px) !important;
      }

      /* ── Feedback display ────────────────────────────────────────────────── */
      #np-btn-feedback {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 28px;
        font-weight: 900;
        letter-spacing: 0.05em;
        color: rgba(255,255,255,0.90);
        text-shadow: 0 2px 12px rgba(0,0,0,0.6);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s;
        z-index: 200;
        white-space: nowrap;
      }
      #np-btn-feedback.np-fb-visible {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  function addEditor() {
    const topbar = document.getElementById('topbar');
    if (!topbar) return;

    const button = document.createElement('button');
    button.id = 'nullpad-layout-button';
    button.type = 'button';
    button.title = 'Edit HUD';
    button.textContent = '✥';

    const conn = document.getElementById('conn-dot');
    if (conn?.parentNode) {
      const group = document.createElement('div');
      group.style.cssText = 'display:flex;align-items:center;gap:clamp(4px,1.5vw,8px);flex-shrink:0;';
      conn.parentNode.insertBefore(group, conn);
      group.appendChild(button);
      group.appendChild(conn);
    } else {
      topbar.appendChild(button);
    }

    // ── Single-row pill editor — passthrough by default ──────────────────────
    editor = document.createElement('div');
    editor.id = 'nullpad-layout-editor';
    editor.hidden = true;
    // All children that need interaction get class np-hud-interactive
    editor.innerHTML = `
      <div class="np-hud-row np-hud-interactive">
        <div id="nullpad-layout-selected" class="np-hud-chip">— tap a control —</div>
        <div id="nullpad-layout-scale" style="pointer-events:none;">—</div>
        <button id="nullpad-layout-minus" class="np-hud-btn" type="button" aria-label="Shrink">−</button>
        <button id="nullpad-layout-plus"  class="np-hud-btn" type="button" aria-label="Grow">+</button>
        <button id="nullpad-layout-reset"   class="np-hud-btn" type="button">RST</button>
        <button id="nullpad-layout-classic" class="np-hud-btn" type="button">CLR</button>
        <button id="nullpad-layout-done"    class="np-hud-btn" type="button">OK</button>
      </div>
    `;
    document.body.appendChild(editor);

    // ── Feedback element ─────────────────────────────────────────────────────
    const feedbackEl = document.createElement('div');
    feedbackEl.id = 'np-btn-feedback';
    document.body.appendChild(feedbackEl);
    if (typeof NullInput !== 'undefined') {
      NullInput.setFeedbackTarget(feedbackEl);
    } else {
      window.addEventListener('load', () => {
        if (typeof NullInput !== 'undefined') NullInput.setFeedbackTarget(feedbackEl);
      });
    }

    button.addEventListener('click', () => {
      editing = !editing;
      pointers.clear();
      gesture = null;
      selected = null;
      _isDragging = false;
      document.body.classList.toggle('nullpad-hud-editing', editing);
      button.classList.toggle('active', editing);
      editor.hidden = !editing;
      setEditorVisible(true);
      root = findRoot();
      if (editing) {
        ensureState();
        applyAll();
      }
      updateSelectionVisuals();
      updateEditorText();
    });

    editor.querySelector('#nullpad-layout-minus').addEventListener('click', () => {
      const state = getSelectedState();
      if (state) setSelectedScale(state.scale - STEP);
    });
    editor.querySelector('#nullpad-layout-plus').addEventListener('click', () => {
      const state = getSelectedState();
      if (state) setSelectedScale(state.scale + STEP);
    });
    editor.querySelector('#nullpad-layout-reset').addEventListener('click', () => {
      try { localStorage.removeItem(storageKey()); } catch (_) {}
      for (const el of controls()) restoreOriginal(el);
      currentState.clear();
      ensureState();
      for (const el of controls()) applyElement(el);
      selected = null;
      writeStored();
      updateSelectionVisuals();
      updateEditorText();
    });
    editor.querySelector('#nullpad-layout-classic').addEventListener('click', () => {
      try { localStorage.removeItem(storageKey()); } catch (_) {}
      editing = false;
      pointers.clear();
      gesture = null;
      selected = null;
      _isDragging = false;
      document.body.classList.remove('nullpad-hud-editing');
      for (const el of controls()) restoreOriginal(el);
      currentState.clear();
      button.classList.remove('active');
      editor.hidden = true;
      updateSelectionVisuals();
      updateEditorText();
    });
    editor.querySelector('#nullpad-layout-done').addEventListener('click', () => {
      editing = false;
      pointers.clear();
      gesture = null;
      selected = null;
      _isDragging = false;
      clearTimeout(saveTimer);
      saveTimer = null;
      writeStored();
      document.body.classList.remove('nullpad-hud-editing');
      button.classList.remove('active');
      editor.hidden = true;
      updateSelectionVisuals();
      updateEditorText();
    });
  }

  function bindPointerEditor() {
    document.addEventListener('pointerdown', beginPointer, true);
    document.addEventListener('pointermove', movePointer, true);
    document.addEventListener('pointerup', endPointer, true);
    document.addEventListener('pointercancel', endPointer, true);
  }

  function bindKeyboard() {
    document.addEventListener('keydown', (event) => {
      if (!editing || !selected) return;
      const step = event.shiftKey ? NUDGE_FAST_PX : NUDGE_PX;
      switch (event.key) {
        case 'ArrowLeft': nudgeSelected(-step, 0); break;
        case 'ArrowRight': nudgeSelected(step, 0); break;
        case 'ArrowUp': nudgeSelected(0, -step); break;
        case 'ArrowDown': nudgeSelected(0, step); break;
        case '+':
        case '=': setSelectedScale((getSelectedState()?.scale || 1) + STEP); break;
        case '-':
        case '_': setSelectedScale((getSelectedState()?.scale || 1) - STEP); break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
    }, true);
  }

  function applySavedLayoutWhenPresent() {
    root = findRoot();
    if (!root || !readStored()) return;
    ensureState();
    for (const el of controls()) applyElement(el);
  }

  function refresh() {
    root = findRoot();
    currentState.clear();
    selected = null;
    if (editing) {
      ensureState();
      applyAll();
    } else {
      applySavedLayoutWhenPresent();
    }
  }

  function observeJoycon() {
    if (profile !== 'joycon' || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver((mutations) => {
      const modeChanged = mutations.some((mutation) => {
        const target = mutation.target;
        return isHTMLElement(target) && target.classList.contains('layout');
      });
      if (modeChanged) refresh();
    });
    document.querySelectorAll('.layout').forEach((layout) => {
      observer.observe(layout, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function init() {
    addStyle();
    addEditor();
    bindPointerEditor();
    bindKeyboard();
    refresh();
    observeJoycon();

    window.addEventListener('resize', () => {
      root = findRoot();
      if (!root) return;
      if (editing) {
        const savedSelection = selected;
        currentState.clear();
        ensureState();
        for (const el of controls()) applyElement(el);
        selected = savedSelection && root.contains(savedSelection) ? savedSelection : null;
      } else {
        applySavedLayoutWhenPresent();
      }
      updateSelectionVisuals();
      updateEditorText();
    });
  }

  window.NullLayout = {
    isEditing: () => editing,
    refresh,
    reset: () => {
      try { localStorage.removeItem(storageKey()); } catch (_) {}
      refresh();
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
