/**
 * NULLPAD — mobile motion / haptics manager
 *
 * Motion channels:
 *   - DeviceMotion acceleration -> DSU accelerometer
 *   - DeviceMotion rotationRate -> DSU gyroscope + optional gyro-mouse
 *   - DeviceOrientation tilt -> optional right-stick pointer proxy
 *   - shake -> configurable XInput action
 *
 * The phone does not expose the Wii Remote's physical IR camera. Therefore the
 * "IR pointer" in this web client is intentionally a tilt/orientation proxy,
 * while real 3-axis motion is carried separately through DSU.
 */
'use strict';

const NullSensors = (() => {
  const STORAGE_KEY = 'nullpad.motion.v2';
  const DEFAULTS = Object.freeze({
    motionEnabled: true,
    tiltPointerEnabled: true,
    tiltSensitivity: 1,
    shakeEnabled: true,
    shakeAction: 'lb',
    gyroMouseEnabled: false,
    gyroMouseSensitivity: 1.0,
  });
  const IR_BETA_RANGE = [-45, 45];
  const IR_GAMMA_RANGE = [-45, 45];
  const DEADZONE = 0.04;
  const SMOOTHING = 0.15;
  const SHAKE_THRESHOLD = 18;
  const SHAKE_COOLDOWN = 350;
  const G = 9.80665;
  const SHAKE_ACTIONS = new Set(['none', 'lb', 'rb', 'a', 'b', 'x', 'y', 'l3', 'r3']);

  let config = loadConfig();
  let irX = 0;
  let irY = 0;
  let shakeDetected = false;
  let lastShakeTime = 0;
  let orientationGranted = false;
  let motionGranted = false;
  let listenersAttached = false;
  let initialized = false;
  let calibration = { alpha: 0, beta: 0, gamma: 0 };
  let calibrationSamples = [];
  let calibrationActive = false;
  let calibrationTimer = null;
  let _onChange = () => {};
  // WS send function — injected via setWsSend so sensors.js can push gyro-mouse
  let _wsSend = null;

  const motion = {
    accelX: 0,
    accelY: 0,
    accelZ: G,
    gyroPitch: 0,
    gyroYaw: 0,
    gyroRoll: 0,
    gyroAvailable: false,
    accelAvailable: false,
    timestampUs: 0,
  };

  function safeStorage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; }
    catch (_) { return null; }
  }

  function loadConfig() {
    const storage = safeStorage();
    if (!storage) return { ...DEFAULTS };
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
      return sanitizeConfig(parsed);
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  function sanitizeConfig(input) {
    const next = { ...DEFAULTS, ...(input || {}) };
    next.motionEnabled = next.motionEnabled !== false;
    next.tiltPointerEnabled = next.tiltPointerEnabled !== false;
    next.tiltSensitivity = clamp(Number(next.tiltSensitivity) || 1, 0.35, 2.5);
    next.shakeEnabled = next.shakeEnabled !== false;
    next.shakeAction = SHAKE_ACTIONS.has(next.shakeAction) ? next.shakeAction : DEFAULTS.shakeAction;
    next.gyroMouseEnabled = !!next.gyroMouseEnabled;
    next.gyroMouseSensitivity = clamp(Number(next.gyroMouseSensitivity) || 1.0, 0.2, 5.0);
    return next;
  }

  function saveConfig() {
    const storage = safeStorage();
    if (!storage) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(config)); }
    catch (error) { console.warn('[Sensors] Failed to save motion settings:', error); }
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function finite(v) { return Number.isFinite(v) ? Number(v) : 0; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  async function requestPermissions() {
    const tasks = [];

    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      tasks.push(Promise.resolve().then(() => DeviceMotionEvent.requestPermission()).then((p) => p === 'granted').catch((error) => {
        console.warn('[Sensors] DeviceMotion permission failed:', error);
        return false;
      }));
    } else tasks.push(Promise.resolve(true));

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      tasks.push(Promise.resolve().then(() => DeviceOrientationEvent.requestPermission()).then((p) => p === 'granted').catch((error) => {
        console.warn('[Sensors] DeviceOrientation permission failed:', error);
        return false;
      }));
    } else tasks.push(Promise.resolve(true));

    const [motionOk, orientationOk] = await Promise.all(tasks);
    motionGranted = !!motionOk;
    orientationGranted = !!orientationOk;
    return motionGranted || orientationGranted;
  }

  function attachListeners() {
    if (listenersAttached || typeof window === 'undefined') return;
    window.addEventListener('deviceorientation', onOrientation, { passive: true });
    window.addEventListener('devicemotion', onMotion, { passive: true });
    listenersAttached = true;
  }

  async function init(onChange, wsSend) {
    if (typeof onChange === 'function') _onChange = onChange;
    if (typeof wsSend === 'function') _wsSend = wsSend;
    installMotionUI();
    if (initialized) return motionGranted || orientationGranted;

    const ok = await requestPermissions();
    if (!ok) {
      console.warn('[Sensors] No motion/orientation permission granted');
      return false;
    }

    attachListeners();
    initialized = true;
    installMotionUI();
    updateMotionStatus();
    return true;
  }

  // Allow late injection of the WS send function (called after WS init)
  function setWsSend(fn) {
    if (typeof fn === 'function') _wsSend = fn;
  }

  function getState() {
    return {
      irX,
      irY,
      shakeDetected,
      shakeAction: config.shakeAction,
      motion: { ...motion },
      motionEnabled: config.motionEnabled,
      tiltPointerEnabled: config.tiltPointerEnabled,
    };
  }

  function clearShake() { shakeDetected = false; }
  function getConfig() { return { ...config }; }

  function setConfig(next) {
    config = sanitizeConfig(next);
    if (!config.motionEnabled) {
      motion.accelX = 0; motion.accelY = 0; motion.accelZ = 0;
      motion.gyroPitch = 0; motion.gyroYaw = 0; motion.gyroRoll = 0;
      motion.accelAvailable = false; motion.gyroAvailable = false;
      shakeDetected = false;
    }
    if (!config.tiltPointerEnabled) { irX = 0; irY = 0; }
    saveConfig();
    updateMotionStatus();
    _onChange();
  }

  async function calibrateGyro(durationMs = 900) {
    if (!initialized || !motionGranted) return false;
    calibrationSamples = [];
    calibrationActive = true;
    if (calibrationTimer) clearTimeout(calibrationTimer);

    calibrationTimer = setTimeout(() => {
      calibrationActive = false;
      calibrationTimer = null;
      if (!calibrationSamples.length) {
        showMotionSnack('No hubo datos del gyro');
        return;
      }
      const count = calibrationSamples.length;
      calibration = {
        alpha: calibrationSamples.reduce((sum, s) => sum + s.alpha, 0) / count,
        beta: calibrationSamples.reduce((sum, s) => sum + s.beta, 0) / count,
        gamma: calibrationSamples.reduce((sum, s) => sum + s.gamma, 0) / count,
      };
      console.log('[Sensors] Gyro calibrated:', calibration);
      showMotionSnack('Gyro calibrado');
      _onChange();
    }, Math.max(300, Number(durationMs) || 900));

    showMotionSnack('Mantén el teléfono quieto…');
    return true;
  }

  function testRumble() {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      showMotionSnack('Este navegador no admite vibración');
      return false;
    }
    try {
      const ok = navigator.vibrate([60, 45, 90]);
      showMotionSnack(ok === false ? 'Vibración bloqueada' : 'Vibración de prueba');
      return ok !== false;
    } catch (error) {
      console.warn('[Sensors] Vibration test failed:', error);
      showMotionSnack('No se pudo activar la vibración');
      return false;
    }
  }

  function onOrientation(event) {
    if (!config.tiltPointerEnabled) { irX = 0; irY = 0; _onChange(); return; }
    if (Number.isFinite(event.gamma)) {
      const rawX = mapRange(event.gamma * config.tiltSensitivity, IR_GAMMA_RANGE[0], IR_GAMMA_RANGE[1], -1, 1);
      irX = lerp(irX, applyDeadzone(rawX), SMOOTHING);
    }
    if (Number.isFinite(event.beta)) {
      const rawY = mapRange(event.beta * config.tiltSensitivity, IR_BETA_RANGE[0], IR_BETA_RANGE[1], -1, 1);
      irY = lerp(irY, applyDeadzone(rawY), SMOOTHING);
    }
    _onChange();
  }

  // ── Gyro mouse delta accumulator ──────────────────────────────────────────
  // We accumulate gyro deltas and flush them via rAF to avoid WS spam.
  let _gyroMouseAccX = 0;
  let _gyroMouseAccY = 0;
  let _gyroMouseRaf = null;

  function _flushGyroMouse() {
    _gyroMouseRaf = null;
    if (!_wsSend || !config.gyroMouseEnabled) return;
    if (Math.abs(_gyroMouseAccX) < 0.01 && Math.abs(_gyroMouseAccY) < 0.01) return;
    _wsSend({ type: 'gyro-mouse', dx: _gyroMouseAccX * config.gyroMouseSensitivity, dy: _gyroMouseAccY * config.gyroMouseSensitivity });
    _gyroMouseAccX = 0;
    _gyroMouseAccY = 0;
  }

  function onMotion(event) {
    if (!config.motionEnabled) return;

    const accel = event.accelerationIncludingGravity || event.acceleration;
    if (accel && [accel.x, accel.y, accel.z].some(Number.isFinite)) {
      motion.accelX = finite(accel.x);
      motion.accelY = finite(accel.y);
      motion.accelZ = finite(accel.z);
      motion.accelAvailable = true;

      const magnitude = Math.hypot(motion.accelX, motion.accelY, motion.accelZ);
      const now = Date.now();
      if (config.shakeEnabled && magnitude > SHAKE_THRESHOLD && now - lastShakeTime > SHAKE_COOLDOWN) {
        shakeDetected = true;
        lastShakeTime = now;
      }
    }

    const rotation = event.rotationRate;
    if (rotation && [rotation.alpha, rotation.beta, rotation.gamma].some(Number.isFinite)) {
      motion.gyroYaw = finite(rotation.alpha) - calibration.alpha;
      motion.gyroPitch = finite(rotation.beta) - calibration.beta;
      motion.gyroRoll = finite(rotation.gamma) - calibration.gamma;
      motion.gyroAvailable = true;

      if (calibrationActive) {
        calibrationSamples.push({
          alpha: finite(rotation.alpha),
          beta: finite(rotation.beta),
          gamma: finite(rotation.gamma),
        });
      }

      // Gyro-mouse: accumulate and flush via rAF
      if (config.gyroMouseEnabled && _wsSend) {
        // Use yaw (alpha) for X, pitch (beta) for Y — typical FPS mapping
        const dt = event.interval || 0.016;
        _gyroMouseAccX += motion.gyroYaw * dt;
        _gyroMouseAccY += motion.gyroPitch * dt;
        if (!_gyroMouseRaf) _gyroMouseRaf = requestAnimationFrame(_flushGyroMouse);
      }
    }

    const nowMs = typeof performance !== 'undefined' && Number.isFinite(performance.now())
      ? performance.now() : Date.now();
    const origin = typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)
      ? performance.timeOrigin : Date.now() - nowMs;
    motion.timestampUs = Math.round((origin + nowMs) * 1000);
    _onChange();
  }

  function mapRange(value, inMin, inMax, outMin, outMax) {
    if (!Number.isFinite(value)) return 0;
    const clamped = clamp(value, inMin, inMax);
    return ((clamped - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
  }

  function applyDeadzone(value) {
    if (Math.abs(value) < DEADZONE) return 0;
    const sign = value > 0 ? 1 : -1;
    return sign * ((Math.abs(value) - DEADZONE) / (1 - DEADZONE));
  }

  function showMotionSnack(message) {
    const snack = document.getElementById('snack');
    if (!snack) return;
    snack.textContent = message;
    snack.classList.add('show');
    clearTimeout(showMotionSnack._timer);
    showMotionSnack._timer = setTimeout(() => snack.classList.remove('show'), 1800);
  }

  function toggleRow(label, id, enabled) {
    return `<label style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;font-size:10px;color:#cbd5e1">
      <span>${label}</span><button id="${id}" type="button" aria-pressed="${enabled}" style="min-width:70px;height:28px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:${enabled ? 'rgba(34,197,94,.20)' : 'rgba(255,255,255,.06)'};color:#fff;font:inherit;">${enabled ? 'ON' : 'OFF'}</button>
    </label>`;
  }

  function installMotionUI() {
    if (typeof document === 'undefined' || document.getElementById('nullpad-motion-button')) return;
    const topbar = document.getElementById('topbar');
    if (!topbar) return;

    const button = document.createElement('button');
    button.id = 'nullpad-motion-button';
    button.type = 'button';
    button.textContent = '⌁';
    button.title = 'Motion / DSU';
    button.style.cssText = 'width:34px;height:30px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:rgba(255,255,255,.06);color:inherit;font:inherit;cursor:pointer;';

    const group = document.createElement('div');
    group.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const conn = document.getElementById('conn-dot');
    if (conn?.parentNode) {
      conn.parentNode.insertBefore(group, conn.parentNode.firstChild);
      group.appendChild(button);
      group.appendChild(conn);
    } else topbar.appendChild(button);

    const panel = document.createElement('div');
    panel.id = 'nullpad-motion-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <div style="font-weight:800;font-size:12px">MOTION / DSU</div>
      <div id="nullpad-motion-status" style="font-size:10px;color:#94a3b8;margin-top:4px">Esperando sensores…</div>
      ${toggleRow('Gyro + acelerómetro → DSU', 'nullpad-motion-enabled', config.motionEnabled)}
      ${toggleRow('Tilt → Right Stick', 'nullpad-tilt-enabled', config.tiltPointerEnabled)}
      ${toggleRow('Gyro → Mouse PC', 'nullpad-gyromouse-enabled', config.gyroMouseEnabled)}
      <label style="display:block;font-size:10px;color:#cbd5e1;margin-top:8px">Sensibilidad tilt
        <input id="nullpad-tilt-sensitivity" type="range" min="0.35" max="2.50" step="0.05" value="${config.tiltSensitivity}" style="width:100%;margin-top:4px;">
      </label>
      <label style="display:block;font-size:10px;color:#cbd5e1;margin-top:6px">Sensibilidad gyro-mouse
        <input id="nullpad-gyromouse-sensitivity" type="range" min="0.2" max="5.0" step="0.1" value="${config.gyroMouseSensitivity}" style="width:100%;margin-top:4px;">
      </label>
      <label style="display:block;font-size:10px;color:#cbd5e1;margin-top:8px">Shake →
        <select id="nullpad-shake-action" style="float:right;background:#111827;color:#fff;border:1px solid rgba(255,255,255,.1);border-radius:7px;height:26px;">
          ${['none','lb','rb','a','b','x','y','l3','r3'].map((value) => `<option value="${value}" ${value === config.shakeAction ? 'selected' : ''}>${value.toUpperCase()}</option>`).join('')}
        </select>
      </label>
      <div style="clear:both"></div>
      <button id="nullpad-motion-calibrate" type="button" style="margin-top:9px;width:100%;height:32px;border:1px solid rgba(255,255,255,.1);border-radius:9px;background:rgba(255,255,255,.08);color:#fff;font:inherit;">Calibrar gyro</button>
      <button id="nullpad-motion-rumble" type="button" style="margin-top:6px;width:100%;height:32px;border:1px solid rgba(255,255,255,.1);border-radius:9px;background:rgba(124,58,237,.18);color:#fff;font:inherit;">Probar vibración</button>
      <div style="font-size:10px;color:#64748b;margin-top:7px;line-height:1.3">Cemu: DSU1 · UDP 26760 · gyro + accel. El tilt es un proxy de puntero; el teléfono no tiene la cámara IR física del Wiimote.</div>
    `;
    Object.assign(panel.style, {
      position: 'fixed', right: '12px', top: '50px', zIndex: '130', width: '230px',
      padding: '11px', border: '1px solid rgba(255,255,255,.10)', borderRadius: '13px',
      background: 'rgba(10,10,16,.96)', backdropFilter: 'blur(12px)',
      boxShadow: '0 10px 30px rgba(0,0,0,.4)', color: '#e2e8f0', fontFamily: 'inherit',
    });
    document.body.appendChild(panel);

    const setToggleText = (id, enabled) => {
      const toggle = panel.querySelector(`#${id}`);
      if (!toggle) return;
      toggle.textContent = enabled ? 'ON' : 'OFF';
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.style.background = enabled ? 'rgba(34,197,94,.20)' : 'rgba(255,255,255,.06)';
    };

    button.addEventListener('click', async () => {
      panel.hidden = !panel.hidden;
      if (!initialized) await init(_onChange, _wsSend);
      updateMotionStatus();
    });

    panel.querySelector('#nullpad-motion-enabled').addEventListener('click', () => {
      setConfig({ ...config, motionEnabled: !config.motionEnabled });
      setToggleText('nullpad-motion-enabled', config.motionEnabled);
    });
    panel.querySelector('#nullpad-tilt-enabled').addEventListener('click', () => {
      setConfig({ ...config, tiltPointerEnabled: !config.tiltPointerEnabled });
      if (!config.tiltPointerEnabled) { irX = 0; irY = 0; }
      setToggleText('nullpad-tilt-enabled', config.tiltPointerEnabled);
    });
    panel.querySelector('#nullpad-gyromouse-enabled').addEventListener('click', () => {
      setConfig({ ...config, gyroMouseEnabled: !config.gyroMouseEnabled });
      setToggleText('nullpad-gyromouse-enabled', config.gyroMouseEnabled);
    });
    panel.querySelector('#nullpad-tilt-sensitivity').addEventListener('input', (event) => {
      setConfig({ ...config, tiltSensitivity: Number(event.target.value) });
    });
    panel.querySelector('#nullpad-gyromouse-sensitivity').addEventListener('input', (event) => {
      setConfig({ ...config, gyroMouseSensitivity: Number(event.target.value) });
    });
    panel.querySelector('#nullpad-shake-action').addEventListener('change', (event) => {
      setConfig({ ...config, shakeAction: event.target.value });
    });
    panel.querySelector('#nullpad-motion-calibrate').addEventListener('click', async () => {
      if (!initialized) await init(_onChange, _wsSend);
      await calibrateGyro();
      updateMotionStatus();
    });
    panel.querySelector('#nullpad-motion-rumble').addEventListener('click', testRumble);
    panel._nullpadUpdate = updateMotionStatus;
    updateMotionStatus();
  }

  function updateMotionStatus() {
    if (typeof document === 'undefined') return;
    const status = document.getElementById('nullpad-motion-status');
    if (!status) return;
    const gyro = motion.gyroAvailable ? 'Gyro ✓' : 'Gyro —';
    const accel = motion.accelAvailable ? 'Accel ✓' : 'Accel —';
    const vibration = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' ? 'Vib ✓' : 'Vib —';
    const gMouse = config.gyroMouseEnabled ? 'GyrMouse ON' : '';
    status.textContent = [gyro, accel, vibration, gMouse].filter(Boolean).join(' · ');
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMotionUI, { once: true });
    else installMotionUI();
  }

  return {
    init,
    setWsSend,
    getState,
    getConfig,
    setConfig,
    clearShake,
    calibrateGyro,
    testRumble,
    isGranted: () => motionGranted || orientationGranted,
    isMotionGranted: () => motionGranted,
  };
})();
