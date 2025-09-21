import type { ParamSchema, EffectParams, UiSection } from '../engine/protocol'

type OnChange = (k: string, v: number | string | boolean) => void;

// Utility
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function parseQSValue(
  key: string,
  def: ParamSchema[keyof ParamSchema],
  raw: string
): number | string | boolean | undefined {
  if (def.kind === 'number') {
    const v = Number(raw);
    if (!Number.isFinite(v)) return undefined;
    const min = (def as any).min ?? -Infinity;
    const max = (def as any).max ?? +Infinity;
    const clamped = clamp(v, min, max);
    return clamped;
  }
  if (def.kind === 'enum') {
    const opts = def.options as readonly string[];
    return opts.includes(raw) ? raw : undefined;
  }
  if (def.kind === 'toggle') {
    const s = raw.trim().toLowerCase();
    // accept: 1/0, true/false, on/off, yes/no
    if (['1', 'true', 'on', 'yes'].includes(s)) return true;
    if (['0', 'false', 'off', 'no'].includes(s)) return false;
    return undefined;
  }
  return undefined;
}

export function buildControls(
  schema: ParamSchema,
  onChange: OnChange,
  sectionsMeta?: UiSection[]
) {
  const form = document.getElementById('controls') as HTMLFormElement;
  form.innerHTML = '';

  // maintain current values locally so "Save" can read them without scraping the DOM
  const current: Record<string, number | string | boolean> = {};

  // 0) Read query string overrides
  const qs = new URLSearchParams(window.location.search);
  const qsOverrides: Partial<Record<string, number | string | boolean>> = {};
  for (const [key, def] of Object.entries(schema)) {
    const raw = qs.get(key);
    if (raw == null) continue;
    const parsed = parseQSValue(key, def as any, raw);
    if (parsed !== undefined) qsOverrides[key] = parsed;
  }

  // 1) Group params by section id + seed defaults (possibly overridden by QS)
  const bySection = new Map<string, [string, ParamSchema[keyof ParamSchema]][]>();
  const defaults: EffectParams = {};

  for (const [key, def] of Object.entries(schema)) {
    const dflt = (def as any).default;
    const init = key in qsOverrides ? qsOverrides[key]! : dflt;
    (defaults as any)[key] = init;
    current[key] = init as any;

    const secId = def.ui?.section ?? '_default';
    if (!bySection.has(secId)) bySection.set(secId, []);
    bySection.get(secId)!.push([key, def as any]);
  }

  // 2) Resolve section ordering/labels/colors
  const orderedSections: UiSection[] = (() => {
    const seen = new Set<string>();
    const result: UiSection[] = [];
    (sectionsMeta ?? []).forEach(s => {
      if (!seen.has(s.id) && bySection.has(s.id)) { result.push(s); seen.add(s.id); }
    });
    for (const id of bySection.keys()) {
      if (seen.has(id)) continue;
      result.push({ id, label: id === '_default' ? 'Controls' : id, color: '#1a1a1a' });
    }
    return result;
  })();

  const currentMode = String(defaults['vis.mode'] ?? 'boids');

  const sectionModeFromId = (id: string): 'boids' | 'circleLine' | null => {
    if (id === 'boids' || id === 'bugs') return 'boids';
    if (id === 'circle') return 'circleLine';
    return null;
  };

  const gateByMode = (secId: string) => {
    const m = sectionModeFromId(secId);
    if (!m) return true;
    return m === currentMode;
  };

  // --- Save link header (sticks to the top of the form) ---
  const saveRow = el('div', 'row');
  const saveLabel = el('span', 'label');
  saveLabel.textContent = 'Share/Save';
  const saveBtn = el('button') as HTMLButtonElement;
  saveBtn.type = 'button';
  saveBtn.textContent = 'Copy link';
  saveBtn.onclick = async (e) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    const params = new URLSearchParams();
    // Only include params that differ from schema defaults — cleaner links
    for (const [key, def] of Object.entries(schema)) {
      const val = current[key];
      const dflt = (def as any).default;
      if (val === dflt) continue;

      if (typeof val === 'boolean') params.set(key, val ? 'true' : 'false');
      else params.set(key, String(val));
    }
    // keep any non-control params that were already in the URL
    for (const [k, v] of qs.entries()) {
      if (schema[k as keyof ParamSchema]) continue; // skip control keys we just set above
      params.set(k, v);
    }
    url.search = params.toString();

    const link = url.toString();
    try {
      await navigator.clipboard.writeText(link);
      saveBtn.textContent = 'Copied!';
      setTimeout(() => (saveBtn.textContent = 'Copy link'), 1000);
    } catch {
      // fallback: open prompt
      window.prompt('Copy this link', link);
    }
  };
  saveRow.appendChild(saveLabel);
  saveRow.appendChild(saveBtn);
  form.appendChild(saveRow);

  // 3) Render each section
  for (const sec of orderedSections) {
    if (!gateByMode(sec.id)) continue;
    const items = bySection.get(sec.id);
    if (!items) continue;

    const wrap = el('section', 'sec');
    wrap.style.background = sec.color ?? '#1a1a1a';
    wrap.style.border = '1px solid #2a2a2a';
    wrap.style.borderRadius = '12px';
    wrap.style.padding = '10px';
    wrap.style.margin = '10px 0';
    (wrap as HTMLElement).dataset.section = sec.id;

    const head = el('div', 'sec-head row');
    const title = el('div', 'label'); title.textContent = sec.label;
    head.appendChild(title);

    let sectionEnabled = true;
    if (sec.enabledParam) {
      const key = sec.enabledParam;
      const def = schema[key];
      if (!def || def.kind !== 'toggle') {
        console.warn(`Section "${sec.id}" expects toggle param "${key}"`);
      } else {
        const initial = Boolean(defaults[key] as boolean);
        const btn = el('button') as HTMLButtonElement;
        sectionEnabled = initial;
        btn.textContent = initial ? 'On' : 'Off';
        btn.setAttribute('aria-pressed', String(initial));
        btn.style.minWidth = '64px';
        btn.onclick = (e) => {
          e.preventDefault();
          const nowOn = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', String(nowOn));
          btn.textContent = nowOn ? 'On' : 'Off';
          setDisabled(!nowOn);
          current[key] = nowOn;
          onChange(key, nowOn);
        };
        head.appendChild(btn);
      }
    }

    wrap.appendChild(head);

    const body = el('div', 'sec-body');
    items.forEach(([key, def]) => {
      if (sec.enabledParam && key === sec.enabledParam) return;

      const row = el('div', 'row');
      const label = el('span', 'label');
      label.textContent = def.label;
      row.appendChild(label);

      const initialVal = defaults[key];

      if (def.kind === 'number') {
        const input = el('input') as HTMLInputElement;
        input.type = 'range';
        input.name = key;
        input.min = String(def.min);
        input.max = String(def.max);
        if (def.step != null) input.step = String(def.step);
        input.value = String(initialVal);
        input.oninput = () => {
          const v = Number(input.value);
          current[key] = v;
          onChange(key, v);
        };
        row.appendChild(input);
      } else if (def.kind === 'enum') {
        const select = el('select') as HTMLSelectElement;
        select.name = key;
        (def.options as string[]).forEach(opt => {
          const o = el('option') as HTMLOptionElement;
          o.value = opt; o.textContent = opt;
          if (opt === initialVal) o.selected = true;
          select.appendChild(o);
        });
        select.oninput = () => {
          current[key] = select.value;
          onChange(key, select.value);
          // If vis.mode changes, a simple way to re-gate sections: rebuild the form
          if (key === 'vis.mode') {
            // Rebuild with the same external onChange
            const url = new URL(window.location.href);
            url.searchParams.set('vis.mode', select.value);
            history.replaceState(null, '', url);

            buildControls(schema, onChange, sectionsMeta);
            return;
          }
        };
        row.appendChild(select);
      } else if (def.kind === 'toggle') {
        const btn = el('button') as HTMLButtonElement;
        const on = Boolean(initialVal);
        btn.textContent = on ? 'On' : 'Off';
        btn.setAttribute('aria-pressed', String(on));
        btn.onclick = (e) => {
          e.preventDefault();
          const nowOn = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', String(nowOn));
          btn.textContent = nowOn ? 'On' : 'Off';
          current[key] = nowOn;
          onChange(key, nowOn);
        };
        row.appendChild(btn);
      }

      body.appendChild(row);
    });

    function setDisabled(disabled: boolean) {
      body.style.opacity = disabled ? '0.5' : '1';
      body.querySelectorAll('input,select,button').forEach(el => {
        (el as HTMLInputElement | HTMLButtonElement).disabled = disabled;
      });
    }
    setDisabled(!sectionEnabled);

    wrap.appendChild(body);
    form.appendChild(wrap);
  }

  // 4) Immediately push initial values (defaults + QS overrides) to onChange,
  //    so audio/visual engines receive the state on load.
  for (const [k, v] of Object.entries(current)) {
    onChange(k, v);
  }

  return defaults;
}
