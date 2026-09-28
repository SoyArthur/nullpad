/**
 * NULLPAD — unified pointer input bindings
 * Uses Pointer Events for touch, mouse and pen so every control follows the
 * same press/release/cancel lifecycle without duplicate touch+mouse events.
 *
 * v2 additions:
 *  - Haptic feedback on every press (navigator.vibrate)
 *  - Button display overlay API (NullInput.setFeedbackTarget)
 *  - Audio feedback (AudioContext click on press)
 *  - Rapid fire / turbo (data-turbo="<hz>" on any [data-btn] element)
 */
'use strict';

const NullInput = (() => {
  // ── Feedback target ───────────────────────────────────────────────────────
  let _feedbackEl = null;
  let _feedbackTimer = null;

  function setFeedbackTarget(el) {
    _feedbackEl = el || null;
  }

  function _showFeedback(label) {
    if (!_feedbackEl) return;
    _feedbackEl.textContent = label;
    _feedbackEl.classList.add('np-fb-visible');
    clearTimeout(_feedbackTimer);
    _feedbackTimer = setTimeout(() => {
      if (_feedbackEl) _feedbackEl.classList.remove('np-fb-visible');
    }, 600);
  }

  // ── Haptics ───────────────────────────────────────────────────────────────
  function _vibrate() {
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (_) {}
  }

  // ── Audio feedback ────────────────────────────────────────────────────────
  // Lazy-init AudioContext on first press (browser autoplay policy).
  let _audioCtx = null;
  let _audioEnabled = true;

  function _playClick() {
    if (!_audioEnabled) return;
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === 'suspended') _audioCtx.resume();
      const osc = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.connect(gain);
      gain.connect(_audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, _audioCtx.currentTime);
      gain.gain.setValueAtTime(0.12, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + 0.055);
      osc.start(_audioCtx.currentTime);
      osc.stop(_audioCtx.currentTime + 0.055);
    } catch (_) {}
  }

  function setAudioEnabled(enabled) {
    _audioEnabled = !!enabled;
  }

  // ── Button helpers ────────────────────────────────────────────────────────
  function setPressed(el, state, key, value, onChange) {
    state[key] = value;
    el.classList.add('pressed');
    onChange();
    _vibrate();
    _playClick();
    _showFeedback(el.dataset.feedbackLabel || el.dataset.btn || el.textContent?.trim() || key);
  }

  function setReleased(el, state, key, value, onChange) {
    state[key] = value;
    el.classList.remove('pressed');
    onChange();
  }

  // ── Rapid fire / turbo ────────────────────────────────────────────────────
  // Add data-turbo="<hz>" to any [data-btn] element to enable turbo mode.
  // While held, the button fires at that frequency (clamped 1–30 Hz).
  // The turbo interval is created on press and cleared on release.
  const _turboTimers = new Map();

  function _startTurbo(el, state, key, analogKeys, onChange, hz) {
    _stopTurbo(key);
    const intervalMs = Math.round(1000 / Math.max(1, Math.min(30, hz)));
    const isAnalog = analogKeys.has(key);
    const timer = setInterval(() => {
      // Toggle pressed state to simulate button pulses
      const next = !state[key];
      state[key] = isAnalog ? (next ? 1 : 0) : next;
      el.classList.toggle('pressed', !!state[key]);
      onChange();
    }, intervalMs);
    _turboTimers.set(key, timer);
  }

  function _stopTurbo(key) {
    const t = _turboTimers.get(key);
    if (t != null) { clearInterval(t); _turboTimers.delete(key); }
  }

  // ── bindButtons ──────────────────────────────────────────────────────────
  function bindButtons(state, onChange, options = {}) {
    const selector = options.selector || '[data-btn]';
    const analogKeys = new Set(options.analogKeys || []);

    document.querySelectorAll(selector).forEach((el) => {
      const key = el.dataset.btn;
      if (!key) return;

      const turboHz = el.dataset.turbo ? parseFloat(el.dataset.turbo) : 0;
      let activePointerId = null;

      const press = (event) => {
        if (typeof window !== 'undefined' && window.NullLayout?.isEditing?.()) return;
        if (activePointerId !== null) return;
        activePointerId = event.pointerId;
        try { el.setPointerCapture(event.pointerId); } catch (_) {}
        setPressed(el, state, key, analogKeys.has(key) ? 1 : true, onChange);
        if (turboHz > 0) _startTurbo(el, state, key, analogKeys, onChange, turboHz);
      };

      const release = (event) => {
        if (activePointerId !== null && event.pointerId !== activePointerId) return;
        activePointerId = null;
        if (turboHz > 0) _stopTurbo(key);
        setReleased(el, state, key, analogKeys.has(key) ? 0 : false, onChange);
      };

      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
      el.addEventListener('contextmenu', (event) => event.preventDefault());
    });
  }

  // ── bindStick ─────────────────────────────────────────────────────────────
  function bindStick(zone, knob, state, xKey, yKey, onChange, options = {}) {
    if (!zone || !knob) return;

    const clickKey = options.clickKey || null;
    const clickRegion = Number(options.clickRegion ?? 0.34);
    const clickCancelDistance = Number(options.clickCancelDistance ?? 0.16);

    let activePointerId = null;
    let clickCandidate = false;
    let startX = 0;
    let startY = 0;

    function setStickClick(value) {
      if (!clickKey) return;
      state[clickKey] = !!value;
      zone.classList.toggle('click-active', !!value);
      if (value) {
        _vibrate();
        _playClick();
        _showFeedback(clickKey.toUpperCase());
      }
      onChange();
    }

    function setNeutral() {
      state[xKey] = 0;
      state[yKey] = 0;
      knob.style.transform = 'translate(-50%, -50%)';
      onChange();
    }

    function updateFromEvent(event) {
      const rect = zone.getBoundingClientRect();
      const radius = Math.max(1, (Math.min(rect.width, rect.height) - knob.offsetWidth) / 2);
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const distance = Math.min(Math.hypot(dx, dy), radius);
      const angle = Math.atan2(dy, dx);
      const x = (distance / radius) * Math.cos(angle);
      const y = (distance / radius) * Math.sin(angle);

      state[xKey] = Number(x.toFixed(3));
      state[yKey] = Number(y.toFixed(3));
      knob.style.transform = `translate(calc(-50% + ${state[xKey] * radius}px), calc(-50% + ${state[yKey] * radius}px))`;
      onChange();
    }

    const press = (event) => {
      if (typeof window !== 'undefined' && window.NullLayout?.isEditing?.()) return;
      if (activePointerId !== null) return;
      activePointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      try { zone.setPointerCapture(event.pointerId); } catch (_) {}

      const rect = zone.getBoundingClientRect();
      const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
      const centerDistance = Math.hypot(
        event.clientX - (rect.left + rect.width / 2),
        event.clientY - (rect.top + rect.height / 2)
      );
      clickCandidate = !!clickKey && centerDistance <= radius * clickRegion;
      if (clickCandidate) setStickClick(true);
      updateFromEvent(event);
    };

    const move = (event) => {
      if (event.pointerId !== activePointerId) return;
      if (clickCandidate) {
        const rect = zone.getBoundingClientRect();
        const radius = Math.max(1, Math.min(rect.width, rect.height) / 2);
        const moved = Math.hypot(event.clientX - startX, event.clientY - startY);
        if (moved > radius * clickCancelDistance) {
          clickCandidate = false;
          setStickClick(false);
        }
      }
      updateFromEvent(event);
    };

    const release = (event) => {
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      activePointerId = null;
      clickCandidate = false;
      setStickClick(false);
      setNeutral();
    };

    zone.addEventListener('pointerdown', press);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
    zone.addEventListener('lostpointercapture', release);
    zone.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  return { bindButtons, bindStick, setFeedbackTarget, setAudioEnabled };
})();
