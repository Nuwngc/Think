'use strict';
/* Luật game Xếp Khối (kiểu Block Blast): bàn 8×8, mỗi lượt có 3 khối, kéo khối vào bàn;
   đầy một hàng ngang hoặc cột dọc thì hàng đó biến mất và được điểm. Hết chỗ đặt khối là thua.
   File này chỉ có luật và cách tính điểm (không vẽ gì), dùng chung cho trang web và để kiểm thử.
   App Think Beta có bản TypeScript giống hệt: native/src/blocks/engine.ts */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlocksCore = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const SIZE = 8;
  const COLORS = 7; // số màu khối (1..7), 0 = ô trống
  // Điểm ăn hàng theo số hàng/cột xóa cùng lúc, nhân với combo (tối đa x10)
  const LINE_POINTS = [0, 10, 25, 45, 70, 100, 135];
  const MAX_MULTIPLIER = 10;
  const ALL_CLEAR = 300; // dọn sạch bàn
  const COMBO_GRACE = 3; // đặt 3 khối liền không ăn hàng nào thì mất combo

  // Các hình khối: [hàng, cột] của từng ô, và độ hay gặp
  const SHAPES = [];
  function shape(id, weight, rows) {
    const cells = [];
    rows.forEach((line, r) => {
      for (let c = 0; c < line.length; c++) if (line[c] === '#') cells.push([r, c]);
    });
    SHAPES.push({ id, weight, cells, h: rows.length, w: Math.max(...rows.map((l) => l.length)) });
  }
  function rotations(id, weight, rows, count = 4) {
    let cur = rows;
    for (let k = 0; k < count; k++) {
      shape(`${id}${k}`, weight, cur);
      // Xoay 90 độ theo chiều kim đồng hồ
      const h = cur.length;
      const w = Math.max(...cur.map((l) => l.length));
      const next = [];
      for (let c = 0; c < w; c++) {
        let line = '';
        for (let r = h - 1; r >= 0; r--) line += cur[r][c] === '#' ? '#' : '.';
        next.push(line);
      }
      cur = next;
    }
  }
  shape('o1', 2, ['#']);
  shape('i2h', 3, ['##']);
  shape('i2v', 3, ['#', '#']);
  shape('i3h', 3, ['###']);
  shape('i3v', 3, ['#', '#', '#']);
  shape('i4h', 2, ['####']);
  shape('i4v', 2, ['#', '#', '#', '#']);
  shape('i5h', 1.5, ['#####']);
  shape('i5v', 1.5, ['#', '#', '#', '#', '#']);
  shape('o2', 4, ['##', '##']);
  shape('o3', 1.5, ['###', '###', '###']);
  shape('r23', 2, ['###', '###']);
  shape('r32', 2, ['##', '##', '##']);
  rotations('c3', 2, ['##', '#.']);
  rotations('l4', 1, ['#.', '#.', '##']);
  rotations('j4', 1, ['.#', '.#', '##']);
  rotations('t4', 1, ['###', '.#.']);
  shape('s4h', 0.8, ['.##', '##.']);
  shape('s4v', 0.8, ['#.', '##', '.#']);
  shape('z4h', 0.8, ['##.', '.##']);
  shape('z4v', 0.8, ['.#', '##', '#.']);
  rotations('l5', 1, ['#..', '#..', '###']);
  const BY_ID = Object.fromEntries(SHAPES.map((s) => [s.id, s]));
  const TOTAL_WEIGHT = SHAPES.reduce((s, x) => s + x.weight, 0);

  const shapeOf = (id) => BY_ID[id] || null;
  const emptyBoard = () => new Array(SIZE * SIZE).fill(0);

  function canPlace(board, shapeId, r, c) {
    const s = shapeOf(shapeId);
    if (!s || r < 0 || c < 0 || r + s.h > SIZE || c + s.w > SIZE) return false;
    for (const [dr, dc] of s.cells) if (board[(r + dr) * SIZE + c + dc]) return false;
    return true;
  }

  function fitsAnywhere(board, shapeId) {
    const s = shapeOf(shapeId);
    if (!s) return false;
    for (let r = 0; r + s.h <= SIZE; r++) for (let c = 0; c + s.w <= SIZE; c++) if (canPlace(board, shapeId, r, c)) return true;
    return false;
  }

  /** Các hàng / cột sẽ đầy nếu đặt khối vào (r, c) — để tô sáng trước khi thả tay */
  function linesIfPlaced(board, shapeId, r, c) {
    const s = shapeOf(shapeId);
    const next = board.slice();
    for (const [dr, dc] of s.cells) next[(r + dr) * SIZE + c + dc] = 1;
    return fullLines(next);
  }

  function fullLines(board) {
    const rows = [];
    const cols = [];
    for (let i = 0; i < SIZE; i++) {
      let row = true;
      let col = true;
      for (let j = 0; j < SIZE; j++) {
        if (!board[i * SIZE + j]) row = false;
        if (!board[j * SIZE + i]) col = false;
      }
      if (row) rows.push(i);
      if (col) cols.push(i);
    }
    return { rows, cols };
  }

  function pickShape(rand) {
    let x = rand() * TOTAL_WEIGHT;
    for (const s of SHAPES) {
      x -= s.weight;
      if (x <= 0) return s.id;
    }
    return SHAPES[SHAPES.length - 1].id;
  }

  /** Ba khối mới. Cố chọn sao cho đặt được ít nhất một khối (như game gốc, không "gài" người chơi thua ngay) */
  function newTray(board, rand = Math.random) {
    let tray = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      tray = [0, 1, 2].map(() => ({ shape: pickShape(rand), color: 1 + Math.floor(rand() * COLORS) }));
      // Tránh ba khối trùng màu cho dễ nhìn
      if (tray[1].color === tray[0].color) tray[1].color = (tray[0].color % COLORS) + 1;
      if (tray[2].color === tray[1].color || tray[2].color === tray[0].color) {
        for (let k = 1; k <= COLORS; k++) if (k !== tray[0].color && k !== tray[1].color) { tray[2].color = k; break; }
      }
      if (tray.some((p) => fitsAnywhere(board, p.shape))) return tray;
    }
    // Bàn gần kín: cho một khối 1 ô nếu còn chỗ
    if (board.some((v) => !v)) tray[0] = { shape: 'o1', color: tray[0].color };
    return tray;
  }

  function newGame(rand = Math.random, now = Date.now()) {
    const board = emptyBoard();
    return {
      id: `${now.toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`,
      board,
      tray: newTray(board, rand),
      score: 0,
      combo: 0,
      sinceClear: 0,
      moves: 0,
      lines: 0,
      startedAt: now,
      over: false,
    };
  }

  /** Kiểm tra dữ liệu ván đã lưu (trên máy) trước khi chơi tiếp */
  function validState(s) {
    return Boolean(
      s && typeof s === 'object' && Array.isArray(s.board) && s.board.length === SIZE * SIZE &&
      s.board.every((v) => Number.isInteger(v) && v >= 0 && v <= COLORS) &&
      Array.isArray(s.tray) && s.tray.length === 3 &&
      s.tray.every((p) => p === null || (p && shapeOf(p.shape) && Number.isInteger(p.color))) &&
      [s.score, s.moves, s.lines, s.combo, s.sinceClear, s.startedAt].every((v) => Number.isFinite(v) && v >= 0) &&
      typeof s.id === 'string'
    );
  }

  const isOver = (s) => s.tray.every((p) => !p || !fitsAnywhere(s.board, p.shape)) && s.tray.some(Boolean);

  /**
   * Đặt khối ở ô tray[slot] vào (r, c). Trả về trạng thái mới và chuyện gì vừa xảy ra
   * (ô vừa đặt, hàng/cột bị xóa, điểm được cộng, combo, dọn sạch bàn, hết nước) để giao diện vẽ hiệu ứng và phát tiếng.
   */
  function place(state, slot, r, c, rand = Math.random) {
    const p = state.tray[slot];
    if (state.over || !p || !canPlace(state.board, p.shape, r, c)) return null;
    const s = shapeOf(p.shape);
    const board = state.board.slice();
    const placed = s.cells.map(([dr, dc]) => (r + dr) * SIZE + c + dc);
    for (const i of placed) board[i] = p.color;
    const { rows, cols } = fullLines(board);
    const cleared = new Set();
    for (const row of rows) for (let j = 0; j < SIZE; j++) cleared.add(row * SIZE + j);
    for (const col of cols) for (let j = 0; j < SIZE; j++) cleared.add(j * SIZE + col);
    // Màu của các ô bị xóa (để vẽ hiệu ứng vỡ ra)
    const clearedCells = [...cleared].map((i) => ({ i, color: board[i] }));
    for (const i of cleared) board[i] = 0;

    const n = rows.length + cols.length;
    let combo = state.combo;
    let sinceClear = state.sinceClear;
    let gained = s.cells.length;
    let linePoints = 0;
    let allClear = false;
    if (n > 0) {
      combo += 1;
      sinceClear = 0;
      linePoints = LINE_POINTS[Math.min(n, LINE_POINTS.length - 1)] * Math.min(combo, MAX_MULTIPLIER);
      gained += linePoints;
      if (board.every((v) => !v)) {
        allClear = true;
        gained += ALL_CLEAR;
      }
    } else {
      sinceClear += 1;
      if (sinceClear >= COMBO_GRACE) combo = 0;
    }

    let tray = state.tray.map((x, k) => (k === slot ? null : x));
    let refilled = false;
    if (tray.every((x) => !x)) {
      tray = newTray(board, rand);
      refilled = true;
    }
    const next = {
      ...state,
      board,
      tray,
      score: state.score + gained,
      combo,
      sinceClear,
      moves: state.moves + 1,
      lines: state.lines + n,
    };
    next.over = isOver(next);
    return {
      state: next,
      placed,
      rows,
      cols,
      clearedCells,
      lines: n,
      gained,
      linePoints,
      combo: n > 0 ? combo : 0,
      allClear,
      refilled,
      over: next.over,
    };
  }

  /** Lời khen khi ăn nhiều hàng một lúc */
  function praise(lines, combo) {
    if (lines >= 5) return 'Không thể tin nổi!';
    if (lines === 4) return 'Xuất sắc!';
    if (lines === 3) return 'Tuyệt vời!';
    if (lines === 2) return 'Tốt lắm!';
    if (combo >= 3) return 'Liên hoàn!';
    return '';
  }

  return {
    SIZE,
    COLORS,
    LINE_POINTS,
    MAX_MULTIPLIER,
    ALL_CLEAR,
    COMBO_GRACE,
    SHAPES,
    shapeOf,
    emptyBoard,
    canPlace,
    fitsAnywhere,
    linesIfPlaced,
    fullLines,
    newTray,
    newGame,
    validState,
    isOver,
    place,
    praise,
  };
});
