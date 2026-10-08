/* Kèo và hẹn giờ gửi tin (2.16.0): phần dùng chung cho web và app — chữ hiển thị giờ hẹn, các lựa chọn giờ nhanh.
   Bản app: native/src/plans/core.ts (tests/plans.test.ts so khớp hai bản). Máy chủ: src/events.js, src/scheduled.js.
   Mọi giờ tính theo giờ của máy đang dùng. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlansCore = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  const WD_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const WD_LONG = ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'];
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (ts) => {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const startOfDay = (ts) => {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  /** Số ngày từ hôm nay tới ngày của ts (0 = hôm nay, 1 = ngày mai, -1 = hôm qua) */
  const dayDiff = (ts, now) => Math.round((startOfDay(ts) - startOfDay(now)) / 86400000);
  /** Mốc giờ h:m của ngày cách hôm nay `days` ngày */
  function at(now, days, h, m = 0) {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  /** "hôm nay", "ngày mai", "thứ Bảy 11/10" */
  function dayText(ts, now = Date.now()) {
    const diff = dayDiff(ts, now);
    if (diff === 0) return 'hôm nay';
    if (diff === 1) return 'ngày mai';
    if (diff === -1) return 'hôm qua';
    const d = new Date(ts);
    const year = d.getFullYear() !== new Date(now).getFullYear() ? `/${d.getFullYear()}` : '';
    return `${WD_LONG[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}${year}`;
  }
  /** "20:00 hôm nay", "08:00 ngày mai", "19:00 thứ Bảy 11/10" */
  const whenText = (ts, now = Date.now()) => `${hm(ts)} ${dayText(ts, now)}`;

  /** "còn 25 phút", "còn 1 giờ 20 phút", "còn 5 giờ", "còn 3 ngày" ("" nếu đã qua) */
  function untilText(ts, now = Date.now()) {
    const mins = Math.ceil((ts - now) / 60000);
    if (mins <= 0) return '';
    if (mins < 60) return `còn ${mins} phút`;
    const h = Math.floor(mins / 60);
    if (h < 3 && mins % 60) return `còn ${h} giờ ${mins % 60} phút`;
    if (h < 24) return `còn ${h} giờ`;
    return `còn ${Math.round(h / 24)} ngày`;
  }

  /** Ô lịch trên thẻ kèo: thứ, ngày, tháng */
  function dateBlock(ts) {
    const d = new Date(ts);
    return { wd: WD_SHORT[d.getDay()], day: String(d.getDate()), month: `Th${d.getMonth() + 1}` };
  }

  /** Trạng thái kèo: canceled (đã hủy), past (đã diễn ra), soon (còn dưới 1 tiếng), upcoming */
  function eventPhase(ev, now = Date.now()) {
    if (!ev) return 'past';
    if (ev.canceled) return 'canceled';
    if (ev.startsAt <= now) return 'past';
    return ev.startsAt - now <= 3600000 ? 'soon' : 'upcoming';
  }

  /** Giờ nhanh khi tạo kèo: tối nay, tối mai, thứ Bảy, Chủ nhật (bỏ mốc đã qua / trùng) */
  function eventPresets(now = Date.now()) {
    const dow = new Date(now).getDay();
    const toSat = (6 - dow + 7) % 7;
    const toSun = (7 - dow) % 7;
    // Thứ Bảy / Chủ nhật đã qua giờ thì lấy tuần sau
    const next = (days, h) => (at(now, days, h) < now + 30 * 60000 ? at(now, days + 7, h) : at(now, days, h));
    const list = [
      { label: 'Tối nay 20:00', at: at(now, 0, 20) },
      { label: 'Tối mai 19:00', at: at(now, 1, 19) },
      { label: 'Thứ Bảy 19:00', at: next(toSat, 19) },
      { label: 'Chủ nhật 9:00', at: next(toSun, 9) },
    ];
    return uniq(list, now + 30 * 60000);
  }

  /** Giờ nhanh khi hẹn giờ gửi tin: sau 1 tiếng, tối nay 20:00, sáng mai 8:00 */
  function schedulePresets(now = Date.now()) {
    const inHour = Math.ceil((now + 3600000) / 60000) * 60000;
    return uniq(
      [
        { label: 'Sau 1 tiếng', at: inHour },
        { label: 'Tối nay 20:00', at: at(now, 0, 20) },
        { label: 'Sáng mai 8:00', at: at(now, 1, 8) },
      ],
      now + 10 * 60000
    );
  }
  function uniq(list, after) {
    const seen = new Set();
    return list.filter((p) => {
      if (p.at < after || seen.has(p.at)) return false;
      seen.add(p.at);
      return true;
    });
  }

  /** Giá trị cho ô chọn ngày giờ (input datetime-local) và ngược lại */
  function toInput(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromInput(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value || ''));
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime() : null;
  }

  /** "An, Bình và 2 người khác" */
  function peopleText(names, max = 2) {
    if (!names.length) return '';
    if (names.length <= max + 1) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}`;
    return `${names.slice(0, max).join(', ')} và ${names.length - max} người khác`;
  }

  return { hm, dayText, whenText, untilText, dateBlock, eventPhase, eventPresets, schedulePresets, toInput, fromInput, peopleText, at };
});
