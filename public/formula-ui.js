'use strict';
/* Công thức toán, hóa (2.16.0) cho bản web: vẽ x^2 / H_2O thành chỉ số trên / dưới trong bong bóng chat,
   và bàn phím ký hiệu (√ π ≤ → ⇌ ₂ ²⁺…) gắn trên ô nhập tin. Phần tách công thức: public/formula-core.js.
   Bản app: native/src/formula/. */
window.ThinkFormula = (() => {
  const F = window.FormulaCore;

  /** Một đoạn chữ → danh sách chữ thường và <sup>/<sub> (dùng trong bong bóng, thẻ kèo, bình chọn) */
  function nodes(text) {
    const parts = F.parse(text);
    if (parts.length === 1 && parts[0].t === 'text') return [parts[0].s];
    return parts.map((p) => {
      if (p.t === 'text') return p.s;
      const el = document.createElement(p.t);
      el.className = 'fx';
      el.textContent = p.s;
      return el;
    });
  }

  /** Thay các đoạn chữ (string) trong danh sách bằng công thức, giữ nguyên phần tử khác (link, @tên) */
  const within = (parts) => parts.flatMap((p) => (typeof p === 'string' ? nodes(p) : [p]));

  /* Bàn phím ký hiệu: bấm phím chèn vào chỗ con trỏ, ô nhập không mất tiêu điểm (bàn phím điện thoại không bị đóng) */
  function createPad({ input, onChange, h, icon }) {
    let tab = 'math';
    const panel = h('div', { class: 'fx-pad', id: 'formula-pad', role: 'group', 'aria-label': 'Ký hiệu toán, hóa', hidden: true });
    const keep = (el) => {
      el.addEventListener('pointerdown', (e) => e.preventDefault()); // giữ tiêu điểm ở ô nhập
      return el;
    };
    const preview = h('p', { class: 'fx-preview', 'aria-live': 'polite' });
    function press(ins) {
      const r = F.insert(input.value, input.selectionStart, input.selectionEnd, ins);
      input.value = r.value;
      input.setSelectionRange(r.caret, r.caret);
      if (document.activeElement !== input) input.focus({ preventScroll: true });
      onChange();
      update();
    }
    function render() {
      const group = F.PAD.find((g) => g.id === tab) || F.PAD[0];
      panel.replaceChildren(
        h('div', { class: 'fx-head' },
          h('div', { class: 'fx-tabs', role: 'tablist' }, F.PAD.map((g) => keep(h('button', {
            class: `fx-tab${g.id === tab ? ' is-on' : ''}`, type: 'button', role: 'tab', 'aria-selected': g.id === tab ? 'true' : 'false', text: g.name,
            onclick: () => { tab = g.id; render(); },
          })))),
          keep(h('button', { class: 'icon-btn fx-close', type: 'button', 'aria-label': 'Đóng bàn phím ký hiệu', onclick: () => toggle(false) }, icon('close')))),
        preview,
        h('div', { class: 'fx-keys' }, group.keys.map(([label, ins, name, markup]) => keep(h('button', {
          class: `fx-key${markup ? ' is-wide' : ''}`, type: 'button', 'aria-label': name || label, title: name || label,
          onclick: () => press(ins || label),
        }, markup ? nodes(markup) : label)))));
      update();
    }
    // Xem trước khi tin có công thức; chưa có thì gợi ý cách gõ
    function update() {
      if (panel.hidden) return;
      const v = input.value;
      if (F.has(v)) {
        preview.replaceChildren(h('span', { class: 'fx-preview-label', text: 'Xem trước' }), h('span', { class: 'fx-preview-text' }, nodes(v.length > 160 ? `${v.slice(0, 159)}…` : v)));
      } else {
        preview.replaceChildren(h('span', { class: 'fx-preview-label', text: 'Mẹo' }), h('span', { class: 'fx-preview-text', text: 'Gõ x^2 → x², H_2O → H₂O, x^{n+1} → xⁿ⁺¹' }));
      }
    }
    function toggle(on = panel.hidden) {
      panel.hidden = !on;
      if (on) {
        render();
        input.focus({ preventScroll: true });
      }
    }
    input.addEventListener('input', update);
    return { el: panel, toggle, update, isOpen: () => !panel.hidden, close: () => toggle(false) };
  }

  return { nodes, within, createPad, toUnicode: F.toUnicode, has: F.has };
})();
