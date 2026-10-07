'use strict';
// Máy chủ STUN / TURN cho cuộc gọi (2.11.0). Tiếng và hình đi thẳng giữa hai máy; khi hai mạng không nối thẳng được
// (4G của nhà mạng, wifi công ty…) cuộc gọi phải đi vòng qua một máy chủ TURN — thiếu TURN là lý do hay gặp nhất
// khiến cuộc gọi kẹt ở "Đang kết nối…". Máy chủ Think (Render) không làm TURN được (Render chỉ mở cổng web).
//
// Nguồn TURN (dùng tất cả nguồn đang có):
//   1. Máy chủ TURN riêng nhập trong Quản trị (vd ExpressTURN, 1000 GB / tháng miễn phí): địa chỉ + tên + mật khẩu
//   2. Link lấy TURN của Metered (Open Relay, 20 GB / tháng miễn phí): https://<tên>.metered.live/api/v1/turn/credentials?apiKey=…
//   3. Cloudflare TURN (1000 GB / tháng miễn phí): Key ID + API token (Quản trị hoặc CF_TURN_KEY_ID / CF_TURN_API_TOKEN)
//   4. Biến môi trường TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL
//   5. Dự phòng khi chưa có nguồn nào: Open Relay dùng chung của Metered (staticauth, mật khẩu tạm tính bằng HMAC theo
//      cách "TURN REST API"; Metered công bố khóa chung này). Tiếng và hình vẫn được mã hóa đầu cuối (DTLS-SRTP),
//      máy chủ TURN chỉ chuyển gói tin, không nghe / xem được.
const crypto = require('node:crypto');
const { getSetting, setSetting } = require('./db');

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const OPEN_RELAY = {
  host: 'staticauth.openrelay.metered.ca',
  secret: 'openrelayprojectsecret', // khóa chung Metered công bố cho mọi người (không phải bí mật của Think)
};

class TurnError extends Error {}

const DEFAULTS = { turnUrls: '', turnUsername: '', turnCredential: '', meteredUrl: '', cfKeyId: '', cfToken: '', openRelay: true };

function settings() {
  const s = getSetting('calls', null);
  return { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
}

const splitUrls = (v) =>
  String(v || '')
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^turns?:[^\s]+$/i.test(u))
    .slice(0, 8);

/** Danh sách iceServers từ JSON của dịch vụ (mảng, hoặc { iceServers: mảng / một mục }) */
function normalize(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.iceServers) ? data.iceServers : data?.iceServers ? [data.iceServers] : [];
  return list
    .filter((s) => s && (typeof s.urls === 'string' || Array.isArray(s.urls)))
    .map((s) => ({ urls: s.urls, ...(s.username ? { username: String(s.username) } : {}), ...(s.credential ? { credential: String(s.credential) } : {}) }))
    .slice(0, 10);
}

const cache = new Map(); // khóa nguồn -> { at, servers, error }
async function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.servers;
  try {
    const servers = await load();
    cache.set(key, { at: Date.now(), servers, error: null });
    return servers;
  } catch (err) {
    console.warn(`[turn] ${key}:`, err.message);
    // Lỗi tạm thời: dùng bản cũ (nếu có), thử lại sau 1 phút
    cache.set(key, { at: Date.now() - ttl + 60_000, servers: hit?.servers || [], error: err.message });
    return hit?.servers || [];
  }
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return data;
}

function metered(url) {
  return cached(`metered:${url}`, 3600_000, async () => {
    const servers = normalize(await fetchJson(url));
    if (!servers.length) throw new Error('Link không trả về máy chủ TURN nào');
    return servers;
  });
}

function cloudflare(id, token) {
  return cached(`cf:${id}`, 6 * 3600_000, async () => {
    const data = await fetchJson(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 }),
    });
    const servers = normalize(data);
    if (!servers.length) throw new Error('Cloudflare không trả về máy chủ TURN nào');
    return servers;
  });
}

/** Mật khẩu tạm 24 giờ cho Open Relay (kiểu "TURN REST API": tên = thời hạn, mật khẩu = HMAC-SHA1 của tên) */
function openRelay(now = Date.now()) {
  const username = `${Math.floor(now / 1000) + 24 * 3600}:think`;
  const credential = crypto.createHmac('sha1', OPEN_RELAY.secret).update(username).digest('base64');
  return {
    urls: [`turn:${OPEN_RELAY.host}:80`, `turn:${OPEN_RELAY.host}:80?transport=tcp`, `turn:${OPEN_RELAY.host}:443?transport=tcp`],
    username,
    credential,
  };
}

/** Danh sách máy chủ STUN / TURN gửi cho máy người dùng, kèm tên các nguồn TURN đang dùng */
async function iceConfig() {
  const s = settings();
  const env = process.env;
  const out = [...STUN];
  const sources = [];
  const own = splitUrls(s.turnUrls);
  if (own.length) {
    out.push({ urls: own, username: s.turnUsername, credential: s.turnCredential });
    sources.push('máy chủ TURN riêng');
  }
  if (s.meteredUrl) {
    const list = await metered(s.meteredUrl);
    if (list.length) {
      out.push(...list);
      sources.push('Metered');
    }
  }
  const cfId = s.cfKeyId || env.CF_TURN_KEY_ID;
  const cfToken = s.cfKeyId ? s.cfToken : env.CF_TURN_API_TOKEN;
  if (cfId && cfToken) {
    const list = await cloudflare(cfId, cfToken);
    if (list.length) {
      out.push(...list);
      sources.push('Cloudflare');
    }
  }
  const envUrls = splitUrls(env.TURN_URLS);
  if (envUrls.length) {
    out.push({ urls: envUrls, username: env.TURN_USERNAME || '', credential: env.TURN_CREDENTIAL || '' });
    sources.push('biến môi trường');
  }
  if (!sources.length && s.openRelay !== false) {
    out.push(openRelay());
    sources.push('Open Relay (dùng chung)');
  }
  return { iceServers: out, sources };
}

async function iceServers() {
  return (await iceConfig()).iceServers;
}

function adminView() {
  const s = settings();
  let meteredHost = '';
  try {
    meteredHost = s.meteredUrl ? new URL(s.meteredUrl).host : '';
  } catch {
    meteredHost = '';
  }
  const errors = [];
  for (const [key, v] of cache) if (v.error) errors.push(`${key.startsWith('cf:') ? 'Cloudflare' : 'Metered'}: ${v.error}`);
  return {
    turnUrls: s.turnUrls || '',
    turnUsername: s.turnUsername || '',
    hasCredential: Boolean(s.turnCredential),
    meteredHost, // không trả lại cả link (có apiKey)
    cfKeyId: s.cfKeyId || '',
    hasCfToken: Boolean(s.cfToken),
    openRelay: s.openRelay !== false,
    envTurn: splitUrls(process.env.TURN_URLS).length > 0,
    cloudflare: Boolean(process.env.CF_TURN_KEY_ID && process.env.CF_TURN_API_TOKEN),
    errors,
  };
}

/** Admin lưu cài đặt TURN. Trường mật khẩu / token / link bỏ trống (undefined) = giữ nguyên, '' = xóa. */
function saveSettings(body = {}) {
  const s = settings();
  if (body.turnUrls !== undefined) {
    const raw = String(body.turnUrls || '').trim();
    const urls = splitUrls(raw);
    if (raw && !urls.length) throw new TurnError('Địa chỉ TURN phải bắt đầu bằng turn: hoặc turns: (vd turn:relay1.expressturn.com:3478).');
    s.turnUrls = urls.join(', ');
  }
  if (body.turnUsername !== undefined) s.turnUsername = String(body.turnUsername || '').trim().slice(0, 200);
  if (body.turnCredential !== undefined && body.turnCredential !== null) s.turnCredential = String(body.turnCredential).trim().slice(0, 300);
  if (!s.turnUrls) {
    s.turnUsername = '';
    s.turnCredential = '';
  }
  if (body.meteredUrl !== undefined && body.meteredUrl !== null) {
    const u = String(body.meteredUrl || '').trim();
    if (u && !/^https:\/\/[^\s]+$/i.test(u)) throw new TurnError('Link lấy TURN phải bắt đầu bằng https:// (vd https://tenban.metered.live/api/v1/turn/credentials?apiKey=…).');
    s.meteredUrl = u.slice(0, 500);
  }
  if (body.cfKeyId !== undefined) s.cfKeyId = String(body.cfKeyId || '').trim().slice(0, 100);
  if (body.cfToken !== undefined && body.cfToken !== null) s.cfToken = String(body.cfToken).trim().slice(0, 300);
  if (!s.cfKeyId) s.cfToken = '';
  if (body.openRelay !== undefined) s.openRelay = Boolean(body.openRelay);
  setSetting('calls', s);
  cache.clear();
  return adminView();
}

module.exports = { iceConfig, iceServers, adminView, saveSettings, openRelay, normalize, TurnError, STUN, OPEN_RELAY };
