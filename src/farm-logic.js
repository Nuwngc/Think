'use strict';
// Luật game Nông trại — các hàm thuần (không đụng database), máy chủ gọi trong src/farm.js.
// Trạng thái mỗi nông trại là một object (lưu thành JSON). Mọi hành động đều kiểm tra ở đây,
// web và app chỉ hiển thị và gửi yêu cầu, nên không ai gian lận xu được.
const D = require('./farm-data');

const R = D.RULES;
const MIN = 60 * 1000;
const DAY = 24 * 3600 * 1000;
const TZ = 7 * 3600 * 1000; // ngày tính theo giờ Việt Nam

class FarmError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (message, status = 400) => {
  throw new FarmError(status, message);
};

/* ---------------- Danh mục ---------------- */

const ITEMS = {};
for (const c of D.CROPS) ITEMS[c.id] = { ...c, kind: 'crop' };
for (const p of D.PRODUCTS) ITEMS[p.id] = { ...p };
const CROP = Object.fromEntries(D.CROPS.map((c) => [c.id, c]));
const PRODUCT = Object.fromEntries(D.PRODUCTS.map((p) => [p.id, p]));
const BUILDING = Object.fromEntries(D.BUILDINGS.map((b) => [b.id, b]));
const DECOR = Object.fromEntries(D.DECOR.map((d) => [d.id, d]));
const FOODS = D.PRODUCTS.filter((p) => p.kind === 'food');

/** Điểm kinh nghiệm cần để lên từ cấp `level` lên cấp sau */
const xpToNext = (level) => Math.round(10 * Math.pow(level, 2.4));

function levelInfo(xp) {
  let level = 1;
  let rest = Math.max(0, xp | 0);
  while (level < R.maxLevel && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, cur: rest, next: level < R.maxLevel ? xpToNext(level) : 0 };
}

const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
/** Giá mua ô đất thứ n (đếm từ 1) và cấp cần có */
const plotCost = (n) => round5(30 * Math.pow(1.22, n - R.startPlots - 1));
const plotLevel = (n) => 2 + Math.floor((n - R.startPlots - 1) / 2);
/** Giá nâng kho (đang chứa được `cap` món) */
const storageCost = (cap) => round5(80 * Math.pow(1.25, (cap - R.startStorage) / R.storageStep));
/** Giá thêm một chỗ xếp hàng cho chuồng / xưởng đang có `slots` chỗ */
const slotCost = (b, slots) => round5(BUILDING[b].cost * 0.6 * (slots - 1));
const orderSlots = (level) => (level >= 8 ? 6 : level >= 5 ? 5 : level >= 3 ? 4 : 3);

/* ---------------- Ngày, giá chợ ---------------- */

const dayKey = (t) => new Date(t + TZ).toISOString().slice(0, 10);

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Món hot hôm nay: bán ở chợ được giá gấp rưỡi */
const hotItem = (day) => FOODS[hash(`${day}:hot`) % FOODS.length].id;

/** Giá bán ở chợ trong ngày (giá gốc ±, món hot ×1,5) */
function priceOf(id, day) {
  const it = ITEMS[id];
  if (!it) return 0;
  const factor = 0.85 + (hash(`${day}:${id}`) % 1000) / 1000 * 0.35;
  const hot = hotItem(day) === id ? 1.5 : 1;
  return Math.max(1, Math.round(it.price * factor * hot));
}

function market(now) {
  const day = dayKey(now);
  const yesterday = dayKey(now - DAY);
  const prices = {};
  for (const id of Object.keys(ITEMS)) {
    const p = priceOf(id, day);
    const y = priceOf(id, yesterday);
    prices[id] = { price: p, trend: p > y ? 1 : p < y ? -1 : 0 };
  }
  return { day, hot: hotItem(day), prices };
}

/* ---------------- Trạng thái ---------------- */

const emptyPlot = () => ({ c: null, p: 0, r: 0, y: 0, b: 0, bd: false, st: 0 });

function newFarm(now, rng = Math.random) {
  const s = {
    v: 1,
    coins: R.startCoins,
    xp: 0,
    plots: Array.from({ length: R.startPlots }, emptyPlot),
    inv: { lua_mi: 4 },
    storage: R.startStorage,
    buildings: {},
    orders: [],
    orderSeq: 0,
    dog: false,
    decor: [],
    day: dayKey(now),
    helps: 0,
    steals: 0,
    stolenFrom: {},
    giftDay: '',
    giftStreak: 0,
    week: { start: 0, coins: 0 },
    log: [],
    stats: { harvest: 0, craft: 0, orders: 0, sold: 0, earned: 0, helps: 0, steals: 0 },
    created: now,
  };
  // Hai ô đầu đã có lúa mì chín sẵn: mở game là thu hoạch được ngay
  for (const i of [0, 1]) Object.assign(s.plots[i], { c: 'lua_mi', p: now - 3 * MIN, r: now, y: 2 });
  tick(s, now, rng);
  return s;
}

const level = (s) => levelInfo(s.xp).level;
const used = (s) => Object.values(s.inv).reduce((a, b) => a + b, 0);
const have = (s, id) => s.inv[id] || 0;

function addItem(s, id, n) {
  s.inv[id] = have(s, id) + n;
  if (s.inv[id] <= 0) delete s.inv[id];
}

function addCoins(s, n, earned = false, weekStart = 0) {
  s.coins += n;
  if (earned && n > 0) {
    s.stats.earned += n;
    if (s.week.start !== weekStart) s.week = { start: weekStart, coins: 0 };
    s.week.coins += n;
  }
}

/** Cộng kinh nghiệm, trả về danh sách cấp vừa lên (có thưởng xu) */
function addXp(s, n) {
  const before = level(s);
  s.xp += n;
  const after = level(s);
  const ups = [];
  for (let l = before + 1; l <= after; l++) {
    const bonus = R.levelUpCoins.base + R.levelUpCoins.perLevel * l;
    s.coins += bonus;
    ups.push({ level: l, coins: bonus, unlocks: unlocksAt(l) });
  }
  return ups;
}

/** Những thứ mở khóa ở cấp `l` */
function unlocksAt(l) {
  const out = [];
  for (const c of D.CROPS) if (c.level === l) out.push(c.id);
  for (const b of D.BUILDINGS) if (b.level === l) out.push(b.id);
  for (const p of D.PRODUCTS) if (p.level === l) out.push(p.id);
  for (const d of D.DECOR) if (d.level === l) out.push(d.id);
  if (R.dogLevel === l) out.push('dog');
  return out;
}

/** Sang ngày mới: đặt lại lượt giúp / hái trộm; bù đơn hàng còn thiếu */
function tick(s, now, rng = Math.random) {
  const day = dayKey(now);
  if (s.day !== day) {
    s.day = day;
    s.helps = 0;
    s.steals = 0;
    s.stolenFrom = {};
  }
  const want = orderSlots(level(s));
  while (s.orders.length < want) s.orders.push(makeOrder(s, now, rng));
  return s;
}

/* ---------------- Ruộng ---------------- */

const ripe = (pl, now) => pl.c != null && pl.r <= now;
const bugVisible = (pl, now) => pl.c != null && pl.b > 0 && !pl.bd && pl.b <= now;

/** Số sản phẩm thu được: bị sâu chưa bắt thì mất 1, bị hái trộm thì mất 1, ít nhất còn 1 */
function harvestUnits(pl) {
  let n = pl.y;
  if (pl.b > 0 && !pl.bd && pl.b <= pl.r) n -= 1;
  if (pl.st) n -= 1;
  return Math.max(1, n);
}

function plotsArg(s, plots) {
  const list = Array.isArray(plots) ? plots : [plots];
  const out = [...new Set(list.map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < s.plots.length);
  if (!out.length) fail('Chọn ô đất.');
  return out;
}

function plant(s, { plots, crop }, now, rng = Math.random) {
  const c = CROP[crop];
  if (!c) fail('Không có loại cây này.');
  if (level(s) < c.level) fail(`${c.name} mở ở cấp ${c.level}.`);
  const empty = plotsArg(s, plots).filter((i) => s.plots[i].c == null);
  if (!empty.length) fail('Ô đất này đang có cây.');
  const can = c.seed > 0 ? Math.min(empty.length, Math.floor(s.coins / c.seed)) : empty.length;
  if (can <= 0) fail(`Không đủ xu mua hạt ${c.name} (${c.seed} xu).`);
  const done = [];
  for (const i of empty.slice(0, can)) {
    const grow = c.min * MIN;
    const bug = c.min >= R.bugMinMinutes && rng() < R.bugChance ? now + Math.round(grow * (0.25 + 0.4 * rng())) : 0;
    s.plots[i] = { c: c.id, p: now, r: now + grow, y: c.yield + (rng() < R.bumperChance ? 1 : 0), b: bug, bd: false, st: 0 };
    done.push(i);
  }
  s.coins -= c.seed * done.length;
  return { planted: done, cost: c.seed * done.length, skipped: empty.length - done.length };
}

function harvest(s, { plots }, now) {
  const list = plots === 'all' ? s.plots.map((_, i) => i) : plotsArg(s, plots);
  const gained = {};
  const done = [];
  let xp = 0;
  let full = false;
  for (const i of list) {
    const pl = s.plots[i];
    if (!ripe(pl, now)) continue;
    const n = harvestUnits(pl);
    if (used(s) + n > s.storage) {
      full = true;
      break;
    }
    addItem(s, pl.c, n);
    gained[pl.c] = (gained[pl.c] || 0) + n;
    xp += n * CROP[pl.c].xp;
    s.stats.harvest += n;
    s.plots[i] = emptyPlot();
    done.push(i);
  }
  if (!done.length && !full) fail('Chưa có cây nào chín.');
  return { harvested: done, gained, xp, full, levelUps: addXp(s, xp) };
}

function clearBug(s, { plot }, now) {
  const i = plotsArg(s, plot)[0];
  const pl = s.plots[i];
  if (!bugVisible(pl, now)) fail('Ô này không có sâu.');
  pl.bd = true;
  return { plot: i, xp: 1, levelUps: addXp(s, 1) };
}

/* ---------------- Chuồng trại, xưởng ---------------- */

function needBuilding(s, id) {
  const b = s.buildings[id];
  if (!b) fail(`Bạn chưa có ${BUILDING[id] ? BUILDING[id].name : 'nơi này'}.`);
  return b;
}

/** Lấy các món đã xong (theo thứ tự) vào kho */
function collect(s, { building }, now) {
  const ids = building === 'all' ? Object.keys(s.buildings) : [building];
  const gained = {};
  let xp = 0;
  let full = false;
  for (const id of ids) {
    const b = needBuilding(s, id);
    while (b.q.length && b.q[0].e <= now) {
      const p = PRODUCT[b.q[0].id];
      if (used(s) + 1 > s.storage) {
        full = true;
        break;
      }
      addItem(s, p.id, 1);
      gained[p.id] = (gained[p.id] || 0) + 1;
      xp += p.xp;
      s.stats.craft += 1;
      b.q.shift();
    }
    // Món đang chờ phía sau được làm tiếp ngay (không phải đợi lấy hàng)
  }
  return { gained, xp, full, levelUps: addXp(s, xp) };
}

function craft(s, { building, product, count = 1 }, now) {
  const p = PRODUCT[product];
  if (!p || p.building !== building) fail('Không làm được món này ở đây.');
  if (level(s) < p.level) fail(`${p.name} mở ở cấp ${p.level}.`);
  const b = needBuilding(s, building);
  // Lấy luôn các món đã xong để có chỗ
  const auto = collect(s, { building }, now);
  const n = Math.max(1, Math.min(Number(count) || 1, R.maxSlots));
  let made = 0;
  for (let k = 0; k < n; k++) {
    if (b.q.length >= b.slots) break;
    if (!Object.entries(p.inputs).every(([id, q]) => have(s, id) >= q)) break;
    for (const [id, q] of Object.entries(p.inputs)) addItem(s, id, -q);
    const last = b.q[b.q.length - 1];
    const start = Math.max(now, last ? last.e : now);
    b.q.push({ id: p.id, s: start, e: start + p.min * MIN });
    made++;
  }
  if (!made) {
    if (b.q.length >= b.slots) fail(`${BUILDING[building].name} đang đầy hàng chờ.`);
    const miss = Object.entries(p.inputs)
      .filter(([id, q]) => have(s, id) < q)
      .map(([id, q]) => `${q - have(s, id)} ${ITEMS[id].name.toLowerCase()}`);
    fail(`Còn thiếu ${miss.join(', ')}.`);
  }
  return { made, collected: auto.gained, levelUps: auto.levelUps };
}

function build(s, { building }) {
  const b = BUILDING[building];
  if (!b) fail('Không có công trình này.');
  if (s.buildings[building]) fail(`Bạn đã có ${b.name}.`);
  if (level(s) < b.level) fail(`${b.name} mở ở cấp ${b.level}.`);
  if (s.coins < b.cost) fail(`Cần ${b.cost} xu để xây ${b.name}.`);
  s.coins -= b.cost;
  s.buildings[building] = { slots: R.startSlots, q: [] };
  return { built: building, cost: b.cost };
}

function addSlot(s, { building }) {
  const b = needBuilding(s, building);
  if (b.slots >= R.maxSlots) fail('Đã nâng tối đa.');
  const cost = slotCost(building, b.slots);
  if (s.coins < cost) fail(`Cần ${cost} xu.`);
  s.coins -= cost;
  b.slots += 1;
  return { slots: b.slots, cost };
}

/* ---------------- Mua sắm, chợ ---------------- */

function buyPlot(s) {
  const n = s.plots.length + 1;
  if (n > R.maxPlots) fail('Đã đủ ô đất tối đa.');
  if (level(s) < plotLevel(n)) fail(`Ô đất tiếp theo mở ở cấp ${plotLevel(n)}.`);
  const cost = plotCost(n);
  if (s.coins < cost) fail(`Cần ${cost} xu để mua ô đất.`);
  s.coins -= cost;
  s.plots.push(emptyPlot());
  return { plots: s.plots.length, cost };
}

function upgradeStorage(s) {
  if (s.storage >= R.maxStorage) fail('Kho đã rộng tối đa.');
  const cost = storageCost(s.storage);
  if (s.coins < cost) fail(`Cần ${cost} xu để nâng kho.`);
  s.coins -= cost;
  s.storage += R.storageStep;
  return { storage: s.storage, cost };
}

function buyDog(s) {
  if (s.dog) fail('Bạn đã có chó giữ vườn.');
  if (level(s) < R.dogLevel) fail(`Chó giữ vườn mở ở cấp ${R.dogLevel}.`);
  if (s.coins < R.dogCost) fail(`Cần ${R.dogCost} xu.`);
  s.coins -= R.dogCost;
  s.dog = true;
  return { cost: R.dogCost };
}

function buyDecor(s, { decor }) {
  const d = DECOR[decor];
  if (!d) fail('Không có món trang trí này.');
  if (!s.decor) s.decor = [];
  if (s.decor.includes(d.id)) fail(`Bạn đã có ${d.name}.`);
  if (level(s) < d.level) fail(`${d.name} mở ở cấp ${d.level}.`);
  if (s.coins < d.cost) fail(`Cần ${d.cost} xu.`);
  s.coins -= d.cost;
  s.decor.push(d.id);
  return { decor: d.id, cost: d.cost };
}

const beauty = (s) => (s.decor || []).reduce((a, id) => a + (DECOR[id] ? DECOR[id].beauty : 0), 0);

function sell(s, { item, qty }, now, weekStart = 0) {
  if (!ITEMS[item]) fail('Không có món này.');
  const n = Math.floor(Number(qty));
  if (!(n > 0)) fail('Số lượng không hợp lệ.');
  if (have(s, item) < n) fail(`Bạn chỉ có ${have(s, item)} ${ITEMS[item].name.toLowerCase()}.`);
  const price = priceOf(item, dayKey(now));
  addItem(s, item, -n);
  addCoins(s, price * n, true, weekStart);
  s.stats.sold += n;
  return { coins: price * n, price };
}

function claimGift(s, now) {
  const today = dayKey(now);
  if (s.giftDay === today) fail('Hôm nay bạn đã nhận quà rồi, mai quay lại nhé.');
  s.giftStreak = s.giftDay === dayKey(now - DAY) ? s.giftStreak + 1 : 1;
  s.giftDay = today;
  const coins = R.dailyGift[Math.min(s.giftStreak, R.dailyGift.length) - 1];
  s.coins += coins;
  return { coins, streak: s.giftStreak };
}

/* ---------------- Đơn hàng ---------------- */

/** Những món khách có thể đặt: cây đã mở, sản phẩm đã mở mà có chỗ làm */
function orderable(s) {
  const L = level(s);
  const crops = D.CROPS.filter((c) => c.level <= L).map((c) => c.id);
  const products = D.PRODUCTS.filter((p) => p.level <= L && p.kind !== 'feed' && s.buildings[p.building]).map((p) => p.id);
  return { crops, products };
}

function makeOrder(s, now, rng = Math.random, at = now) {
  const L = level(s);
  const { crops, products } = orderable(s);
  const pool = [...crops.map((id) => [id, 1]), ...products.map((id) => [id, 2.2])];
  const lines = Math.min(pool.length, rng() < 0.4 ? 1 : rng() < 0.67 ? 2 : 3);
  let who = Math.floor(rng() * D.CUSTOMERS.length);
  const items = [];
  const cat = D.CUSTOMERS[who].name === 'Mèo Mun';
  const catWants = ['sua', 'trung'].filter((id) => crops.includes(id) || products.includes(id));
  if (cat && catWants.length) {
    // Mèo Mun chỉ thích sữa với trứng
    items.push([catWants[Math.floor(rng() * catWants.length)], 1 + Math.floor(rng() * 3)]);
  } else {
    if (cat) who = (who + 1) % D.CUSTOMERS.length;
    const left = [...pool];
    for (let k = 0; k < lines && left.length; k++) {
      const total = left.reduce((a, [, w]) => a + w, 0);
      let r = rng() * total;
      let idx = 0;
      while (idx < left.length - 1 && r >= left[idx][1]) {
        r -= left[idx][1];
        idx++;
      }
      const [id] = left.splice(idx, 1)[0];
      const it = ITEMS[id];
      let qty;
      if (it.kind === 'crop') qty = it.price >= 40 ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * Math.min(7, 2 + L));
      else if (it.kind === 'food') qty = it.price >= 150 ? 1 : 1 + Math.floor(rng() * 2);
      else qty = 1 + Math.floor(rng() * 3);
      items.push([id, qty]);
    }
  }
  const value = items.reduce((a, [id, q]) => a + ITEMS[id].price * q, 0);
  const xpBase = items.reduce((a, [id, q]) => a + ITEMS[id].xp * q, 0);
  s.orderSeq += 1;
  return {
    id: s.orderSeq,
    who,
    items,
    coins: Math.round(value * (1.3 + rng() * 0.35)),
    xp: Math.ceil(xpBase * 1.5) + 1,
    at,
  };
}

function findOrder(s, id) {
  const i = s.orders.findIndex((o) => o.id === Number(id));
  if (i < 0) fail('Đơn hàng này không còn nữa.', 404);
  return i;
}

function deliver(s, { order }, now, rng = Math.random, weekStart = 0) {
  const i = findOrder(s, order);
  const o = s.orders[i];
  if (o.at > now) fail('Khách chưa tới.');
  const miss = o.items.filter(([id, q]) => have(s, id) < q);
  if (miss.length) fail(`Còn thiếu ${miss.map(([id, q]) => `${q - have(s, id)} ${ITEMS[id].name.toLowerCase()}`).join(', ')}.`);
  for (const [id, q] of o.items) addItem(s, id, -q);
  addCoins(s, o.coins, true, weekStart);
  s.stats.orders += 1;
  const ups = addXp(s, o.xp);
  s.orders[i] = makeOrder(s, now, rng, now + R.orderRefillMs);
  tick(s, now, rng);
  return { coins: o.coins, xp: o.xp, levelUps: ups };
}

function discard(s, { order }, now, rng = Math.random) {
  const i = findOrder(s, order);
  s.orders[i] = makeOrder(s, now, rng, now + R.orderDiscardMs);
  return { order: s.orders[i].id };
}

/* ---------------- Bạn bè: bắt sâu giúp, hái trộm ---------------- */

function pushLog(s, entry) {
  s.log.unshift(entry);
  if (s.log.length > 30) s.log.length = 30;
}

/** Bắt sâu giúp bạn: người giúp được xu và kinh nghiệm */
function help(owner, helper, { plot }, now, ids) {
  tick(helper, now);
  const i = plotsArg(owner, plot)[0];
  const pl = owner.plots[i];
  if (!bugVisible(pl, now)) fail('Ô này không có sâu.');
  if (helper.helps >= R.helpsPerDay) fail(`Hôm nay bạn đã giúp đủ ${R.helpsPerDay} lần, mai giúp tiếp nhé.`);
  pl.bd = true;
  helper.helps += 1;
  helper.stats.helps += 1;
  helper.coins += R.helpCoins;
  const ups = addXp(helper, R.helpXp);
  pushLog(owner, { t: now, type: 'help', by: ids.helper, c: pl.c });
  return { plot: i, coins: R.helpCoins, xp: R.helpXp, levelUps: ups };
}

/** Hái trộm 1 sản phẩm ở ô đã chín của bạn (mỗi ô chỉ mất tối đa 1). Có chó giữ vườn thì có thể bị bắt. */
function steal(owner, thief, { plot }, now, rng = Math.random, ids) {
  tick(thief, now);
  const i = plotsArg(owner, plot)[0];
  const pl = owner.plots[i];
  if (!ripe(pl, now)) fail('Cây chưa chín, chưa hái được.');
  if (pl.st) fail('Ô này đã bị hái trộm rồi, để lại cho chủ vườn chút chứ!');
  if (harvestUnits(pl) < 2) fail('Ô này còn ít quá, không nỡ hái.');
  if (thief.steals >= R.stealsPerDay) fail(`Hôm nay bạn đã hái trộm đủ ${R.stealsPerDay} lần rồi.`);
  const key = String(ids.owner);
  if ((thief.stolenFrom[key] || 0) >= R.stealsPerFarmPerDay) fail('Hôm nay bạn đã hái trộm vườn này đủ rồi.');
  if (used(thief) + 1 > thief.storage) fail('Kho của bạn đầy rồi.');
  thief.steals += 1;
  thief.stolenFrom[key] = (thief.stolenFrom[key] || 0) + 1;
  if (owner.dog && rng() < R.dogCatch) {
    const fine = Math.min(R.dogFine, Math.max(0, thief.coins));
    thief.coins -= fine;
    owner.coins += fine;
    pushLog(owner, { t: now, type: 'caught', by: ids.thief, c: pl.c, coins: fine });
    return { caught: true, fine };
  }
  pl.st = ids.thief;
  addItem(thief, pl.c, 1);
  thief.stats.steals += 1;
  const ups = addXp(thief, CROP[pl.c].xp);
  pushLog(owner, { t: now, type: 'steal', by: ids.thief, c: pl.c });
  return { caught: false, item: pl.c, levelUps: ups };
}

/* ---------------- Cho người khác xem ---------------- */

/** Vườn của bạn bè (không lộ kho, xu, đơn hàng) */
function publicView(s, viewerId, now) {
  return {
    level: level(s),
    dog: s.dog,
    decor: s.decor || [],
    plots: s.plots.map((pl) => ({
      c: pl.c,
      p: pl.p,
      r: pl.r,
      bug: bugVisible(pl, now),
      st: pl.st ? (pl.st === viewerId ? 'me' : 'other') : null,
      canSteal: ripe(pl, now) && !pl.st && harvestUnits(pl) >= 2,
    })),
    buildings: Object.fromEntries(Object.entries(s.buildings).map(([id, b]) => [id, { slots: b.slots, busy: b.q.length }])),
  };
}

/** Tóm tắt cho danh sách bạn bè */
function summary(s, now) {
  let ripeN = 0;
  let stealable = 0;
  let bugs = 0;
  for (const pl of s.plots) {
    if (ripe(pl, now)) ripeN++;
    if (ripe(pl, now) && !pl.st && harvestUnits(pl) >= 2) stealable++;
    if (bugVisible(pl, now)) bugs++;
  }
  return { level: level(s), xp: s.xp, ripe: ripeN, stealable, bugs, dog: s.dog, beauty: beauty(s), plots: s.plots.length };
}

/** Bộ dữ liệu gửi cho web / app */
function catalog() {
  return {
    crops: D.CROPS,
    buildings: D.BUILDINGS,
    products: D.PRODUCTS,
    decor: D.DECOR,
    customers: D.CUSTOMERS,
    rules: {
      startPlots: R.startPlots,
      startStorage: R.startStorage,
      startSlots: R.startSlots,
      maxPlots: R.maxPlots,
      maxStorage: R.maxStorage,
      storageStep: R.storageStep,
      maxSlots: R.maxSlots,
      maxLevel: R.maxLevel,
      dogLevel: R.dogLevel,
      dogCost: R.dogCost,
      dogCatch: R.dogCatch,
      dogFine: R.dogFine,
      helpCoins: R.helpCoins,
      helpsPerDay: R.helpsPerDay,
      stealsPerDay: R.stealsPerDay,
      stealsPerFarmPerDay: R.stealsPerFarmPerDay,
      dailyGift: R.dailyGift,
    },
    xpTable: Array.from({ length: R.maxLevel }, (_, i) => xpToNext(i + 1)),
    plotCosts: Array.from({ length: R.maxPlots - R.startPlots }, (_, k) => ({ n: R.startPlots + k + 1, cost: plotCost(R.startPlots + k + 1), level: plotLevel(R.startPlots + k + 1) })),
    storageCosts: Array.from({ length: (R.maxStorage - R.startStorage) / R.storageStep }, (_, k) => storageCost(R.startStorage + k * R.storageStep)),
    slotCosts: Object.fromEntries(D.BUILDINGS.map((b) => [b.id, Array.from({ length: R.maxSlots - R.startSlots }, (_, k) => slotCost(b.id, R.startSlots + k))])),
  };
}

module.exports = {
  FarmError,
  ITEMS,
  CROP,
  PRODUCT,
  BUILDING,
  DECOR,
  MIN,
  xpToNext,
  levelInfo,
  plotCost,
  plotLevel,
  storageCost,
  slotCost,
  orderSlots,
  dayKey,
  hash,
  hotItem,
  priceOf,
  market,
  newFarm,
  level,
  used,
  tick,
  ripe,
  bugVisible,
  harvestUnits,
  plant,
  harvest,
  clearBug,
  collect,
  craft,
  build,
  addSlot,
  buyPlot,
  upgradeStorage,
  buyDog,
  buyDecor,
  beauty,
  sell,
  claimGift,
  makeOrder,
  deliver,
  discard,
  help,
  steal,
  publicView,
  summary,
  catalog,
  unlocksAt,
};
