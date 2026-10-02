'use strict';
// Kiểm thử luật game Nông trại (chạy: npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/farm-logic');
const D = require('../src/farm-data');

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 5, 3, 0); // 10 giờ sáng giờ Việt Nam
const fixed = (...vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};
const never = () => 0.99; // không sâu, không được mùa
const fresh = () => L.newFarm(T0, never);
const rich = (s, coins = 100000, xp = 0) => {
  s.coins = coins;
  s.xp = xp;
  return s;
};
const xpFor = (level) => {
  let t = 0;
  for (let l = 1; l < level; l++) t += L.xpToNext(l);
  return t;
};

test('dữ liệu: mọi công thức dùng nguyên liệu có thật, mở trước hoặc cùng cấp', () => {
  const ids = new Set();
  for (const x of [...D.CROPS, ...D.PRODUCTS, ...D.BUILDINGS, ...D.DECOR]) {
    assert.ok(!ids.has(x.id), `trùng mã ${x.id}`);
    ids.add(x.id);
    assert.ok(x.emoji && x.name, x.id);
  }
  for (const p of D.PRODUCTS) {
    assert.ok(L.BUILDING[p.building], p.id);
    assert.ok(L.BUILDING[p.building].level <= p.level, `${p.id}: nơi làm mở muộn hơn món`);
    let cost = 0;
    for (const [id, q] of Object.entries(p.inputs)) {
      assert.ok(L.ITEMS[id], `${p.id} cần ${id}`);
      assert.ok(L.ITEMS[id].level <= p.level, `${p.id}: ${id} mở muộn hơn`);
      cost += L.ITEMS[id].price * q;
    }
    assert.ok(p.price > cost, `${p.id} bán phải lời hơn nguyên liệu`);
  }
  for (const c of D.CROPS) assert.ok(c.yield * c.price > c.seed, `${c.id} trồng phải có lời`);
});

test('nông trại mới: 6 ô, 2 ô lúa mì chín sẵn, 3 đơn hàng', () => {
  const s = fresh();
  assert.equal(s.plots.length, 6);
  assert.equal(s.coins, D.RULES.startCoins);
  assert.equal(s.plots.filter((p) => L.ripe(p, T0)).length, 2);
  assert.equal(s.orders.length, 3);
  for (const o of s.orders) for (const [id] of o.items) assert.ok(['lua_mi', 'rau_cai'].includes(id), id);
});

test('thu hoạch, trồng, chờ cây lớn', () => {
  const s = fresh();
  const h = L.harvest(s, { plots: 'all' }, T0);
  assert.deepEqual(h.gained, { lua_mi: 4 });
  assert.equal(s.inv.lua_mi, 8);
  assert.equal(h.xp, 4);
  assert.throws(() => L.harvest(s, { plots: 'all' }, T0), /Chưa có cây nào chín/);
  // Lúa mì miễn phí, rau cải 2 xu
  const coins = s.coins;
  L.plant(s, { plots: [0, 1], crop: 'lua_mi' }, T0, never);
  assert.equal(s.coins, coins);
  L.plant(s, { plots: [2], crop: 'rau_cai' }, T0, never);
  assert.equal(s.coins, coins - 2);
  assert.throws(() => L.plant(s, { plots: [2], crop: 'lua_mi' }, T0, never), /đang có cây/);
  assert.throws(() => L.plant(s, { plots: [3], crop: 'xoai' }, T0, never), /mở ở cấp 14/);
  assert.throws(() => L.harvest(s, { plots: [0] }, T0 + 2 * MIN), /Chưa có cây nào chín/);
  const h2 = L.harvest(s, { plots: [0, 1, 2] }, T0 + 3 * MIN);
  assert.deepEqual(h2.harvested, [0, 1]);
  const h3 = L.harvest(s, { plots: 'all' }, T0 + 5 * MIN);
  assert.deepEqual(h3.gained, { rau_cai: 2 });
});

test('không đủ xu: trồng được bao nhiêu thì trồng', () => {
  const s = rich(fresh(), 5, xpFor(2));
  const r = L.plant(s, { plots: [2, 3, 4], crop: 'bap' }, T0, never);
  assert.equal(r.planted.length, 1);
  assert.equal(r.skipped, 2);
  assert.equal(s.coins, 1);
  assert.throws(() => L.plant(s, { plots: [5], crop: 'bap' }, T0, never), /Không đủ xu/);
});

test('sâu làm mất 1 sản phẩm, bắt sâu thì không mất; được mùa thêm 1', () => {
  const s = rich(fresh(), 1000, xpFor(5));
  // rng: lần 1 < 0.22 → có sâu; lần 2 → thời điểm sâu; lần 3 → không được mùa
  L.plant(s, { plots: [2], crop: 'ca_rot' }, T0, fixed(0.1, 0.5, 0.99));
  const pl = s.plots[2];
  assert.ok(pl.b > T0 && pl.b < pl.r);
  assert.equal(L.bugVisible(pl, T0), false);
  assert.equal(L.bugVisible(pl, pl.b), true);
  assert.equal(L.harvestUnits(pl), 1);
  L.plant(s, { plots: [3], crop: 'ca_rot' }, T0, fixed(0.1, 0.5, 0.99));
  L.clearBug(s, { plot: 3 }, s.plots[3].b);
  assert.equal(L.harvestUnits(s.plots[3]), 2);
  assert.throws(() => L.clearBug(s, { plot: 3 }, s.plots[3].b), /không có sâu/);
  L.plant(s, { plots: [4], crop: 'ca_rot' }, T0, fixed(0.9, 0.05));
  assert.equal(s.plots[4].y, 3);
  const h = L.harvest(s, { plots: [2, 3, 4] }, T0 + 30 * MIN);
  assert.deepEqual(h.gained, { ca_rot: 6 });
});

test('kho đầy thì dừng thu hoạch', () => {
  const s = fresh();
  s.inv = { rau_cai: s.storage - 3 };
  const h = L.harvest(s, { plots: 'all' }, T0);
  assert.deepEqual(h.harvested, [0]);
  assert.equal(h.full, true);
  assert.equal(L.used(s), s.storage - 1);
});

test('xưởng: xếp hàng làm lần lượt, lấy hàng theo thứ tự, kiểm tra nguyên liệu', () => {
  const s = rich(fresh(), 1000, xpFor(5));
  assert.throws(() => L.craft(s, { building: 'may_xay', product: 'cam_ga' }, T0), /chưa có Máy xay/);
  L.build(s, { building: 'may_xay' });
  assert.throws(() => L.build(s, { building: 'may_xay' }), /đã có/);
  s.inv = { lua_mi: 10, bap: 5 };
  const r = L.craft(s, { building: 'may_xay', product: 'cam_ga', count: 3 }, T0);
  assert.equal(r.made, 2); // 2 chỗ
  assert.deepEqual(s.inv, { lua_mi: 6, bap: 3 });
  const q = s.buildings.may_xay.q;
  assert.equal(q[0].e, T0 + 5 * MIN);
  assert.equal(q[1].s, q[0].e);
  assert.throws(() => L.craft(s, { building: 'may_xay', product: 'cam_ga' }, T0), /đầy hàng chờ/);
  assert.deepEqual(L.collect(s, { building: 'may_xay' }, T0 + 6 * MIN).gained, { cam_ga: 1 });
  // Làm tiếp: tự lấy món xong trước
  L.craft(s, { building: 'may_xay', product: 'cam_ga' }, T0 + 11 * MIN);
  assert.equal(s.inv.cam_ga, 2);
  assert.equal(s.buildings.may_xay.q.length, 1);
  assert.equal(s.buildings.may_xay.q[0].e, T0 + 16 * MIN);
  s.inv = { lua_mi: 1 };
  assert.throws(() => L.craft(s, { building: 'may_xay', product: 'cam_ga' }, T0 + 11 * MIN), /Còn thiếu 1 lúa mì, 1 bắp/);
  assert.throws(() => L.craft(s, { building: 'may_xay', product: 'trung' }, T0), /Không làm được/);
  // Thêm chỗ
  const before = s.coins;
  L.addSlot(s, { building: 'may_xay' });
  assert.equal(s.buildings.may_xay.slots, 3);
  assert.equal(before - s.coins, L.slotCost('may_xay', 2));
});

test('mua ô đất, nâng kho, chó, trang trí: đúng giá và đúng cấp', () => {
  const s = rich(fresh(), 100000, 0);
  assert.throws(() => L.buyPlot(s), /cấp 2/);
  s.xp = xpFor(2);
  L.buyPlot(s);
  assert.equal(s.plots.length, 7);
  assert.equal(s.coins, 100000 - L.plotCost(7));
  const cap = s.storage;
  L.upgradeStorage(s);
  assert.equal(s.storage, cap + D.RULES.storageStep);
  assert.throws(() => L.buyDog(s), /cấp 5/);
  s.xp = xpFor(5);
  L.buyDog(s);
  assert.equal(s.dog, true);
  assert.throws(() => L.buyDecor(s, { decor: 'den_long' }), /cấp 6/);
  L.buyDecor(s, { decor: 'cay_dua' });
  assert.equal(L.beauty(s), 4);
});

test('lên cấp có thưởng xu và mở khóa', () => {
  const s = fresh();
  const coins = s.coins;
  const r = L.harvest(s, { plots: 'all' }, T0);
  assert.equal(L.level(s), 1);
  s.xp = L.xpToNext(1) - 1;
  // Bắt sâu được 1 kinh nghiệm: vừa đủ lên cấp 2
  s.plots[0] = { c: 'rau_cai', p: T0, r: T0 + 5 * MIN, y: 2, b: T0 + MIN, bd: false, st: 0 };
  const ups = L.clearBug(s, { plot: 0 }, T0 + 2 * MIN).levelUps;
  assert.equal(L.level(s), 2);
  assert.equal(ups[0].level, 2);
  assert.ok(ups[0].unlocks.includes('bap') && ups[0].unlocks.includes('chuong_ga'));
  assert.equal(s.coins, coins + ups[0].coins);
  assert.ok(r.levelUps.length === 0);
});

test('chợ: giá đổi theo ngày, món hot gấp rưỡi, tiền tuần', () => {
  const day = L.dayKey(T0);
  const hot = L.hotItem(day);
  assert.equal(L.ITEMS[hot].kind, 'food');
  const p = L.priceOf('ca_rot', day);
  assert.ok(p >= Math.round(14 * 0.85) && p <= Math.round(14 * 1.2));
  assert.ok(L.priceOf(hot, day) >= Math.round(L.ITEMS[hot].price * 1.27));
  const s = fresh();
  s.inv = { ca_rot: 3 };
  const r = L.sell(s, { item: 'ca_rot', qty: 2 }, T0, 111);
  assert.equal(r.coins, 2 * p);
  assert.deepEqual(s.week, { start: 111, coins: 2 * p });
  assert.throws(() => L.sell(s, { item: 'ca_rot', qty: 2 }, T0), /chỉ có 1/);
  const m = L.market(T0);
  assert.equal(m.prices.ca_rot.price, p);
});

test('đơn hàng: giao đủ hàng được xu + kinh nghiệm, đơn mới tới sau', () => {
  const s = fresh();
  const o = s.orders[0];
  assert.throws(() => L.deliver(s, { order: o.id }, T0), /Còn thiếu/);
  for (const [id, q] of o.items) s.inv[id] = q;
  const coins = s.coins;
  const r = L.deliver(s, { order: o.id }, T0, never, 0);
  assert.equal(r.coins, o.coins);
  assert.ok(r.coins > o.items.reduce((a, [id, q]) => a + L.ITEMS[id].price * q, 0));
  assert.ok(s.coins >= coins + o.coins);
  assert.equal(s.orders.length, 3);
  const next = s.orders.find((x) => x.id > o.id && x.at > T0);
  assert.ok(next && next.at === T0 + D.RULES.orderRefillMs);
  assert.throws(() => L.deliver(s, { order: next.id }, T0), /Khách chưa tới/);
  const d = L.discard(s, { order: s.orders[1].id }, T0);
  assert.equal(s.orders[1].id, d.order);
  assert.equal(s.orders[1].at, T0 + D.RULES.orderDiscardMs);
  assert.throws(() => L.deliver(s, { order: 9999 }, T0), /không còn/);
});

test('đơn hàng chỉ đòi món làm được (có chỗ làm), không đòi thức ăn chăn nuôi', () => {
  const s = rich(fresh(), 1000, xpFor(6));
  L.build(s, { building: 'chuong_ga' });
  for (let k = 0; k < 300; k++) {
    const o = L.makeOrder(s, T0, Math.random);
    for (const [id] of o.items) {
      const it = L.ITEMS[id];
      assert.ok(it.level <= 6, id);
      assert.notEqual(it.kind, 'feed', id);
      if (it.kind !== 'crop') assert.ok(s.buildings[it.building], `${id} cần ${it.building}`);
    }
  }
  assert.equal(L.orderSlots(1), 3);
  assert.equal(L.orderSlots(8), 6);
});

test('quà mỗi ngày: nhận 1 lần/ngày, chuỗi ngày liên tiếp tăng quà', () => {
  const s = fresh();
  assert.equal(L.claimGift(s, T0).coins, D.RULES.dailyGift[0]);
  assert.throws(() => L.claimGift(s, T0 + MIN), /đã nhận/);
  assert.equal(L.claimGift(s, T0 + 24 * 3600e3).coins, D.RULES.dailyGift[1]);
  assert.equal(L.claimGift(s, T0 + 3 * 24 * 3600e3).streak, 1); // bỏ một ngày
});

test('ghé vườn: bắt sâu giúp được xu, có giới hạn mỗi ngày', () => {
  const owner = rich(fresh(), 1000, xpFor(5));
  const helper = fresh();
  owner.plots[2] = { c: 'ca_rot', p: T0, r: T0 + 30 * MIN, y: 2, b: T0 + 5 * MIN, bd: false, st: 0 };
  assert.throws(() => L.help(owner, helper, { plot: 2 }, T0, { helper: 2, owner: 1 }), /không có sâu/);
  const coins = helper.coins;
  const r = L.help(owner, helper, { plot: 2 }, T0 + 6 * MIN, { helper: 2, owner: 1 });
  assert.equal(r.coins, D.RULES.helpCoins);
  assert.equal(helper.coins, coins + D.RULES.helpCoins);
  assert.equal(owner.plots[2].bd, true);
  assert.equal(owner.log[0].type, 'help');
  helper.helps = D.RULES.helpsPerDay;
  owner.plots[3] = { ...owner.plots[2], bd: false };
  assert.throws(() => L.help(owner, helper, { plot: 3 }, T0 + 6 * MIN, { helper: 2, owner: 1 }), /giúp đủ/);
  // Sang ngày mới được giúp tiếp
  L.help(owner, helper, { plot: 3 }, T0 + 24 * 3600e3, { helper: 2, owner: 1 });
});

test('hái trộm: mỗi ô mất tối đa 1, ô còn ít không hái được, chó bắt thì phải đền', () => {
  const owner = rich(fresh(), 100, xpFor(5));
  const thief = fresh();
  const ids = { thief: 2, owner: 1 };
  owner.plots[2] = { c: 'ca_rot', p: T0, r: T0 + 30 * MIN, y: 2, b: 0, bd: false, st: 0 };
  assert.throws(() => L.steal(owner, thief, { plot: 2 }, T0, never, ids), /chưa chín/);
  const r = L.steal(owner, thief, { plot: 2 }, T0 + 31 * MIN, never, ids);
  assert.deepEqual(r, { caught: false, item: 'ca_rot', levelUps: [] });
  assert.equal(thief.inv.ca_rot, 1);
  assert.equal(L.harvestUnits(owner.plots[2]), 1);
  assert.throws(() => L.steal(owner, thief, { plot: 2 }, T0 + 31 * MIN, never, ids), /đã bị hái trộm/);
  owner.plots[3] = { c: 'dua_hau', p: T0, r: T0, y: 1, b: 0, bd: false, st: 0 };
  assert.throws(() => L.steal(owner, thief, { plot: 3 }, T0 + MIN, never, ids), /ít quá/);
  // Chó giữ vườn
  owner.dog = true;
  owner.plots[4] = { c: 'ca_rot', p: T0, r: T0, y: 2, b: 0, bd: false, st: 0 };
  const coinsT = thief.coins;
  const coinsO = owner.coins;
  const c = L.steal(owner, thief, { plot: 4 }, T0 + MIN, () => 0.1, ids);
  assert.deepEqual(c, { caught: true, fine: D.RULES.dogFine });
  assert.equal(thief.coins, coinsT - D.RULES.dogFine);
  assert.equal(owner.coins, coinsO + D.RULES.dogFine);
  assert.equal(owner.plots[4].st, 0);
  assert.equal(owner.log[0].type, 'caught');
  // Giới hạn mỗi vườn mỗi ngày
  owner.plots[5] = { c: 'ca_rot', p: T0, r: T0, y: 2, b: 0, bd: false, st: 0 };
  L.steal(owner, thief, { plot: 5 }, T0 + MIN, never, ids);
  owner.plots[0] = { c: 'ca_rot', p: T0, r: T0, y: 2, b: 0, bd: false, st: 0 };
  assert.throws(() => L.steal(owner, thief, { plot: 0 }, T0 + MIN, never, ids), /vườn này đủ/);
  // Bạn bè thấy được ô nào hái được
  const view = L.publicView(owner, 2, T0 + MIN);
  assert.equal(view.plots[2].st, 'me');
  assert.equal(view.plots[0].canSteal, true);
  assert.equal(view.inv, undefined);
  assert.equal(view.coins, undefined);
});

test('danh mục gửi cho web / app đầy đủ', () => {
  const c = L.catalog();
  assert.equal(c.crops.length, D.CROPS.length);
  assert.equal(c.xpTable.length, D.RULES.maxLevel);
  assert.equal(c.plotCosts[0].n, 7);
  assert.equal(c.plotCosts.at(-1).n, D.RULES.maxPlots);
  assert.equal(c.slotCosts.bep.length, D.RULES.maxSlots - D.RULES.startSlots);
});
