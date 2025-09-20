import type { ParamSchema, EffectParams, UiSection } from '../engine/protocol'

type OnChange = (k: string, v: number | string | boolean) => void;

// Utility
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

export function buildControls(
  schema: ParamSchema,
  onChange: OnChange,
  sectionsMeta?: UiSection[]
) {
  const form = document.getElementById('controls') as HTMLFormElement;
  form.innerHTML = '';

  // 1) Group params by section id
  const bySection = new Map<string, [string, ParamSchema[keyof ParamSchema]][]>();
  const defaults: EffectParams = {};

  for (const [key, def] of Object.entries(schema)) {
    (defaults as any)[key] = (def as any).default;
    const secId = def.ui?.section ?? '_default';
    if (!bySection.has(secId)) bySection.set(secId, []);
    bySection.get(secId)!.push([key, def as any]);
  }

  // 2) Resolve section ordering/labels/colors
  const orderedSections: UiSection[] = (() => {
    const seen = new Set<string>();
    const result: UiSection[] = [];
    // First: any provided meta in given order
    (sectionsMeta ?? []).forEach(s => {
      if (!seen.has(s.id) && bySection.has(s.id)) { result.push(s); seen.add(s.id); }
    });
    // Then: any leftover groups, basic defaults
    for (const id of bySection.keys()) {
      if (seen.has(id)) continue;
      result.push({ id, label: id === '_default' ? 'Controls' : id, color: '#1a1a1a' });
    }
    return result;
  })();

  // 3) Render each section
  for (const sec of orderedSections) {
    const items = bySection.get(sec.id);
    if (!items) continue;

    // Section container
    const wrap = el('section', 'sec');
    wrap.style.background = sec.color ?? '#1a1a1a';
    wrap.style.border = '1px solid #2a2a2a';
    wrap.style.borderRadius = '12px';
    wrap.style.padding = '10px';
    wrap.style.margin = '10px 0';

    // Header: label + toggle (if provided)
    const head = el('div', 'sec-head row');
    const title = el('div', 'label'); title.textContent = sec.label;
    head.appendChild(title);

    let sectionEnabled = true;
    if (sec.enabledParam) {
      const key = sec.enabledParam;
      const def = schema[key];
      // Ensure param exists & is toggle
      if (!def || def.kind !== 'toggle') {
        console.warn(`Section "${sec.id}" expects toggle param "${key}"`);
      } else {
        const btn = el('button') as HTMLButtonElement;
        const on = Boolean(def.default);
        sectionEnabled = on;
        btn.textContent = on ? 'On' : 'Off';
        btn.setAttribute('aria-pressed', String(on));
        btn.style.minWidth = '64px';
        btn.onclick = (e) => {
          e.preventDefault();
          const nowOn = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', String(nowOn));
          btn.textContent = nowOn ? 'On' : 'Off';
          setDisabled(!nowOn);
          onChange(key, nowOn);
        };
        head.appendChild(btn);
      }
    }

    wrap.appendChild(head);

    // Body: controls (skip the section toggle param itself)
    const body = el('div', 'sec-body');
    items.forEach(([key, def]) => {
      if (sec.enabledParam && key === sec.enabledParam) return; // don't render duplicate
      const row = el('div', 'row');

      const label = el('span', 'label');
      label.textContent = def.label;
      row.appendChild(label);

      if (def.kind === 'number') {
        const input = el('input') as HTMLInputElement;
        input.type = 'range';
        input.name = key;
        input.min = String(def.min);
        input.max = String(def.max);
        if (def.step != null) input.step = String(def.step);
        input.value = String(def.default);
        input.oninput = () => onChange(key, Number(input.value));
        row.appendChild(input);
      } else if (def.kind === 'enum') {
        const select = el('select') as HTMLSelectElement;
        select.name = key;
        (def.options as string[]).forEach(opt => {
          const o = el('option') as HTMLOptionElement;
          o.value = opt; o.textContent = opt;
          if (opt === def.default) o.selected = true;
          select.appendChild(o);
        });
        select.oninput = () => onChange(key, select.value);
        row.appendChild(select);
      } else if (def.kind === 'toggle') {
        const btn = el('button') as HTMLButtonElement;
        const on = Boolean(def.default);
        btn.textContent = on ? 'On' : 'Off';
        btn.setAttribute('aria-pressed', String(on));
        btn.onclick = (e) => {
          e.preventDefault();
          const nowOn = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', String(nowOn));
          btn.textContent = nowOn ? 'On' : 'Off';
          onChange(key, nowOn);
        };
        row.appendChild(btn);
      }

      body.appendChild(row);
    });

    // Enable/disable section body
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

  return defaults;
}