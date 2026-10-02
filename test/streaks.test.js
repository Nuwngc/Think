'use strict';
// Kiểm thử chuỗi hằng ngày (src/streaks.js) — và quy tắc: game nào cũng phải có chuỗi (chạy: npm test)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'think-streaks-'));
const { run } = require('../src/db');
const S = require('../src/streaks');

const ROOT = path.join(__dirname, '..');
const T = (iso) => Date.parse(iso); // giờ UTC
const days = (...list) => new Set(list);

test('ngày tính theo giờ Việt Nam', () => {
  assert.equal(S.dayKey(T('2026-10-02T16:59:00Z')), '2026-10-02'); // 23:59 giờ VN
  assert.equal(S.dayKey(T('2026-10-02T17:00:00Z')), '2026-10-03'); // 0:00 giờ VN hôm sau
  assert.equal(S.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(S.weekday('2026-10-05'), 0); // thứ Hai
  assert.equal(S.weekday('2026-10-04'), 6); // Chủ nhật
});

test('chuỗi: hôm nay đã chơi, chưa chơi (vẫn còn chuỗi), đứt chuỗi', () => {
  const today = '2026-10-10';
  let s = S.streakOf(days('2026-10-08', '2026-10-09', '2026-10-10'), today);
  assert.deepEqual([s.current, s.best, s.today, s.atRisk], [3, 3, true, false]);
  s = S.streakOf(days('2026-10-08', '2026-10-09'), today);
  assert.deepEqual([s.current, s.today, s.atRisk], [2, false, true]); // chơi hôm nay để giữ chuỗi
  s = S.streakOf(days('2026-10-07', '2026-10-08'), today);
  assert.deepEqual([s.current, s.best, s.atRisk], [0, 2, false]); // bỏ hôm qua: mất chuỗi, kỷ lục vẫn còn
  s = S.streakOf(days('2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-10-10'), today);
  assert.deepEqual([s.current, s.best], [1, 4]);
  assert.deepEqual(s.week, [false, false, false, false, false, false, true]);
  assert.deepEqual(S.streakOf(new Set(), today), { current: 0, best: 0, today: false, atRisk: false, week: [false, false, false, false, false, false, false], last: null });
});

test('ghi ngày chơi, chuỗi từng game, chuỗi chung, mốc chúc mừng', () => {
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (901, 'stk', 'Streak', 'x', 0)");
  const now = T('2026-10-10T05:00:00Z');
  const uid = 901;
  // 6 ngày trước đã chơi cờ vua (gửi muộn, kiểu ngày chơi lúc mất mạng)
  const back = S.recordDays(uid, 'chess', ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'], now);
  assert.equal(back.added, true);
  assert.equal(back.event.isToday, false);
  assert.equal(back.event.milestone, null); // ngày cũ: không chúc mừng
  // Hôm nay chơi: đủ 7 ngày → mốc 7
  const r = S.record(uid, 'chess', now, now);
  assert.equal(r.event.current, 7);
  assert.equal(r.event.milestone, 7);
  assert.equal(r.event.overallMilestone, 7); // game đầu tiên trong ngày: chuỗi chung cũng lên 7
  // Gọi lại trong ngày: không ghi gì nữa
  assert.equal(S.record(uid, 'chess', now + 1000, now + 1000).added, false);
  // Game thứ hai trong ngày: chuỗi chung không tăng nữa
  const f = S.record(uid, 'farm', now, now);
  assert.equal(f.event.current, 1);
  assert.equal(f.event.overallMilestone, null);
  const sum = S.summaryOf(uid, now);
  assert.deepEqual(sum.games.map((g) => [g.id, g.current]), [['farm', 1], ['blocks', 0], ['chess', 7], ['caro', 0]]);
  assert.equal(sum.overall.current, 7);
  assert.equal(sum.today, '2026-10-10');
  // Không nhận ngày tương lai, ngày quá cũ, game lạ
  assert.equal(S.recordDays(uid, 'blocks', ['2026-09-01', 'xx'], now).added, false); // (ngày tương lai tính là hôm nay: xem bài sau)
  assert.equal(S.record(uid, 'tetris', now, now).added, false);
  assert.equal(S.recordDays(uid, 'tetris', ['2026-10-10'], now).added, false); // game lạ: không ghi, không ném lỗi
  assert.equal(S.recordDays(uid, 'blocks', ['2026-02-30', '2026-10-32'], now).added, false); // ngày không có thật
  // Hôm sau chưa chơi: chuỗi còn, đang có nguy cơ mất → câu nhắc
  const next = S.summaryOf(uid, T('2026-10-11T13:30:00Z'));
  assert.equal(next.games.find((g) => g.id === 'chess').atRisk, true);
  assert.match(S.reminderText(next), /^Chuỗi 7 ngày Cờ vua sẽ mất/);
  // Chuỗi 1 ngày thì không nhắc
  assert.equal(S.reminderText({ games: [{ name: 'Nông trại', current: 1, atRisk: true }] }), null);
});

test('điện thoại để sai ngày giờ: vẫn tính đúng ngày theo đồng hồ máy chủ', () => {
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (902, 'stk2', 'Streak 2', 'x', 0)");
  const late = T('2026-10-10T16:50:00Z'); // 23:50 giờ VN
  const r = S.recordDays(902, 'blocks', ['2026-10-11'], late);
  assert.equal(r.added, true);
  assert.deepEqual(r.event.days, ['2026-10-10']); // ngày "tương lai" = đang chơi lúc này = hôm nay
  const H = 3600000;
  const now = T('2026-10-12T05:00:00Z'); // 12:00 trưa 12/10 giờ VN (máy chủ)
  // Điện thoại nhanh 1 ngày, chơi lúc 5 phút trước (theo đồng hồ điện thoại)
  const ahead = now + 24 * H;
  assert.deepEqual(S.playedDays({ plays: [{ day: '2026-10-13', t: ahead - 300000 }], now: ahead }, now), ['2026-10-12']);
  // Điện thoại chậm 1 ngày: vẫn là hôm nay, không phải hôm qua
  const behind = now - 24 * H;
  assert.deepEqual(S.playedDays({ plays: [{ day: '2026-10-11', t: behind - 60000 }], now: behind }, now), ['2026-10-12']);
  // Chơi lúc mất mạng hôm qua (đồng hồ đúng), gửi hôm nay: vẫn là hôm qua
  assert.deepEqual(S.playedDays({ plays: [{ day: '2026-10-11', t: now - 20 * H }], now }, now), ['2026-10-11']);
  // Bản app cũ: chỉ gửi days
  assert.deepEqual(S.playedDays({ days: ['2026-10-12'] }, now), ['2026-10-12']);
  assert.deepEqual(S.playedDays({}, now), ['2026-10-12']);
  // Đồng hồ lệch quá xa (hơn 30 ngày) thì không tin, dùng ngày máy gửi
  assert.deepEqual(S.playedDays({ plays: [{ day: '2026-10-12', t: 1 }], now: 1 }, now), ['2026-10-12']);
  const rr = S.recordDays(902, 'caro', S.playedDays({ plays: [{ day: '2026-10-13', t: ahead }], now: ahead }, now), now);
  assert.deepEqual(rr.event.days, ['2026-10-12']);
  // Độ lệch đồng hồ
  assert.equal(S.clockSkew(ahead, now), -24 * H);
  assert.equal(S.clockSkew(behind, now), 24 * H);
  assert.equal(S.clockSkew(undefined, now), null);
  assert.equal(S.clockSkew(1, now), null);
  // Điểm Xếp Khối: điện thoại nhanh 1 ngày vẫn được nhận, giờ chơi đổi về giờ máy chủ
  const { cleanScore } = require('../src/games');
  const sc = { id: 'abcdefgh1', score: 10, moves: 5, lines: 0, durationMs: 1000, playedAt: ahead - 60000 };
  assert.match(cleanScore('blocks', sc, now).error, /không hợp lệ/); // không biết lệch: từ chối như cũ
  assert.equal(cleanScore('blocks', sc, now, S.clockSkew(ahead, now)).playedAt, now - 60000);
  assert.equal(S.dayKey(cleanScore('blocks', { ...sc, playedAt: behind - 60000 }, now, S.clockSkew(behind, now)).playedAt), '2026-10-12');
});

test('đóng băng chuỗi: nối chuỗi qua ngày quên chơi, mỗi thứ Hai thêm 1 lượt, trả lại khi ngày đó gửi muộn', () => {
  // Hàm thuần: ngày đóng băng nối chuỗi nhưng không cộng
  let s = S.streakOf(days('2026-10-07', '2026-10-08', '2026-10-10'), '2026-10-10', days('2026-10-09'));
  assert.deepEqual([s.current, s.best, s.last], [3, 3, '2026-10-10']);
  s = S.streakOf(days('2026-10-07', '2026-10-08'), '2026-10-10', days('2026-10-09'));
  assert.deepEqual([s.current, s.atRisk], [2, true]); // hôm qua đóng băng: chuỗi còn, chơi hôm nay để giữ
  assert.equal(S.streakOf(days('2026-10-05'), '2026-10-10', days('2026-10-09')).current, 0); // đóng băng không nối với gì

  for (const id of [905, 906, 907]) run(`INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (${id}, 'fz${id}', 'Fz', 'x', 0)`);
  const noon = (d) => T(`${d}T05:00:00Z`);
  // Chơi 13–15/10 (thứ Ba → thứ Năm): lần đầu được tặng 1 lượt
  S.recordDays(905, 'chess', ['2026-10-13', '2026-10-14', '2026-10-15'], noon('2026-10-15'));
  assert.equal(S.summaryOf(905, noon('2026-10-15')).freeze.count, 1);
  // Quên thứ Sáu 16/10: thứ Bảy mở app thấy chuỗi vẫn còn, đã dùng 1 lượt
  let sum = S.summaryOf(905, noon('2026-10-17'));
  assert.deepEqual([sum.overall.current, sum.overall.atRisk, sum.freeze.count], [3, true, 0]);
  assert.deepEqual(sum.freeze.used, ['2026-10-16']);
  assert.deepEqual(sum.freeze.week, [false, false, false, false, false, true, false]);
  assert.equal(sum.games.find((g) => g.id === 'chess').current, 3);
  const r = S.recordDays(905, 'chess', ['2026-10-17'], noon('2026-10-17'));
  assert.deepEqual([r.event.current, r.summary.overall.current], [4, 4]);
  // Quên Chủ nhật, hết lượt: thứ Hai chuỗi đứt, nhưng được thêm 1 lượt mới
  sum = S.summaryOf(905, noon('2026-10-19'));
  assert.deepEqual([sum.overall.current, sum.overall.best, sum.freeze.count], [0, 4, 1]);
  // Gọi lại không dùng / cộng thêm lần nữa
  assert.equal(S.summaryOf(905, noon('2026-10-19')).freeze.count, 1);
  // Nhiều tuần không mở app: tối đa 2 lượt
  assert.equal(S.summaryOf(905, noon('2026-11-10')).freeze.count, 2);

  // Ngày đã đóng băng hóa ra có chơi (gửi muộn lúc mất mạng): trả lại lượt
  S.recordDays(906, 'chess', ['2026-10-13', '2026-10-14'], noon('2026-10-14'));
  assert.deepEqual(S.summaryOf(906, noon('2026-10-16')).freeze.used, ['2026-10-15']);
  sum = S.recordDays(906, 'blocks', ['2026-10-15'], noon('2026-10-16')).summary;
  assert.deepEqual([sum.overall.current, sum.freeze.count, sum.freeze.used], [3, 1, []]);

  // Gửi muộn làm chuỗi sống lại: ngày quên sau đó được xét lại và đóng băng
  S.recordDays(907, 'chess', ['2026-10-13'], noon('2026-10-13'));
  sum = S.summaryOf(907, noon('2026-10-16'));
  assert.deepEqual([sum.overall.current, sum.freeze.used, sum.freeze.count], [0, ['2026-10-14'], 0]);
  sum = S.recordDays(907, 'blocks', ['2026-10-14'], noon('2026-10-16')).summary;
  assert.deepEqual([sum.overall.current, sum.overall.atRisk, sum.freeze.used, sum.freeze.count], [2, true, ['2026-10-15'], 0]);
});

test('nhắc giữ chuỗi: mỗi người một lần mỗi ngày, bỏ người đã tắt nhắc', async () => {
  const app = { get() {}, post() {} };
  const sent = [];
  const { remindAll } = S.setupStreaks({ app, io: null, requireAuth: null, requireReady: null, isActive: () => false, notify: (uid, p) => sent.push([uid, p]) });
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (903, 'stk3', 'Streak 3', 'x', 0)");
  run("INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (904, 'stk4', 'Streak 4', 'x', 0)");
  for (const uid of [903, 904]) S.recordDays(uid, 'chess', ['2026-10-19', '2026-10-20'], T('2026-10-20T05:00:00Z'));
  run('INSERT INTO streak_prefs (user_id, remind) VALUES (904, 0)');
  const evening = T('2026-10-21T13:30:00Z'); // 20:30 giờ VN, hôm nay chưa chơi
  assert.equal(await remindAll(T('2026-10-21T05:00:00Z')), 0); // buổi trưa: chưa nhắc
  const [a, b] = await Promise.all([remindAll(evening), remindAll(evening)]);
  assert.equal(a + b, 1);
  assert.equal(await remindAll(evening + 600000), 0);
  assert.deepEqual(sent.map(([uid]) => uid), [903]);
  assert.match(sent[0][1].body, /Chuỗi 2 ngày Cờ vua/);
  assert.ok(sent[0][1].ttl > 0 && sent[0][1].ttl <= 4 * 3600); // hết hạn lúc nửa đêm
});

test('quy tắc: game nào trên trang Trò chơi cũng có chuỗi hằng ngày (web và app)', () => {
  const ids = S.GAMES.map((g) => g.id);
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const listOf = (src, label) => {
    const m = /GAME_IDS(?::[^=]+)?\s*=\s*\[([^\]]*)\]/.exec(src);
    assert.ok(m, `không thấy GAME_IDS trong ${label}`);
    return [...m[1].matchAll(/['"]([\w-]+)['"]/g)].map((x) => x[1]);
  };
  assert.deepEqual(listOf(read('public/games-ui.js'), 'public/games-ui.js').sort(), [...ids].sort(), 'thẻ game bản web phải khớp GAMES trong src/streaks.js');
  assert.deepEqual(listOf(read('native/src/games/registry.ts'), 'native/src/games/registry.ts').sort(), [...ids].sort(), 'thẻ game App Think Beta phải khớp GAMES trong src/streaks.js');
  // Thẻ game bản web vẽ bằng card('<mã>', …): mã nào cũng phải có trong GAME_IDS
  const cards = [...read('public/games-ui.js').matchAll(/\bcard\('([\w-]+)'/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(cards)].sort(), [...ids].sort(), 'thẻ game bản web (card(…)) phải khớp GAMES trong src/streaks.js');
  const appCards = [...read('native/src/games/GamesHome.tsx').matchAll(/<GameCard[^>]*?\bid="([\w-]+)"/gs)].map((x) => x[1]);
  assert.deepEqual([...new Set(appCards)].sort(), [...ids].sort(), 'thẻ game App Think Beta (<GameCard id=…>) phải khớp GAMES trong src/streaks.js');
  const server = fs.readdirSync(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js') && f !== 'streaks.js').map((f) => read(`src/${f}`)).join('\n');
  const web = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.js')).map((f) => read(`public/${f}`)).join('\n');
  const appSrc = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory()) walk(path.join(dir, f.name));
      else if (/\.tsx?$/.test(f.name)) appSrc.push(fs.readFileSync(path.join(dir, f.name), 'utf8'));
    }
  };
  walk(path.join(ROOT, 'native/src'));
  const app = appSrc.join('\n');
  for (const g of S.GAMES) {
    if (g.client) {
      assert.match(web, new RegExp(`ThinkStreaks\\.mark\\('${g.id}'`), `${g.name}: bản web chưa gọi ThinkStreaks.mark('${g.id}', …)`);
      assert.match(app, new RegExp(`markPlayed\\("${g.id}"`), `${g.name}: App Think Beta chưa gọi markPlayed("${g.id}")`);
    } else {
      assert.match(server, new RegExp(`streaks\\.record\\([^)]*'${g.id}'`), `${g.name}: máy chủ chưa gọi streaks.record(…, '${g.id}')`);
    }
  }
});
