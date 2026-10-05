'use strict';
// Các máy cờ để chơi cùng (src/chess.js dùng). Ba loại:
//  - Máy cờ mã nguồn mở chạy nguyên bản: js-chess-engine, GarboChess, Stockfish (giảm sức bằng Skill Level).
//  - Máy có tính cách (engine 'style'): Stockfish xem vài nước tốt nhất (MultiPV) rồi chọn theo "gu" riêng
//    (mê đẩy tốt, thích nhảy mã, tung Hậu sớm…), có độ ngẫu nhiên và tỉ lệ đi hớ để ra đúng tầm ELO (src/chess-worker.js).
//  - Máy tự chọn sức (id 'custom-<elo>'): như máy có tính cách nhưng không có gu, ELO 300–2800.
// Máy nói vài câu trong ván (chào, chiếu, ăn quân, bạn đi hớ, thắng, thua). Biểu tượng chỉ dùng emoji cũ
// (Unicode 6 trở về trước) để Android 7–9 hiện được.

const SOURCES = {
  jce: { name: 'js-chess-engine', url: 'https://github.com/josefjadrny/js-chess-engine', license: 'MIT' },
  garbo: { name: 'GarboChess-JS', url: 'https://github.com/glinscott/Garbochess-JS', license: 'BSD' },
  stockfish: { name: 'Stockfish 11', url: 'https://github.com/official-stockfish/Stockfish', license: 'GPL-3.0' },
};
SOURCES.style = SOURCES.stockfish; // máy có tính cách dùng Stockfish để xem nước

/** Nhóm theo sức cờ, để chia danh sách cho dễ chọn */
const TIERS = [
  { id: 'new', name: 'Mới chơi', max: 799 },
  { id: 'mid', name: 'Trung bình', max: 1399 },
  { id: 'adv', name: 'Nâng cao', max: 1999 },
  { id: 'pro', name: 'Chuyên gia', max: Infinity },
];
const tierOf = (elo) => TIERS.find((t) => elo <= t.max).id;

/*
 * Độ khó của máy 'style' theo ELO (nội suy giữa các mốc):
 * depth: Stockfish nhìn sâu bao nhiêu nước; temp: độ "phóng tay" khi chọn giữa các nước gần bằng nhau (điểm × 1/100 tốt);
 * blunder: tỉ lệ đi bừa một nước (vẫn theo gu); lines: số nước tốt nhất được xem.
 */
const LEVELS = [
  { elo: 250, depth: 1, temp: 600, blunder: 0.5, lines: 10 },
  { elo: 500, depth: 1, temp: 300, blunder: 0.25, lines: 8 },
  { elo: 650, depth: 2, temp: 220, blunder: 0.18, lines: 8 },
  { elo: 800, depth: 2, temp: 160, blunder: 0.12, lines: 6 },
  { elo: 900, depth: 3, temp: 130, blunder: 0.09, lines: 6 },
  { elo: 1100, depth: 4, temp: 90, blunder: 0.06, lines: 6 },
  { elo: 1250, depth: 5, temp: 70, blunder: 0.04, lines: 5 },
  { elo: 1450, depth: 6, temp: 45, blunder: 0.025, lines: 5 },
  { elo: 1700, depth: 8, temp: 28, blunder: 0.012, lines: 5 },
  { elo: 2000, depth: 10, temp: 14, blunder: 0.004, lines: 4 },
  { elo: 2200, depth: 12, temp: 8, blunder: 0, lines: 4 },
  { elo: 2800, depth: 16, temp: 2, blunder: 0, lines: 3 },
];

function levelFor(elo) {
  if (elo <= LEVELS[0].elo) return { ...LEVELS[0] };
  for (let i = 1; i < LEVELS.length; i++) {
    const a = LEVELS[i - 1];
    const b = LEVELS[i];
    if (elo <= b.elo) {
      const t = (elo - a.elo) / (b.elo - a.elo);
      const mix = (k) => a[k] + (b[k] - a[k]) * t;
      return { depth: Math.round(mix('depth')), temp: Math.round(mix('temp')), blunder: Math.round(mix('blunder') * 1000) / 1000, lines: Math.round(mix('lines')) };
    }
  }
  return { ...LEVELS[LEVELS.length - 1] };
}

/** Gu chơi: tên ngắn hiện dưới tên máy */
const STYLES = {
  random: 'Đi đâu cũng được',
  pawns: 'Mê đẩy tốt',
  knights: 'Thích nhảy mã',
  queen: 'Tung Hậu sớm',
  defend: 'Phòng thủ, thích đổi quân',
  trick: 'Hay chiếu, gài bẫy',
  bishops: 'Thích cặp Tượng',
  storm: 'Dồn quân đánh Vua',
  sharp: 'Sắc bén, ít sai',
  neutral: 'Cân bằng',
};

const style = (o) => ({ engine: 'style', ...levelFor(o.elo), ...o });

const BOTS = [
  style({ id: 'mam', name: 'Mầm Non', elo: 250, style: 'random', avatar: '🐣', movetime: 300, about: 'Vừa biết đi quân. Đi đâu cũng được, miễn là đi!' }),
  { id: 'jce-1', name: 'Gà Mờ', elo: 500, engine: 'jce', level: 1, randomness: 120, movetime: 600, avatar: '🐔', about: 'Mới học đi quân, hay đi nước ngẫu hứng.' },
  style({ id: 'tot', name: 'Tốt Lì', elo: 650, style: 'pawns', avatar: '🐢', movetime: 400, about: 'Mê đẩy tốt. Chậm mà chắc… thỉnh thoảng thôi.' }),
  { id: 'jce-2', name: 'Tập Sự', elo: 800, engine: 'jce', level: 2, randomness: 40, movetime: 700, avatar: '🐤', about: 'Biết ăn quân, ít nhìn xa.' },
  style({ id: 'ma', name: 'Mã Phi', elo: 900, style: 'knights', avatar: '🐴', movetime: 500, about: 'Thích cho Mã nhảy khắp bàn, mê nước chĩa hai.' }),
  { id: 'jce-3', name: 'Học Trò', elo: 1000, engine: 'jce', level: 3, randomness: 20, movetime: 800, avatar: '🎒', about: 'Đánh cẩn thận hơn, hợp để luyện tập.' },
  style({ id: 'hau', name: 'Hậu Liều', elo: 1100, style: 'queen', avatar: '🐯', movetime: 600, about: 'Tung Hậu ra từ sớm, đánh ào ạt. Bắt được Hậu là thắng to.' }),
  style({ id: 'thu', name: 'Thủ Thành', elo: 1250, style: 'defend', avatar: '🐻', movetime: 600, about: 'Nhập thành sớm, đổi quân, kiên nhẫn chờ bạn sai.' }),
  { id: 'sf-3', name: 'Stockfish · Dễ', elo: 1300, engine: 'stockfish', skill: 3, movetime: 400, about: 'Máy mạnh nhất thế giới, đã giảm sức.' },
  style({ id: 'cao', name: 'Cáo Già', elo: 1450, style: 'trick', avatar: '🐺', movetime: 700, about: 'Hay chiếu tướng, gài bẫy bắt quân. Coi chừng nước chĩa!' }),
  { id: 'garbo', name: 'GarboChess', elo: 1600, engine: 'garbo', movetime: 900, about: 'Máy cờ JavaScript cổ điển của Gary Linscott.' },
  style({ id: 'tuong', name: 'Tượng Đôi', elo: 1700, style: 'bishops', avatar: '🐼', movetime: 800, about: 'Giữ cặp Tượng, mở đường chéo, ép dần từng chút.' }),
  { id: 'sf-8', name: 'Stockfish · Vừa', elo: 1800, engine: 'stockfish', skill: 8, movetime: 700, about: 'Đánh chắc tay, ít sai lầm lớn.' },
  style({ id: 'bao', name: 'Bão Táp', elo: 2000, style: 'storm', flair: 0.6, avatar: '🌀', movetime: 900, about: 'Dồn quân về phía Vua bạn, sẵn sàng thí quân để tấn công.' }),
  style({ id: 'rong', name: 'Rồng Lửa', elo: 2200, style: 'sharp', avatar: '🐲', movetime: 1000, about: 'Tính sâu, đánh sắc bén, hiếm khi sai.' }),
  { id: 'sf-14', name: 'Stockfish · Khó', elo: 2300, engine: 'stockfish', skill: 14, movetime: 1000, about: 'Mạnh cỡ kiện tướng.' },
  { id: 'kt', name: 'Đại Kiện Tướng', elo: 2600, engine: 'stockfish', skill: 17, movetime: 1200, avatar: '👑', about: 'Đẳng cấp thế giới. Hòa được đã là thành tích.' },
  { id: 'sf-20', name: 'Stockfish · Mạnh nhất', elo: 3000, engine: 'stockfish', skill: 20, movetime: 1500, about: 'Hết sức. Thắng được là huyền thoại.' },
];
const byId = new Map(BOTS.map((b) => [b.id, b]));

/** Máy tự chọn sức: ELO 300–2800, bước 50 */
const CUSTOM_MIN = 300;
const CUSTOM_MAX = 2800;
function customBot(elo) {
  const e = Math.max(CUSTOM_MIN, Math.min(CUSTOM_MAX, Math.round(elo / 50) * 50));
  return style({
    id: `custom-${e}`,
    name: `Máy tùy chỉnh ${e}`,
    elo: e,
    style: 'neutral',
    avatar: '🎯',
    movetime: Math.round(Math.min(1400, 300 + e / 3)),
    custom: true,
    about: `Máy không có gu riêng, sức cờ khoảng ${e} ELO do bạn chọn.`,
  });
}

/** Tìm máy theo id (cả máy tự chọn sức 'custom-1500') */
function botById(id) {
  const key = String(id || '');
  if (byId.has(key)) return byId.get(key);
  const m = /^custom-(\d{3,4})$/.exec(key);
  if (m) {
    const elo = Number(m[1]);
    if (elo >= CUSTOM_MIN && elo <= CUSTOM_MAX && elo % 50 === 0) return customBot(elo);
  }
  return null;
}

/** Thông tin máy gửi cho web / app */
const botPublic = (b) => ({
  id: b.id,
  name: b.name,
  elo: b.elo,
  about: b.about,
  avatar: b.avatar || null,
  style: b.style ? STYLES[b.style] : null,
  tier: tierOf(b.elo),
  custom: Boolean(b.custom),
  source: SOURCES[b.engine],
});

/** Việc gửi cho luồng máy cờ (src/chess-worker.js) */
function jobFor(b) {
  if (b.engine === 'style') {
    return { engine: 'style', style: b.style, depth: b.depth, temp: b.temp, blunder: b.blunder, lines: b.lines, flair: b.flair ?? 1, elo: b.elo };
  }
  return { engine: b.engine, level: b.level, randomness: b.randomness, skill: b.skill };
}

/* ---------------- Máy nói ---------------- */

// Câu chung; máy có câu riêng thì dùng câu riêng (xen lẫn câu chung cho đỡ lặp)
const LINES = {
  hello: ['Chào bạn! Chơi vui nhé.', 'Sẵn sàng chưa? Bắt đầu thôi!', 'Một ván thật hay nào.'],
  check: ['Chiếu!', 'Vua bạn cẩn thận nhé.', 'Chiếu tướng đây!'],
  capture: ['Cảm ơn món quà nhé!', 'Quân này của mình rồi.', 'Ăn được thì cứ ăn thôi.'],
  promote: ['Tốt lên Hậu rồi!', 'Có thêm Hậu mới, vui ghê.'],
  blunder: ['Ơ, bạn chắc chưa?', 'Nước này hình như hơi vội…', 'Mình thấy cơ hội rồi đấy!'],
  losing: ['Bạn đánh hay thật.', 'Ván này khó cho mình quá…', 'Để mình nghĩ kỹ chút.'],
  win: ['Ván hay lắm! Đấu lại không?', 'Mình thắng ván này rồi. Thử lại nhé!', 'Cảm ơn ván cờ nhé!'],
  lose: ['Bạn thắng rồi, giỏi quá!', 'Chịu thua, bạn chơi hay thật.', 'Ván sau mình sẽ phục thù!'],
  draw: ['Hòa! Hai bên đều cố gắng.', 'Một ván cân tài cân sức.'],
};
const OWN = {
  mam: { hello: ['Chào bạn! Mình mới học cờ thôi.'], capture: ['Ủa, ăn được hả?'], lose: ['Hay quá, dạy mình với!'], win: ['Ơ… mình thắng thật à?'] },
  'jce-1': { hello: ['Cục tác! Vào ván thôi.'], capture: ['Mổ một phát!'], lose: ['Cục tác… thua rồi.'] },
  tot: { hello: ['Tốt đi trước, quân đi sau.'], promote: ['Thấy chưa, Tốt cũng lên Hậu được!'], capture: ['Tốt ăn quân, không ngờ đúng không?'] },
  'jce-2': { hello: ['Mình đang tập, nhẹ tay nhé!'] },
  ma: { hello: ['Hí hí! Mã đã sẵn sàng.'], check: ['Mã chiếu đây!'], capture: ['Nhảy một phát, ăn luôn!'] },
  'jce-3': { hello: ['Học trò xin phép đánh trước… à không, theo lượt.'] },
  hau: { hello: ['Hậu ơi, ra trận!'], check: ['Hậu chiếu! Chạy đi đâu?'], capture: ['Hậu ăn tất!'], losing: ['Hậu ơi, cứu mình…'] },
  thu: { hello: ['Phòng thủ là tấn công tốt nhất.'], capture: ['Đổi quân cho gọn bàn.'], blunder: ['Mình chờ nước này lâu rồi.'] },
  cao: { hello: ['Hè hè, coi chừng bẫy nhé.'], check: ['Chiếu! Còn nhiều trò lắm.'], blunder: ['Sập bẫy rồi nhé!'], capture: ['Mồi ngon đấy.'] },
  tuong: { hello: ['Hai Tượng, hai đường chéo, một ván hay.'], capture: ['Đường chéo này là của mình.'] },
  bao: { hello: ['Gió nổi lên rồi!'], check: ['Bão về tới Vua bạn rồi!'], capture: ['Cuốn bay luôn!'], losing: ['Bão tan rồi sao…'] },
  rong: { hello: ['Rồng Lửa đã thức giấc.'], check: ['Phun lửa! Chiếu!'], win: ['Lửa đã thiêu rụi bàn cờ.'], lose: ['Bạn dập được lửa rồi. Giỏi!'] },
  kt: { hello: ['Rất hân hạnh được đấu với bạn.'], win: ['Cảm ơn ván đấu. Bạn tiến bộ nhanh lắm.'], lose: ['Xuất sắc! Bạn đã hạ một Đại Kiện Tướng.'] },
};

/** Câu nói cho sự kiện `event` của máy `b` (random: hàm số ngẫu nhiên 0–1, để kiểm thử) */
function lineFor(b, event, random = Math.random) {
  const own = (OWN[b.id] || {})[event] || [];
  const all = LINES[event] || [];
  const pool = own.length && random() < 0.65 ? own : all.length ? all : own;
  if (!pool.length) return null;
  return pool[Math.floor(random() * pool.length)];
}

module.exports = { BOTS, SOURCES, STYLES, TIERS, LEVELS, levelFor, botById, botPublic, jobFor, lineFor, customBot, CUSTOM_MIN, CUSTOM_MAX };
