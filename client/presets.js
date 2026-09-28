/**
 * NULLPAD — Game Presets
 *
 * Saves and loads named HUD layouts per controller profile.
 * Presets are stored in localStorage independently of the active HUD state.
 * The Presets button appears in the topbar next to the HUD edit button.
 *
 * API: window.NullPresets (auto-installed on DOMContentLoaded)
 */
'use strict';

const NullPresets = (() => {
  const VERSION = 'nullpad.presets.v1';

  // ── Storage helpers ───────────────────────────────────────────────────────
  function profileKey() {
    const p = String(window.location?.pathname || '').toLowerCase();
    if (p.includes('dualsense')) return 'dualsense';
    if (p.includes('xbox'))      return 'xbox';
    if (p.includes('joycon'))    return 'joycon';
    if (p.includes('wiimote'))   return 'wiimote';
    return 'unknown';
  }

  function storageKey(name) {
    return `${VERSION}.${profileKey()}.${name}`;
  }

  function listNames() {
    try {
      const prefix = `${VERSION}.${profileKey()}.`;
      const names = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) names.push(k.slice(prefix.length));
      }
      return names.sort();
    } catch (_) { return []; }
  }

  function savePreset(name) {
    if (!name) return false;
    // Snapshot the current HUD layout storage entry and save as preset
    try {
      const hudKey = `nullpad.hud.v4.${profileKey()}`;
      const current = localStorage.getItem(hudKey);
      if (!current) return false;
      localStorage.setItem(storageKey(name), current);
      return true;
    } catch (_) { return false; }
  }

  function loadPreset(name) {
    if (!name) return false;
    try {
      const data = localStorage.getItem(storageKey(name));
      if (!data) return false;
      const hudKey = `nullpad.hud.v4.${profileKey()}`;
      localStorage.setItem(hudKey, data);
      // Refresh the HUD to apply loaded layout
      if (typeof window.NullLayout?.refresh === 'function') window.NullLayout.refresh();
      return true;
    } catch (_) { return false; }
  }

  function deletePreset(name) {
    if (!name) return false;
    try { localStorage.removeItem(storageKey(name)); return true; }
    catch (_) { return false; }
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  function showSnack(msg) {
    const el = document.getElementById('snack');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(showSnack._t);
    showSnack._t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function buildPanel(panel, button) {
    function render() {
      const names = listNames();
      panel.innerHTML = `
        <div style="font-weight:800;font-size:12px;margin-bottom:8px">PRESETS · ${profileKey().toUpperCase()}</div>
        <div style="display:flex;gap:6px;margin-bottom:10px;">
          <input id="np-preset-name" type="text" placeholder="Nombre del preset…"
            style="flex:1;min-width:0;height:30px;padding:0 8px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:#111827;color:#fff;font:inherit;font-size:11px;">
          <button id="np-preset-save" type="button"
            style="height:30px;padding:0 10px;border:1px solid rgba(34,197,94,.35);border-radius:8px;background:rgba(34,197,94,.15);color:#fff;font:inherit;font-size:11px;cursor:pointer;">
            Guardar
          </button>
        </div>
        ${names.length === 0
          ? '<div style="font-size:10px;color:#64748b">Sin presets. Personaliza el HUD y guárdalo.</div>'
          : names.map(n => `
            <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
              <span style="flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${n}</span>
              <button data-load="${n}" type="button"
                style="height:26px;padding:0 8px;border:1px solid rgba(124,58,237,.35);border-radius:7px;background:rgba(124,58,237,.15);color:#fff;font:inherit;font-size:10px;cursor:pointer;">
                Cargar
              </button>
              <button data-del="${n}" type="button"
                style="height:26px;padding:0 8px;border:1px solid rgba(239,68,68,.35);border-radius:7px;background:rgba(239,68,68,.10);color:#fca5a5;font:inherit;font-size:10px;cursor:pointer;">
                ✕
              </button>
            </div>`).join('')}
      `;

      panel.querySelector('#np-preset-save').addEventListener('click', () => {
        const input = panel.querySelector('#np-preset-name');
        const name = (input?.value || '').trim();
        if (!name) { showSnack('Escribe un nombre primero'); return; }
        if (savePreset(name)) {
          showSnack(`Preset "${name}" guardado`);
          input.value = '';
          render();
        } else {
          showSnack('Nada que guardar — personaliza el HUD primero');
        }
      });

      panel.querySelectorAll('[data-load]').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.load;
          if (loadPreset(name)) showSnack(`Preset "${name}" cargado`);
        });
      });

      panel.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.del;
          if (deletePreset(name)) { showSnack(`Preset "${name}" eliminado`); render(); }
        });
      });
    }

    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) render();
    });
  }

  function install() {
    if (document.getElementById('np-presets-button')) return;
    const topbar = document.getElementById('topbar');
    if (!topbar) return;

    const button = document.createElement('button');
    button.id = 'np-presets-button';
    button.type = 'button';
    button.title = 'Presets';
    button.textContent = '🎮';
    button.style.cssText = 'width:34px;height:30px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:rgba(255,255,255,.06);color:inherit;font:inherit;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;';

    // Insert next to HUD edit button if present, else append
    const hudBtn = document.getElementById('nullpad-layout-button');
    if (hudBtn?.parentNode) hudBtn.parentNode.insertBefore(button, hudBtn.nextSibling);
    else topbar.appendChild(button);

    const panel = document.createElement('div');
    panel.id = 'np-presets-panel';
    panel.hidden = true;
    Object.assign(panel.style, {
      position: 'fixed', right: '12px', top: '50px', zIndex: '131', width: '230px',
      padding: '12px', border: '1px solid rgba(255,255,255,.10)', borderRadius: '13px',
      background: 'rgba(10,10,16,.96)', backdropFilter: 'blur(12px)',
      boxShadow: '0 10px 30px rgba(0,0,0,.4)', color: '#e2e8f0', fontFamily: 'inherit',
    });
    document.body.appendChild(panel);

    // Close panel on outside tap
    document.addEventListener('pointerdown', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== button) {
        panel.hidden = true;
      }
    }, true);

    buildPanel(panel, button);
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }

  return { savePreset, loadPreset, deletePreset, listNames };
})();
