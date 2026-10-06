'use strict';
// Game Nông trại: lưu nông trại của từng người, API cho web và app, ghé vườn bạn bè, bảng xếp hạng.
// Luật chơi ở src/farm-logic.js, dữ liệu cây / món ăn ở src/farm-data.js.
const { db, get, all, run, transaction } = require('./db');
const L = require('./farm-logic');
const { weekStart } = require('./games');
const streaks = require('./streaks');

db.exec(`
  CREATE TABLE IF NOT EXISTS farms (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    coins INTEGER NOT NULL DEFAULT 0,
    week_start INTEGER NOT NULL DEFAULT 0,
    week_coins INTEGER NOT NULL DEFAULT 0,
    beauty INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_farms_xp ON farms(xp);
  CREATE INDEX IF NOT EXISTS idx_farms_week ON farms(week_start, week_coins);
`);

const CATALOG = L.catalog();
const CATALOG_VERSION = L.hash(JSON.stringify(CATALOG)).toString(36);
const TOP = 50;
// Chỉ khi chạy kiểm thử (THINK_FARM_TEST=1): cho tua nhanh thời gian và đặt sẵn xu / kinh nghiệm
const TEST = process.env.THINK_FARM_TEST === '1';
let clockOffset = 0;
const clock = () => Date.now() + clockOffset;
const PUSH_GAP = 10 * 60 * 1000; // mỗi chủ vườn nhận tối đa 1 thông báo "có người ghé vườn" mỗi 10 phút

/** Bổ sung trường mới cho nông trại lưu từ bản cũ */
function migrate(s) {
  if (!Array.isArray(s.decor)) s.decor = [];
  if (!s.week) s.week = { start: 0, coins: 0 };
  if (!s.stats) s.stats = {};
  for (const k of ['harvest', 'craft', 'orders', 'sold', 'earned', 'helps', 'steals']) if (typeof s.stats[k] !== 'number') s.stats[k] = 0;
  if (!s.stolenFrom) s.stolenFrom = {};
  if (!Array.isArray(s.log)) s.log = [];
  return s;
}

function load(uid) {
  const row = get('SELECT state FROM farms WHERE user_id = ?', uid);
  return row ? migrate(JSON.parse(row.state)) : null;
}

function save(uid, s, now) {
  const week = s.week && s.week.start === weekStart(now) ? s.week.coins : 0;
  run(
    `INSERT INTO farms (user_id, state, xp, coins, week_start, week_coins, beauty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, xp = excluded.xp, coins = excluded.coins,
       week_start = excluded.week_start, week_coins = excluded.week_coins, beauty = excluded.beauty, updated_at = excluded.updated_at`,
    uid, JSON.stringify(s), s.xp, s.coins, weekStart(now), week, L.beauty(s), s.created || now, now
  );
}

/** Nông trại của chính mình (đầy đủ) */
function ownView(s, now) {
  const info = L.levelInfo(s.xp);
  return {
    ...s,
    stolenFrom: undefined,
    level: info.level,
    xpCur: info.cur,
    xpNext: info.next,
    used: L.used(s),
    beauty: L.beauty(s),
    weekCoins: s.week && s.week.start === weekStart(now) ? s.week.coins : 0,
  };
}

function rateLimit(n, ms) {
  const hits = new Map();
  return (key) => {
    const now = clock();
    const list = (hits.get(key) || []).filter((t) => now - t < ms);
    if (list.length >= n) return false;
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

const OWN_ACTIONS = {
  plant: (s, a, now) => L.plant(s, a, now),
  harvest: (s, a, now) => L.harvest(s, a, now),
  clearBug: (s, a, now) => L.clearBug(s, a, now),
  craft: (s, a, now) => L.craft(s, a, now),
  collect: (s, a, now) => L.collect(s, a, now),
  build: (s, a) => L.build(s, a),
  addSlot: (s, a) => L.addSlot(s, a),
  buyPlot: (s) => L.buyPlot(s),
  upgradeStorage: (s) => L.upgradeStorage(s),
  buyDog: (s) => L.buyDog(s),
  buyDecor: (s, a) => L.buyDecor(s, a),
  sell: (s, a, now) => L.sell(s, a, now, weekStart(now)),
  deliver: (s, a, now) => L.deliver(s, a, now, Math.random, weekStart(now)),
  discard: (s, a, now) => L.discard(s, a, now),
  gift: (s, a, now) => L.claimGift(s, now),
};

function setupFarm({ app, io, requireAuth, requireReady, isActive, notify, nameOf }) {
  const auth = [requireAuth, requireReady];
  const perUser = rateLimit(240, 60 * 1000);
  const lastPush = new Map();

  const handle = (fn) => (req, res) => {
    try {
      if (req.method !== 'GET' && !perUser(req.user.id)) return res.status(429).json({ error: 'Bạn bấm nhanh quá, chờ chút nhé.' });
      fn(req, res);
    } catch (err) {
      if (err instanceof L.FarmError) return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Nông trại đang gặp lỗi, thử lại sau nhé.' });
    }
  };

  /** Lấy nông trại (tạo mới nếu chưa có), cập nhật ngày / đơn hàng */
  function mine(uid, now) {
    let s = load(uid);
    if (!s) {
      s = L.newFarm(now);
      save(uid, s, now);
      return s;
    }
    const before = JSON.stringify([s.day, s.orders.length]);
    L.tick(s, now);
    if (JSON.stringify([s.day, s.orders.length]) !== before) save(uid, s, now);
    return s;
  }

  const activeUser = (id) => get("SELECT id FROM users WHERE id = ? AND disabled = 0 AND role <> 'bot'", id);

  app.get('/api/farm', ...auth, handle((req, res) => {
    const now = clock();
    // peek=1 (thẻ ở trang Trò chơi): chưa có nông trại thì thôi, không tạo
    if (req.query.peek === '1' && !get('SELECT 1 FROM farms WHERE user_id = ?', req.user.id)) {
      return res.json({ now, catalogVersion: CATALOG_VERSION, farm: null });
    }
    const s = mine(req.user.id, now);
    const out = { now, catalogVersion: CATALOG_VERSION, farm: ownView(s, now), market: L.market(now) };
    if (req.query.cv !== CATALOG_VERSION) out.catalog = CATALOG;
    res.json(out);
  }));

  app.post('/api/farm/act', ...auth, handle((req, res) => {
    const now = clock();
    const body = req.body || {};
    const fn = OWN_ACTIONS[body.action];
    if (!fn) throw new L.FarmError(400, 'Hành động không hợp lệ.');
    let result;
    let s;
    transaction(() => {
      s = mine(req.user.id, now);
      result = fn(s, body, now);
      L.tick(s, now);
      save(req.user.id, s, now);
    });
    streaks.record(req.user.id, 'farm'); // chuỗi hằng ngày (src/streaks.js)
    res.json({ now, result, farm: ownView(s, now) });
  }));

  /** Danh sách vườn của mọi người (để ghé thăm) */
  app.get('/api/farm/friends', ...auth, handle((req, res) => {
    const now = clock();
    const rows = all(
      `SELECT f.user_id, f.state FROM farms f JOIN users u ON u.id = f.user_id
        WHERE u.disabled = 0 AND f.user_id != ? ORDER BY f.updated_at DESC LIMIT 100`,
      req.user.id
    );
    const friends = rows.map((r) => ({ userId: r.user_id, ...L.summary(migrate(JSON.parse(r.state)), now) }));
    res.json({ now, friends });
  }));

  app.get('/api/farm/u/:id', ...auth, handle((req, res) => {
    const now = clock();
    const id = Number(req.params.id);
    if (id === req.user.id) throw new L.FarmError(400, 'Đây là vườn của bạn.');
    if (!activeUser(id)) throw new L.FarmError(404, 'Không tìm thấy người này.');
    const s = load(id);
    if (!s) throw new L.FarmError(404, `${nameOf(id)} chưa có nông trại.`);
    res.json({ now, userId: id, farm: L.publicView(s, req.user.id, now) });
  }));

  /** Ghé vườn bạn: bắt sâu giúp hoặc hái trộm */
  app.post('/api/farm/u/:id/act', ...auth, handle((req, res) => {
    const now = clock();
    const id = Number(req.params.id);
    const me = req.user.id;
    const { action, plot } = req.body || {};
    if (id === me) throw new L.FarmError(400, 'Đây là vườn của bạn.');
    if (action !== 'help' && action !== 'steal') throw new L.FarmError(400, 'Hành động không hợp lệ.');
    if (!activeUser(id)) throw new L.FarmError(404, 'Không tìm thấy người này.');
    let result;
    let owner;
    let visitor;
    transaction(() => {
      owner = load(id);
      if (!owner) throw new L.FarmError(404, `${nameOf(id)} chưa có nông trại.`);
      visitor = mine(me, now);
      result =
        action === 'help'
          ? L.help(owner, visitor, { plot }, now, { helper: me, owner: id })
          : L.steal(owner, visitor, { plot }, now, Math.random, { thief: me, owner: id });
      save(id, owner, now);
      save(me, visitor, now);
    });
    streaks.record(me, 'farm');
    const type = action === 'help' ? 'help' : result.caught ? 'caught' : 'steal';
    const crop = L.CROP[owner.log[0] && owner.log[0].c] || null;
    io.to(`user:${id}`).emit('farm:event', { type, by: me, plot: Number(plot), item: crop && crop.id });
    // Báo cho chủ vườn (đang không mở app), tối đa 1 lần mỗi 10 phút
    if (!isActive(id) && now - (lastPush.get(id) || 0) > PUSH_GAP) {
      lastPush.set(id, now);
      const who = nameOf(me);
      const body =
        type === 'help'
          ? `${who} vừa bắt sâu giúp ruộng ${crop ? crop.name.toLowerCase() : ''} của bạn 🐛`
          : type === 'caught'
            ? `Chó nhà bạn vừa đuổi ${who} khỏi vườn, ${who} phải đền ${result.fine} xu 🐕`
            : `${who} vừa hái trộm ${crop ? crop.name.toLowerCase() : 'rau'} của bạn! 😤`;
      notify(id, { type: 'farm', title: 'Nông trại', body, tag: 'farm', url: '/#/farm' }).catch((err) => console.warn('[push]', err.message));
    }
    res.json({ now, result, farm: L.publicView(owner, me, now), me: ownView(visitor, now) });
  }));

  if (TEST) {
    app.post('/api/farm/test/advance', ...auth, (req, res) => {
      clockOffset += Number(req.body?.ms) || 0;
      res.json({ now: clock() });
    });
    app.post('/api/farm/test/set', ...auth, (req, res) => {
      const now = clock();
      const s = mine(req.user.id, now);
      for (const k of ['xp', 'coins', 'inv', 'dog']) if (req.body?.[k] !== undefined) s[k] = req.body[k];
      L.tick(s, now);
      save(req.user.id, s, now);
      res.json({ farm: ownView(s, now) });
    });
  }

  app.get('/api/farm/leaderboard', ...auth, handle((req, res) => {
    const now = clock();
    const ws = weekStart(now);
    const level = all(
      `SELECT f.user_id, f.xp, f.beauty FROM farms f JOIN users u ON u.id = f.user_id WHERE u.disabled = 0
        ORDER BY f.xp DESC, f.updated_at ASC LIMIT ?`,
      TOP
    ).map((r, i) => ({ rank: i + 1, userId: r.user_id, xp: r.xp, level: L.levelInfo(r.xp).level, beauty: r.beauty }));
    const week = all(
      `SELECT f.user_id, f.week_coins FROM farms f JOIN users u ON u.id = f.user_id
        WHERE u.disabled = 0 AND f.week_start = ? AND f.week_coins > 0 ORDER BY f.week_coins DESC LIMIT ?`,
      ws, TOP
    ).map((r, i) => ({ rank: i + 1, userId: r.user_id, coins: r.week_coins }));
    res.json({ now, weekStart: ws, level, week });
  }));
}

/** Cho trang Trò chơi / trang cá nhân: cấp nông trại của một người */
function farmLevelOf(uid) {
  const row = get('SELECT xp FROM farms WHERE user_id = ?', uid);
  return row ? L.levelInfo(row.xp).level : null;
}

module.exports = { setupFarm, farmLevelOf, CATALOG_VERSION };
