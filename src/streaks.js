'use strict';
// Chuỗi hằng ngày cho mọi game: mỗi ngày (giờ Việt Nam) có chơi một game thì chuỗi của game đó tăng 1,
// bỏ một ngày là chuỗi về 0. Có thêm "chuỗi chơi game" chung (ngày nào chơi game bất kỳ cũng tính).
//
// QUY TẮC: game nào cũng phải có chuỗi. Thêm game mới thì:
//   1. Thêm vào GAMES bên dưới (cùng mã với thẻ game ở public/games-ui.js và native/src/games/registry.ts).
//   2. Game chạy trên máy chủ: gọi streaks.record(userId, '<mã game>') mỗi khi người chơi thật sự chơi (đi nước, thao tác…).
//      Game chạy trên máy (chơi được khi mất mạng): đặt client: true, phía web gọi ThinkStreaks.mark('<mã>', uid),
//      phía app gọi markPlayed('<mã>') — ngày chơi tự gửi lên POST /api/streaks/played khi có mạng.
//   3. Thẻ game ở trang Trò chơi tự hiện huy hiệu chuỗi (test/streaks.test.js kiểm tra đủ cả web và app).
const { db, get, all, run } = require('./db');

const GAMES = [
  { id: 'farm', name: 'Nông trại', client: false },
  { id: 'blocks', name: 'Xếp Khối', client: true },
  { id: 'chess', name: 'Cờ vua', client: false },
  { id: 'caro', name: 'Cờ caro', client: true },
];
const GAME = Object.fromEntries(GAMES.map((g) => [g.id, g]));
/** Các mốc được chúc mừng */
const MILESTONES = [3, 7, 14, 30, 50, 100, 150, 200, 365, 500, 1000];
const TZ = 7 * 3600 * 1000;
const DAY = 86400000;
const BACKFILL_DAYS = 7; // ngày chơi lúc mất mạng gửi lên muộn: nhận trong vòng 7 ngày
const REMIND_FROM = 20; // nhắc giữ chuỗi từ 20 giờ…
const REMIND_TO = 23; // …tới 23 giờ (giờ Việt Nam)

db.exec(`
  CREATE TABLE IF NOT EXISTS streak_days (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    day TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, game, day)
  );
  CREATE INDEX IF NOT EXISTS idx_streak_days_day ON streak_days(day);
  CREATE TABLE IF NOT EXISTS streak_prefs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    remind INTEGER NOT NULL DEFAULT 1,
    reminded_day TEXT
  );
`);

/* ---------------- Ngày (giờ Việt Nam), dạng 2026-10-02 ---------------- */

const dayKey = (t = Date.now()) => new Date(t + TZ).toISOString().slice(0, 10);
/** Ngày có thật dạng YYYY-MM-DD (loại cả 2026-02-30) */
const isDay = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Thứ trong tuần của một ngày: 0 = thứ Hai … 6 = Chủ nhật */
const weekday = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/**
 * Chuỗi từ tập ngày đã chơi.
 * current: số ngày liên tiếp tính tới hôm nay (hôm nay chưa chơi thì tính tới hôm qua — chuỗi vẫn còn, chơi hôm nay để giữ)
 * week: 7 ngày gần nhất (cũ → mới, ngày cuối là hôm nay)
 */
function streakOf(days, today) {
  const set = days instanceof Set ? days : new Set(days);
  const playedToday = set.has(today);
  let current = 0;
  let d = playedToday ? today : addDays(today, -1);
  while (set.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of [...set].filter(isDay).sort()) {
    run = prev && addDays(prev, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    prev = day;
  }
  const week = [];
  for (let k = 6; k >= 0; k--) week.push(set.has(addDays(today, -k)));
  return {
    current,
    best: Math.max(best, current),
    today: playedToday,
    atRisk: !playedToday && current > 0,
    week,
    last: prev,
  };
}

/** Mốc vừa đạt được khi chuỗi lên `current` (null nếu không phải mốc) */
const milestoneOf = (current) => (MILESTONES.includes(current) ? current : null);

/** Tổng hợp chuỗi của một người: từng game + chuỗi chung */
function summaryOf(uid, now = Date.now()) {
  const today = dayKey(now);
  const rows = all('SELECT game, day FROM streak_days WHERE user_id = ?', uid);
  const byGame = new Map(GAMES.map((g) => [g.id, new Set()]));
  const any = new Set();
  for (const r of rows) {
    if (byGame.has(r.game)) byGame.get(r.game).add(r.day);
    any.add(r.day);
  }
  const pref = get('SELECT remind FROM streak_prefs WHERE user_id = ?', uid);
  return {
    today,
    weekStartDay: weekday(addDays(today, -6)),
    games: GAMES.map((g) => ({ id: g.id, name: g.name, ...streakOf(byGame.get(g.id), today) })),
    overall: streakOf(any, today),
    remind: pref ? Boolean(pref.remind) : true,
    milestones: MILESTONES,
  };
}

/* ---------------- Ghi nhận ngày chơi ---------------- */

let ioRef = null;

/**
 * Ghi nhận người chơi đã chơi `game` vào ngày của thời điểm `t` (mặc định: bây giờ).
 * Gọi bao nhiêu lần trong ngày cũng được (chỉ lần đầu mỗi ngày mới ghi và báo).
 * Trả về { added, summary } — summary chỉ có khi vừa ghi ngày mới.
 */
function record(uid, game, t = Date.now(), now = Date.now()) {
  if (!GAME[game] || !Number.isInteger(uid)) return { added: false };
  return recordDays(uid, game, [dayKey(t)], now);
}

/** Ghi nhiều ngày chơi một lúc (game chạy trên máy gửi lên, kể cả ngày chơi lúc mất mạng). Không bao giờ ném lỗi. */
function recordDays(uid, game, days, now = Date.now()) {
  try {
    return recordDaysUnsafe(uid, game, days, now);
  } catch (err) {
    // Chuỗi hỏng cũng không được làm hỏng thao tác chính của game (nước cờ, điểm Xếp Khối…)
    console.warn('[streaks]', err.message);
    return { added: false };
  }
}

function recordDaysUnsafe(uid, game, days, now) {
  if (!GAME[game] || !Number.isInteger(uid)) return { added: false };
  const today = dayKey(now);
  const oldest = addDays(today, -BACKFILL_DAYS);
  const fresh = [];
  for (const raw of new Set(days)) {
    // Ngày "tương lai" (đồng hồ điện thoại chạy nhanh / để sai ngày): đang chơi lúc này, tính là hôm nay
    const day = isDay(raw) && raw > today ? today : raw;
    if (!isDay(day) || day > today || day < oldest || fresh.includes(day)) continue;
    const r = run('INSERT OR IGNORE INTO streak_days (user_id, game, day, created_at) VALUES (?, ?, ?, ?)', uid, game, day, now);
    if (r.changes) fresh.push(day);
  }
  if (!fresh.length) return { added: false };
  const summary = summaryOf(uid, now);
  const g = summary.games.find((x) => x.id === game);
  const isToday = fresh.includes(today);
  // Hôm nay vừa chơi game này lần đầu: chuỗi vừa tăng (chúc mừng nếu đúng mốc)
  const event = {
    game,
    name: GAME[game].name,
    days: fresh,
    isToday,
    current: g.current,
    best: g.best,
    milestone: isToday ? milestoneOf(g.current) : null,
    overallMilestone: isToday && !anyOtherToday(summary, game) ? milestoneOf(summary.overall.current) : null,
    summary,
  };
  if (ioRef) ioRef.to(`user:${uid}`).emit('streak:update', event);
  return { added: true, event, summary };
}

// Chuỗi chung chỉ tăng ở game đầu tiên chơi trong ngày
const anyOtherToday = (summary, game) => summary.games.some((g) => g.id !== game && g.today);

/* ---------------- Nhắc giữ chuỗi buổi tối ---------------- */

function reminderText(summary) {
  const risky = summary.games.filter((g) => g.atRisk && g.current >= 2).sort((a, b) => b.current - a.current);
  if (!risky.length) return null;
  const [top, ...rest] = risky;
  const more = rest.length ? ` và chuỗi ${rest.map((g) => `${g.current} ngày ${g.name}`).join(', ')}` : '';
  return `Chuỗi ${top.current} ngày ${top.name}${more} sẽ mất nếu hôm nay bạn không chơi. Vào chơi một chút nhé!`;
}

/**
 * Độ lệch đồng hồ điện thoại so với máy chủ (ms, cộng vào giờ điện thoại để ra giờ máy chủ).
 * `clientNow` = giờ điện thoại lúc gửi. Không gửi, hoặc lệch quá 30 ngày (không tin): null.
 */
function clockSkew(clientNow, serverNow = Date.now()) {
  const cn = Number(clientNow);
  return Number.isFinite(cn) && cn > 0 && Math.abs(serverNow - cn) < 30 * DAY ? serverNow - cn : null;
}

/**
 * Ngày chơi máy gửi lên. Bản mới gửi plays: [{ day, t }] (t = lúc chơi theo đồng hồ điện thoại) và now (đồng hồ
 * điện thoại lúc gửi): máy chủ tự trừ độ lệch đồng hồ rồi mới tính ngày theo giờ Việt Nam, nên điện thoại để sai
 * ngày giờ vẫn tính đúng. Bản cũ chỉ gửi days.
 */
function playedDays(body, serverNow = Date.now()) {
  if (Array.isArray(body?.plays)) {
    // Đồng hồ điện thoại không tin được: dùng ngày máy gửi
    const skew = clockSkew(body.now, serverNow);
    return body.plays.slice(0, 20).map((x) => {
      const t = Number(x?.t);
      return skew != null && Number.isFinite(t) && t > 0 ? dayKey(Math.min(t + skew, serverNow)) : String(x?.day ?? '');
    });
  }
  return Array.isArray(body?.days) ? body.days.slice(0, 20).map(String) : [dayKey(serverNow)];
}

function setupStreaks({ app, io, requireAuth, requireReady, isActive, notify }) {
  ioRef = io;
  const auth = [requireAuth, requireReady];
  const handle = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Máy chủ gặp lỗi. Thử lại sau ít phút.' });
    }
  };

  app.get('/api/streaks', ...auth, handle((req, res) => res.json(summaryOf(req.user.id))));

  // Game chạy trên máy (Xếp Khối, cờ caro với máy…) gửi các ngày đã chơi, kể cả ngày chơi lúc mất mạng
  app.post('/api/streaks/played', ...auth, handle((req, res) => {
    const game = String(req.body?.game || '');
    if (!GAME[game] || !GAME[game].client) return res.status(400).json({ error: 'Game này không gửi ngày chơi từ máy.' });
    const out = recordDays(req.user.id, game, playedDays(req.body));
    res.json(out.summary || summaryOf(req.user.id));
  }));

  app.post('/api/streaks/prefs', ...auth, handle((req, res) => {
    const remind = req.body?.remind ? 1 : 0;
    run(
      `INSERT INTO streak_prefs (user_id, remind) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET remind = excluded.remind`,
      req.user.id, remind
    );
    res.json(summaryOf(req.user.id));
  }));

  // Buổi tối, ai sắp mất chuỗi (từ 2 ngày trở lên) mà chưa chơi thì nhắc một lần
  let reminding = false;
  async function remindAll(now = Date.now()) {
    const hour = new Date(now + TZ).getUTCHours();
    if (hour < REMIND_FROM || hour >= REMIND_TO || reminding) return 0;
    reminding = true;
    try {
      const today = dayKey(now);
      // Thông báo hết hạn lúc nửa đêm (máy tắt tới sáng mai thì thôi, khỏi nhắc chuỗi đã mất)
      const ttl = Math.max(60, Math.floor((Date.parse(`${addDays(today, 1)}T00:00:00Z`) - (now + TZ)) / 1000));
      const users = all(
        `SELECT DISTINCT d.user_id FROM streak_days d JOIN users u ON u.id = d.user_id
          LEFT JOIN streak_prefs p ON p.user_id = d.user_id
          WHERE d.day = ? AND u.disabled = 0 AND COALESCE(p.remind, 1) = 1 AND COALESCE(p.reminded_day, '') != ?`,
        addDays(today, -1), today
      );
      let sent = 0;
      for (const { user_id: uid } of users) {
        const body = reminderText(summaryOf(uid, now));
        if (!body || (isActive && isActive(uid))) continue;
        // Giữ chỗ trước khi gửi: mỗi người chỉ được nhắc một lần mỗi ngày
        const claim = run(
          `INSERT INTO streak_prefs (user_id, reminded_day) VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET reminded_day = excluded.reminded_day
           WHERE COALESCE(streak_prefs.reminded_day, '') != excluded.reminded_day AND streak_prefs.remind = 1`,
          uid, today
        );
        if (!claim.changes) continue;
        sent++;
        if (notify) {
          await Promise.resolve(notify(uid, { type: 'streak', title: '🔥 Giữ chuỗi nhé', body, tag: 'streak', url: '/#/games', ttl }))
            .catch((err) => console.warn('[push]', err.message));
        }
      }
      return sent;
    } finally {
      reminding = false;
    }
  }
  const timer = setInterval(() => remindAll().catch((err) => console.warn('[streaks]', err.message)), 10 * 60 * 1000);
  if (timer.unref) timer.unref();
  return { remindAll };
}

module.exports = {
  GAMES,
  MILESTONES,
  setupStreaks,
  record,
  recordDays,
  playedDays,
  clockSkew,
  summaryOf,
  streakOf,
  dayKey,
  addDays,
  weekday,
  milestoneOf,
  reminderText,
};
