'use strict';
/* Kèo và hẹn giờ gửi tin (2.16.0) cho bản web. Máy chủ: src/events.js, src/scheduled.js. Bản app: native/src/plans/.
   - Kèo: thẻ trong khung chat (ô lịch, tên, giờ, địa điểm, nút Đi / Có thể / Không đi, ai đi), bảng "Tạo kèo".
   - Hẹn giờ gửi: bảng viết tin + chọn giờ, thanh "n tin hẹn giờ" trên ô nhập, bảng danh sách (Gửi ngay / Hủy).
   app.js gọi ThinkPlans.create(host) rồi dùng eventEl(m), renderBar(), onScheduled(data)... */
window.ThinkPlans = (() => {
  const P = window.PlansCore;
  const RSVP = [
    { key: 'yes', label: 'Đi', icon: 'check' },
    { key: 'maybe', label: 'Có thể', icon: null },
    { key: 'no', label: 'Không đi', icon: 'close' },
  ];

  function create(host) {
    const { api, h, icon, avatarEl, nameOf, state, toast, withBusy, navigate, goBack, receive, renderMessages, renderConvList, setFormError, onMessageUpdated, placeMenu, formulaNodes } = host;
    const S = { scheduled: [], loaded: false, prefill: '', mentions: [] };
    const $ = (sel, root = document) => root.querySelector(sel);
    const who = (uid) => (uid === state.me.id ? 'Bạn' : nameOf(uid));

    /* ================= Thẻ kèo trong khung chat ================= */
    function eventEl(m) {
      const ev = m.event || { place: '', startsAt: m.createdAt, canceled: false, yes: [], maybe: [], no: [] };
      const now = Date.now();
      const phase = P.eventPhase(ev, now);
      const open = phase === 'upcoming' || phase === 'soon';
      const mine = ['yes', 'maybe', 'no'].find((k) => (ev[k] || []).includes(state.me.id)) || null;
      const date = P.dateBlock(ev.startsAt);
      const when = P.whenText(ev.startsAt, now);
      const status = phase === 'canceled' ? 'Đã hủy' : phase === 'past' ? 'Đã diễn ra' : P.untilText(ev.startsAt, now);
      const card = h('div', { class: `bubble keo is-${phase}`, role: 'group', 'aria-label': `Kèo ${m.text}, ${when}${ev.place ? `, ở ${ev.place}` : ''}. ${status}` },
        h('div', { class: 'keo-top' },
          h('div', { class: 'keo-date', 'aria-hidden': 'true' },
            h('span', { class: 'keo-wd', text: date.wd }),
            h('span', { class: 'keo-day', text: date.day }),
            h('span', { class: 'keo-mon', text: date.month })),
          h('div', { class: 'keo-main' },
            h('p', { class: 'keo-title' }, formulaNodes(m.text || '')),
            h('p', { class: 'keo-when' }, icon('clock'), h('span', { text: when }), status ? h('span', { class: `keo-status${phase === 'soon' ? ' is-soon' : ''}`, text: status }) : null),
            ev.place ? h('p', { class: 'keo-place' }, icon('place'), h('span', { text: ev.place })) : null)));
      if (open) {
        card.append(h('div', { class: 'keo-actions', role: 'group', 'aria-label': 'Bạn có đi không?' },
          RSVP.map((r) => {
            const n = (ev[r.key] || []).length;
            const on = mine === r.key;
            return h('button', {
              class: `keo-btn is-${r.key}${on ? ' is-on' : ''}`, type: 'button', 'aria-pressed': on ? 'true' : 'false',
              'aria-label': `${r.label}: ${n} người${on ? ', bạn đã chọn' : ''}`,
              disabled: !m.id,
              onclick: (e) => { e.stopPropagation(); rsvp(m, on ? null : r.key); },
            }, on && r.icon ? icon(r.icon) : null, h('span', { text: r.label }), n ? h('b', { text: String(n) }) : null);
          })));
      }
      const going = ev.yes || [];
      const total = going.length + (ev.maybe || []).length + (ev.no || []).length;
      if (total && phase !== 'canceled') {
        const names = going.map(who);
        const line = going.length ? `${P.peopleText(names)} ${phase === 'past' ? 'đã đi' : 'sẽ đi'}` : 'Chưa ai chọn Đi';
        card.append(h('button', {
          class: 'keo-who', type: 'button', 'aria-label': `${line}. Bấm để xem ai đi, ai không`,
          onclick: (e) => { e.stopPropagation(); showPeople(m, e.clientX, e.clientY); },
        }, h('span', { class: 'keo-faces' }, going.slice(0, 4).map((uid) => avatarEl(host.userOf(uid), 'avatar-xs', { dot: false }))), h('span', { text: line })));
      }
      if (open && (m.senderId === state.me.id || state.me.role === 'admin') && m.id) {
        card.append(h('button', { class: 'keo-cancel', type: 'button', text: 'Hủy kèo', onclick: (e) => { e.stopPropagation(); cancelEvent(m); } }));
      }
      return card;
    }

    function showPeople(m, x, y) {
      const ev = m.event;
      if (!ev) return;
      const nodes = [h('p', { class: 'menu-title', text: m.text || 'Kèo' })];
      for (const r of RSVP) {
        const ids = ev[r.key] || [];
        if (!ids.length) continue;
        nodes.push(h('p', { class: 'keo-people-head', text: `${r.label} · ${ids.length}` }));
        for (const uid of ids) nodes.push(h('div', { class: 'reactor' }, avatarEl(host.userOf(uid), 'avatar-sm', { dot: false }), h('span', { class: 'reactor-name', text: who(uid) })));
      }
      placeMenu(nodes, x, y, null);
    }

    // Đặt lựa chọn của mình trong kèo (null = bỏ chọn)
    function setMine(ev, status) {
      for (const k of ['yes', 'maybe', 'no']) ev[k] = (ev[k] || []).filter((uid) => uid !== state.me.id);
      if (status) ev[status].push(state.me.id);
    }
    async function rsvp(m, status) {
      const ev = m.event;
      if (!ev || !m.id) return;
      const prev = ['yes', 'maybe', 'no'].find((k) => (ev[k] || []).includes(state.me.id)) || null;
      setMine(ev, status);
      renderMessages({ preserve: true });
      try {
        onMessageUpdated(await api(`/api/messages/${m.id}/rsvp`, { method: 'POST', body: { status } }));
      } catch (err) {
        // Trả lại lựa chọn cũ của mình, giữ thay đổi của người khác vừa nhận qua realtime
        const cur = (state.msgs.get(m.conversationId)?.list || []).find((x) => x.id === m.id) || m;
        if (cur.event) setMine(cur.event, prev);
        renderMessages({ preserve: true });
        toast(err.message);
      }
    }

    async function cancelEvent(m) {
      if (!window.confirm(`Hủy kèo “${m.text}”? Những ai đã chọn Đi / Có thể sẽ nhận được thông báo.`)) return;
      try {
        onMessageUpdated(await api(`/api/messages/${m.id}/event/cancel`, { method: 'POST', body: {} }));
        toast('Đã hủy kèo.');
      } catch (err) {
        toast(err.message);
      }
    }

    /* ================= Chọn giờ: các nút giờ nhanh + ô chọn ngày giờ ================= */
    function whenPicker(presets, name) {
      const inp = h('input', { class: 'search-input when-input', type: 'datetime-local', name, 'aria-label': 'Ngày giờ', required: true });
      const chips = presets.map((p) => h('button', {
        class: 'when-chip', type: 'button', dataset: { at: p.at },
        onclick: () => {
          inp.value = P.toInput(p.at);
          sync();
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        },
      }, h('strong', { text: p.label }), h('span', { text: P.dayText(p.at) })));
      const hint = h('p', { class: 'hint when-hint' });
      function sync() {
        const ts = P.fromInput(inp.value);
        for (const c of chips) c.classList.toggle('is-on', ts != null && Number(c.dataset.at) === ts);
        hint.textContent = ts ? `${P.whenText(ts)}${ts > Date.now() ? ` · ${P.untilText(ts)}` : ' · giờ này đã qua'}` : '';
      }
      inp.addEventListener('input', sync);
      inp.min = P.toInput(Date.now());
      return { el: h('div', { class: 'when' }, h('div', { class: 'when-chips' }, chips), inp, hint), value: () => P.fromInput(inp.value), set: (ts) => { inp.value = ts ? P.toInput(ts) : ''; sync(); } };
    }

    /* ================= Bảng "Tạo kèo" ================= */
    function renderEventForm() {
      const body = $('#event-body');
      const picker = whenPicker(P.eventPresets(), 'startsAt');
      const form = h('form', { class: 'panel', novalidate: true },
        h('label', { class: 'field' }, h('span', { text: 'Tên kèo' }), h('input', { name: 'title', maxlength: 100, placeholder: 'vd: Đi ăn lẩu, đá bóng, cà phê cuối tuần', autocomplete: 'off', required: true })),
        h('div', { class: 'field' }, h('span', { text: 'Thời gian' }), picker.el),
        h('label', { class: 'field' }, h('span', { text: 'Địa điểm (không bắt buộc)' }), h('input', { name: 'place', maxlength: 120, placeholder: 'vd: Quán lẩu cũ, 12 Hai Bà Trưng', autocomplete: 'off' })),
        h('p', { class: 'hint', text: 'Trước giờ hẹn 1 tiếng, Think nhắc những ai chọn Đi hoặc Có thể.' }),
        h('p', { class: 'form-error', role: 'alert', hidden: true }),
        h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Gửi kèo' }));
      form.addEventListener('input', () => setFormError(form, ''));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = form.elements.title.value.trim();
        const startsAt = picker.value();
        if (!title) return setFormError(form, 'Hãy đặt tên cho kèo.');
        if (!startsAt) return setFormError(form, 'Hãy chọn giờ hẹn.');
        if (startsAt <= Date.now() + 60000) return setFormError(form, 'Giờ hẹn phải sau bây giờ.');
        setFormError(form, '');
        const convId = state.currentId;
        withBusy(form.querySelector('[type=submit]'), async () => {
          try {
            const { message } = await api(`/api/conversations/${convId}/events`, { method: 'POST', body: { title, place: form.elements.place.value.trim(), startsAt } });
            receive(message);
            goBack();
            if (state.currentId === convId) renderMessages({ toBottom: true });
            renderConvList();
          } catch (err) {
            setFormError(form, err.message);
          }
        });
      });
      body.replaceChildren(form);
      setTimeout(() => form.elements.title.focus(), 250);
    }

    /* ================= Hẹn giờ gửi tin ================= */
    // Mở bảng "Hẹn giờ gửi" với chữ đang gõ trong ô nhập
    function openSchedule(text, mentions) {
      S.prefill = text || '';
      S.mentions = mentions || [];
      navigate('#/schedule');
    }

    function renderScheduleForm() {
      const body = $('#schedule-body');
      const picker = whenPicker(P.schedulePresets(), 'sendAt');
      const ta = h('textarea', { name: 'text', rows: 4, maxlength: 4000, placeholder: 'Tin nhắn sẽ được gửi đúng giờ bạn chọn', 'aria-label': 'Tin nhắn hẹn giờ' });
      ta.value = S.prefill;
      const form = h('form', { class: 'panel', novalidate: true },
        h('label', { class: 'field' }, h('span', { text: 'Tin nhắn' }), ta),
        h('div', { class: 'field' }, h('span', { text: 'Gửi lúc' }), picker.el),
        h('p', { class: 'hint', text: 'Chỉ bạn thấy tin đang chờ. Đến giờ, tin được gửi như bạn tự gửi.' }),
        h('p', { class: 'form-error', role: 'alert', hidden: true }),
        h('button', { class: 'btn btn-primary btn-block', type: 'submit', text: 'Hẹn giờ gửi' }));
      form.addEventListener('input', () => setFormError(form, ''));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = ta.value.trim();
        const sendAt = picker.value();
        if (!text) return setFormError(form, 'Hãy nhập tin nhắn muốn hẹn giờ gửi.');
        if (!sendAt) return setFormError(form, 'Hãy chọn giờ gửi.');
        if (sendAt < Date.now() + 60000) return setFormError(form, 'Hãy chọn giờ gửi sau bây giờ ít nhất 1 phút.');
        setFormError(form, '');
        const convId = state.currentId;
        withBusy(form.querySelector('[type=submit]'), async () => {
          try {
            // @nhắc tên: chỉ người còn "@Tên" trong tin
            const mentions = S.mentions.filter((id) => text.includes(`@${nameOf(id)}`));
            const { scheduled } = await api(`/api/conversations/${convId}/scheduled`, { method: 'POST', body: { text, sendAt, mentions } });
            onScheduled({ scheduled });
            if (S.prefill && host.clearDraft) host.clearDraft(convId, S.prefill);
            S.prefill = '';
            S.mentions = [];
            goBack();
            toast(`Đã hẹn gửi lúc ${P.whenText(sendAt)}.`);
          } catch (err) {
            setFormError(form, err.message);
          }
        });
      });
      body.replaceChildren(form);
      setTimeout(() => (S.prefill ? null : ta.focus()), 250);
    }

    const pendingIn = (convId) => S.scheduled.filter((s) => s.conversationId === convId);

    // Thanh nhỏ trên ô nhập: "2 tin hẹn giờ · gần nhất 20:00 hôm nay"
    function renderBar() {
      const bar = $('#sched-bar');
      if (!bar) return;
      const list = state.currentId != null ? pendingIn(state.currentId) : [];
      if (!list.length) {
        bar.hidden = true;
        bar.replaceChildren();
        return;
      }
      const next = list[0];
      bar.replaceChildren(h('button', { class: 'sched-bar-main', type: 'button', onclick: () => navigate('#/scheduled') },
        icon('clock'),
        h('span', { class: 'sched-bar-text' },
          h('strong', { text: list.length > 1 ? `${list.length} tin hẹn giờ` : 'Tin hẹn giờ' }),
          h('span', { text: `${list.length > 1 ? 'Gần nhất ' : ''}${P.whenText(next.sendAt)}` })),
        h('span', { class: 'sched-bar-see', text: 'Xem' })));
      bar.hidden = false;
    }

    function renderScheduledSheet() {
      const ul = $('#scheduled-list');
      const list = state.currentId != null ? pendingIn(state.currentId) : [];
      if (!list.length) {
        ul.replaceChildren(h('li', { class: 'people-empty', text: 'Không còn tin nào đang chờ gửi trong cuộc trò chuyện này.' }));
        return;
      }
      ul.replaceChildren(...list.map((s) => h('li', { class: 'sched-row' },
        h('p', { class: 'sched-when' }, icon('clock'), h('span', { text: `${P.whenText(s.sendAt)} · ${P.untilText(s.sendAt) || 'đang gửi…'}` })),
        h('p', { class: 'sched-text' }, formulaNodes(s.text)),
        h('div', { class: 'sched-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', text: 'Gửi ngay', onclick: (e) => sendNow(s, e.currentTarget) }),
          h('button', { class: 'btn btn-sm btn-danger-quiet', type: 'button', text: 'Hủy', onclick: (e) => cancel(s, e.currentTarget) })))));
    }

    function sendNow(s, btn) {
      withBusy(btn, async () => {
        try {
          const { scheduled, message } = await api(`/api/scheduled/${s.id}/send`, { method: 'POST', body: {} });
          if (message) receive(message);
          onScheduled({ scheduled });
          if (state.currentId === s.conversationId) renderMessages({ toBottom: true });
          renderConvList();
          toast('Đã gửi.');
        } catch (err) {
          if (err.data && err.data.scheduled) onScheduled({ scheduled: err.data.scheduled });
          toast(err.message);
        }
      });
    }
    function cancel(s, btn) {
      if (!window.confirm('Hủy tin hẹn giờ này? Tin sẽ không được gửi.')) return;
      withBusy(btn, async () => {
        try {
          onScheduled(await api(`/api/scheduled/${s.id}`, { method: 'DELETE' }));
          toast('Đã hủy tin hẹn giờ.');
        } catch (err) {
          toast(err.message);
        }
      });
    }

    function onScheduled({ scheduled }) {
      S.scheduled = Array.isArray(scheduled) ? scheduled : [];
      S.loaded = true;
      renderBar();
      if (host.currentSheet() === 'scheduled') {
        if (pendingIn(state.currentId).length) renderScheduledSheet();
        else if (!S.leaving) {
          // Hết tin chờ: đóng bảng (một lần; kết quả API và sự kiện realtime có thể đến cùng lúc)
          S.leaving = true;
          goBack();
          setTimeout(() => { S.leaving = false; }, 800);
        }
      }
    }

    async function load() {
      try {
        onScheduled(await api('/api/scheduled'));
      } catch {
        /* mất mạng: lần kết nối sau tải lại */
      }
    }

    // Thẻ kèo đổi chữ theo giờ ("còn 25 phút" → "Đã diễn ra"): vẽ lại mỗi phút khi đang mở khung chat có kèo
    setInterval(() => {
      if (document.hidden || state.currentId == null) return;
      const list = state.msgs.get(state.currentId)?.list || [];
      if (list.some((m) => m.kind === 'event' && !m.deleted && m.event && !m.event.canceled && m.event.startsAt > Date.now() - 120000)) renderMessages({ preserve: true });
      if (pendingIn(state.currentId).length) renderBar();
    }, 60000);

    return {
      eventEl, rsvp, cancelEvent, renderEventForm, openSchedule, renderScheduleForm, renderScheduledSheet, renderBar, onScheduled, load,
      reset: () => {
        S.scheduled = [];
        S.loaded = false;
      },
    };
  }

  return { create };
})();
