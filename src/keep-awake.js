'use strict';
// Giữ máy chủ thức khi còn việc hẹn giờ (2.16.0).
// Gói Free của Render cho máy chủ ngủ sau 15 phút không có ai truy cập; đang ngủ thì không gửi được tin hẹn giờ
// hay lời nhắc kèo. Khi còn việc đến hạn trong HORIZON tới, máy chủ tự gọi địa chỉ công khai của mình
// (RENDER_EXTERNAL_URL, Render tự đặt) mỗi 10 phút để không bị cho ngủ. Hết việc thì thôi, máy chủ ngủ như cũ.
// Tắt hẳn bằng biến môi trường KEEP_AWAKE=0.
const EVERY = 10 * 60_000;
const HORIZON = 3 * 86400_000;

function setupKeepAwake({ nextDue, url = process.env.RENDER_EXTERNAL_URL, every = EVERY, horizon = HORIZON, ping } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const enabled = Boolean(base) && process.env.KEEP_AWAKE !== '0';
  const doPing = ping || ((target) => fetch(target, { signal: AbortSignal.timeout(20_000) }));
  /** Còn việc trong khoảng HORIZON tới thì gọi chính mình. Trả về true nếu đã gọi */
  async function tick(now = Date.now()) {
    if (!enabled) return false;
    const due = nextDue();
    if (!due || due - now > horizon) return false;
    try {
      await doPing(`${base}/api/config`);
    } catch {
      /* mạng chập chờn: lần sau gọi lại */
    }
    return true;
  }
  if (enabled) setInterval(tick, every).unref();
  return { tick, enabled };
}

module.exports = { setupKeepAwake };
