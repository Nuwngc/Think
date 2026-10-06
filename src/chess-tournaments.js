'use strict';
// Giải đấu cờ vua vòng tròn giữa bạn bè: một người tạo giải, mời 2–7 người, ai nhận lời thì vào giải.
// Bắt đầu: mỗi cặp một ván (hoặc hai ván đổi màu), cờ theo ngày nên ai rảnh lúc nào đi lúc đó.
// Điểm: thắng 1, hòa ½, thua 0; bằng điểm thì xét hệ số Sonneborn-Berger rồi số ván thắng.
// Mọi ván xong thì giải kết thúc, báo nhà vô địch cho cả giải. src/chess.js gọi setupTournaments().
const { db, get, all, run, transaction } = require('./db');

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const MAX_OPEN = 3; // mỗi người tạo tối đa 3 giải chưa xong
const NAME_MAX = 40;
// "Giải mùa thu" giữ nguyên, "Cờ nhà" thành "Giải Cờ nhà"
const tLabel = (name) => (/^giải\s/i.test(name) ? name : `Giải ${name}`);

db.exec(`
  CREATE TABLE IF NOT EXISTS chess_tournaments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    daily_ms INTEGER NOT NULL DEFAULT 0,
    rated INTEGER NOT NULL DEFAULT 0,
    rounds INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chess_tournament_players (
    tournament_id INTEGER NOT NULL REFERENCES chess_tournaments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    answered_at INTEGER,
    PRIMARY KEY (tournament_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_chess_tp_user ON chess_tournament_players(user_id);
`);

/** Bảng xếp hạng từ các ván của giải (hàm thuần, có kiểm thử) */
function standingsOf(playerIds, games) {
  const rows = new Map(playerIds.map((id) => [id, { userId: id, points: 0, played: 0, wins: 0, draws: 0, losses: 0, sb: 0, left: 0 }]));
  const results = []; // [a, b, điểm của a]
  for (const g of games) {
    const w = rows.get(g.white_id);
    const b = rows.get(g.black_id);
    if (!w || !b) continue;
    if (g.status !== 'finished' || !g.result) {
      if (g.status === 'active') {
        w.left++;
        b.left++;
      }
      continue;
    }
    const sw = g.result === '1-0' ? 1 : g.result === '0-1' ? 0 : 0.5;
    w.points += sw;
    b.points += 1 - sw;
    w.played++;
    b.played++;
    if (sw === 1) {
      w.wins++;
      b.losses++;
    } else if (sw === 0) {
      b.wins++;
      w.losses++;
    } else {
      w.draws++;
      b.draws++;
    }
    results.push([g.white_id, g.black_id, sw]);
  }
  // Sonneborn-Berger: cộng điểm của những người mình thắng, nửa điểm của những người mình hòa
  for (const [a, b, sa] of results) {
    rows.get(a).sb += sa * rows.get(b).points;
    rows.get(b).sb += (1 - sa) * rows.get(a).points;
  }
  const list = [...rows.values()].sort((x, y) => y.points - x.points || y.sb - x.sb || y.wins - x.wins || x.userId - y.userId);
  let rank = 0;
  list.forEach((r, i) => {
    const prev = list[i - 1];
    if (!prev || prev.points !== r.points || prev.sb !== r.sb || prev.wins !== r.wins) rank = i + 1;
    r.rank = rank;
  });
  return list;
}

/** Các cặp đấu của giải vòng tròn; rounds = 2: mỗi cặp hai ván đổi màu. Màu quân chia đều (xen kẽ theo thứ tự) */
function pairingsOf(playerIds, rounds = 1) {
  const out = [];
  const n = playerIds.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const swap = (i + j) % 2 === 1;
      const [w, b] = swap ? [playerIds[j], playerIds[i]] : [playerIds[i], playerIds[j]];
      out.push([w, b]);
      if (rounds === 2) out.push([b, w]);
    }
  }
  return out;
}

/** Số giải người này đã vô địch (thành tựu "Nhà vô địch") */
function cupsOf(uid) {
  let n = 0;
  const rows = all(
    `SELECT t.id FROM chess_tournaments t JOIN chess_tournament_players p ON p.tournament_id = t.id
      WHERE t.status = 'finished' AND p.user_id = ? AND p.status = 'joined'`,
    uid
  );
  for (const t of rows) {
    const joined = all("SELECT user_id FROM chess_tournament_players WHERE tournament_id = ? AND status = 'joined'", t.id).map((p) => p.user_id);
    const games = all('SELECT white_id, black_id, status, result FROM chess_games WHERE tournament_id = ?', t.id);
    if (standingsOf(joined, games).some((r) => r.rank === 1 && r.userId === uid)) n++;
  }
  return n;
}

function setupTournaments({ app, auth, handle, ChessError, emitTo, pushIfAway, nameOf, arm, startFen, dailyDays, dayMs }) {
  const loadT = (id) => get('SELECT * FROM chess_tournaments WHERE id = ?', Number(id));
  const playersOf = (tid) => all('SELECT * FROM chess_tournament_players WHERE tournament_id = ? ORDER BY rowid', tid);
  const gamesOf = (tid) => all('SELECT id, white_id, black_id, status, result, reason, moves, updated_at FROM chess_games WHERE tournament_id = ? ORDER BY id', tid);

  function serializeT(t) {
    const players = playersOf(t.id);
    const joined = players.filter((p) => p.status === 'joined').map((p) => p.user_id);
    const games = t.status === 'open' || t.status === 'cancelled' ? [] : gamesOf(t.id);
    const standings = games.length ? standingsOf(joined, games) : joined.map((id, i) => ({ userId: id, points: 0, played: 0, wins: 0, draws: 0, losses: 0, sb: 0, left: 0, rank: i + 1 }));
    return {
      id: t.id,
      name: t.name,
      creatorId: t.creator_id,
      status: t.status,
      daily: t.daily_ms,
      rated: Boolean(t.rated),
      rounds: t.rounds,
      createdAt: t.created_at,
      startedAt: t.started_at || null,
      endedAt: t.ended_at || null,
      players: players.map((p) => ({ userId: p.user_id, status: p.status })),
      standings,
      games: games.map((g) => {
        const plies = g.moves ? g.moves.split(' ').length : 0;
        return { id: g.id, whiteId: g.white_id, blackId: g.black_id, status: g.status, result: g.result || null, reason: g.reason || null, plies, turn: plies % 2 === 0 ? 'w' : 'b' };
      }),
      winners: t.status === 'finished' ? standings.filter((s) => s.rank === 1).map((s) => s.userId) : [],
    };
  }

  const memberIds = (tid) => playersOf(tid).filter((p) => p.status !== 'declined').map((p) => p.user_id);
  function emitT(t) {
    emitTo(playersOf(t.id).map((p) => p.user_id), 'chess:tournament', { tournament: serializeT(t) });
  }

  /** Bắt đầu giải: tạo mọi ván (cờ theo ngày, đang chơi ngay), bỏ những người chưa trả lời */
  function start(t, now = Date.now()) {
    const joined = playersOf(t.id).filter((p) => p.status === 'joined').map((p) => p.user_id);
    if (joined.length < MIN_PLAYERS) throw new ChessError(409, `Cần ít nhất ${MIN_PLAYERS} người nhận lời mới bắt đầu được.`);
    const ids = [];
    transaction(() => {
      run("UPDATE chess_tournament_players SET status = 'declined', answered_at = ? WHERE tournament_id = ? AND status = 'invited'", now, t.id);
      run("UPDATE chess_tournaments SET status = 'active', started_at = ?, updated_at = ? WHERE id = ?", now, now, t.id);
      for (const [w, b] of pairingsOf(joined, t.rounds)) {
        ids.push(Number(run(
          `INSERT INTO chess_games (status, white_id, black_id, challenger_id, opponent_id, color_pref, rated, base_ms, inc_ms, daily_ms, moves, fen,
             created_at, started_at, turn_started_at, updated_at, tournament_id)
           VALUES ('active', ?, ?, ?, ?, 'white', ?, 0, 0, ?, '', ?, ?, ?, ?, ?, ?)`,
          w, b, w, b, t.rated ? 1 : 0, t.daily_ms, startFen, now, now, now, now, t.id
        ).lastInsertRowid));
      }
    });
    for (const id of ids) arm(get('SELECT * FROM chess_games WHERE id = ?', id));
    const next = loadT(t.id);
    emitT(next);
    const perPlayer = (joined.length - 1) * t.rounds;
    for (const uid of joined) {
      pushIfAway(uid, { title: '🏆 Giải đấu bắt đầu', body: `${t.name}: bạn có ${perPlayer} ván, mỗi nước ${Math.round(t.daily_ms / dayMs)} ngày.`, tag: `chess-t-${t.id}`, url: `/#/chess/t/${t.id}`, tournamentId: t.id });
    }
    // Báo cho mọi người cập nhật danh sách ván
    emitTo(joined, 'chess:refresh', { tournamentId: t.id });
    return next;
  }

  /** Một ván của giải vừa xong: giải hết ván thì kết thúc, báo nhà vô địch */
  function onGameFinished(tid) {
    const t = loadT(tid);
    if (!t || t.status !== 'active') return;
    const games = gamesOf(tid);
    const now = Date.now();
    if (games.some((g) => g.status === 'active')) {
      run('UPDATE chess_tournaments SET updated_at = ? WHERE id = ?', now, tid);
      emitT(loadT(tid));
      return;
    }
    run("UPDATE chess_tournaments SET status = 'finished', ended_at = ?, updated_at = ? WHERE id = ?", now, now, tid);
    const done = loadT(tid);
    const out = serializeT(done);
    emitT(done);
    const names = out.winners.map((id) => nameOf(id)).join(', ');
    for (const s of out.standings) {
      pushIfAway(s.userId, {
        title: '🏆 Giải đấu kết thúc',
        body: out.winners.includes(s.userId) ? `Bạn vô địch ${tLabel(done.name)}!` : `${names} vô địch ${tLabel(done.name)}. Bạn đứng thứ ${s.rank}.`,
        tag: `chess-t-${tid}`,
        url: `/#/chess/t/${tid}`,
        tournamentId: tid,
      });
    }
  }

  /* ---------------- API ---------------- */

  // Giải của tôi (đang mời, đang đấu, đã xong gần đây)
  app.get('/api/chess/tournaments', ...auth, handle((req, res) => {
    const rows = all(
      `SELECT t.* FROM chess_tournaments t JOIN chess_tournament_players p ON p.tournament_id = t.id
        WHERE p.user_id = ? AND p.status != 'declined' AND t.status != 'cancelled'
        ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, t.updated_at DESC LIMIT 30`,
      req.user.id
    );
    res.json({ tournaments: rows.map(serializeT), dailyDays });
  }));

  // Xem một giải (ai cũng xem được: hội bạn bè)
  app.get('/api/chess/tournaments/:id', ...auth, handle((req, res) => {
    const t = loadT(req.params.id);
    if (!t) throw new ChessError(404, 'Không tìm thấy giải đấu.');
    res.json({ tournament: serializeT(t) });
  }));

  // Tạo giải: { name, players: [mã người], days, rated, rounds }
  app.post('/api/chess/tournaments', ...auth, handle((req, res) => {
    const uid = req.user.id;
    const name = String(req.body?.name || '').trim().slice(0, NAME_MAX) || `Giải của ${nameOf(uid)}`;
    const days = Number(req.body?.days);
    if (!dailyDays.includes(days)) throw new ChessError(400, 'Chọn số ngày mỗi nước (1, 2, 3 hoặc 7).');
    const rounds = Number(req.body?.rounds) === 2 ? 2 : 1;
    const raw = Array.isArray(req.body?.players) ? req.body.players.map(Number) : [];
    const others = [...new Set(raw.filter((id) => Number.isInteger(id) && id !== uid))];
    if (others.length < MIN_PLAYERS - 1) throw new ChessError(400, `Mời ít nhất ${MIN_PLAYERS - 1} người (giải có từ ${MIN_PLAYERS} người).`);
    if (others.length > MAX_PLAYERS - 1) throw new ChessError(400, `Giải có tối đa ${MAX_PLAYERS} người.`);
    for (const id of others) {
      const u = get('SELECT id, disabled FROM users WHERE id = ?', id);
      if (!u || u.disabled) throw new ChessError(404, 'Có người không còn dùng Think nữa.');
    }
    const open = get("SELECT COUNT(*) AS n FROM chess_tournaments WHERE creator_id = ? AND status IN ('open', 'active')", uid).n;
    if (open >= MAX_OPEN) throw new ChessError(429, `Bạn đang có ${MAX_OPEN} giải chưa xong. Đợi một giải xong rồi tạo tiếp nhé.`);
    const now = Date.now();
    let id;
    transaction(() => {
      id = Number(run(
        `INSERT INTO chess_tournaments (name, creator_id, status, daily_ms, rated, rounds, created_at, updated_at)
         VALUES (?, ?, 'open', ?, ?, ?, ?, ?)`,
        name, uid, Math.round(days * dayMs), req.body?.rated ? 1 : 0, rounds, now, now
      ).lastInsertRowid);
      run("INSERT INTO chess_tournament_players (tournament_id, user_id, status, answered_at) VALUES (?, ?, 'joined', ?)", id, uid, now);
      for (const o of others) run("INSERT INTO chess_tournament_players (tournament_id, user_id, status) VALUES (?, ?, 'invited')", id, o);
    });
    const t = loadT(id);
    emitT(t);
    for (const o of others) {
      pushIfAway(o, { title: '🏆 Mời vào giải đấu cờ vua', body: `${nameOf(uid)} mời bạn vào ${tLabel(name)} (${others.length + 1} người, cờ theo ngày).`, tag: `chess-t-${id}`, url: `/#/chess/t/${id}`, tournamentId: id });
    }
    res.json({ tournament: serializeT(t) });
  }));

  function answer(req, action) {
    const t = loadT(req.params.id);
    if (!t) throw new ChessError(404, 'Không tìm thấy giải đấu.');
    const uid = req.user.id;
    const now = Date.now();
    if (action === 'start' || action === 'cancel') {
      if (t.creator_id !== uid) throw new ChessError(403, 'Chỉ người tạo giải mới làm được.');
      if (t.status !== 'open') throw new ChessError(409, 'Giải đã bắt đầu hoặc đã xong.');
      if (action === 'start') return start(t, now);
      run("UPDATE chess_tournaments SET status = 'cancelled', updated_at = ? WHERE id = ?", now, t.id);
      const next = loadT(t.id);
      emitT(next);
      return next;
    }
    const me = get('SELECT * FROM chess_tournament_players WHERE tournament_id = ? AND user_id = ?', t.id, uid);
    if (!me) throw new ChessError(403, 'Bạn không được mời vào giải này.');
    if (t.status !== 'open') throw new ChessError(409, 'Giải đã bắt đầu, không đổi được nữa.');
    if (t.creator_id === uid) throw new ChessError(409, 'Bạn là người tạo giải.');
    run('UPDATE chess_tournament_players SET status = ?, answered_at = ? WHERE tournament_id = ? AND user_id = ?', action === 'join' ? 'joined' : 'declined', now, t.id, uid);
    run('UPDATE chess_tournaments SET updated_at = ? WHERE id = ?', now, t.id);
    pushIfAway(t.creator_id, {
      title: '🏆 Giải đấu',
      body: `${nameOf(uid)} ${action === 'join' ? 'đã nhận lời vào' : 'đã từ chối'} ${tLabel(t.name)}.`,
      tag: `chess-t-${t.id}`,
      url: `/#/chess/t/${t.id}`,
      tournamentId: t.id,
    });
    // Mọi người đã trả lời và đủ người: tự bắt đầu
    const players = playersOf(t.id);
    if (!players.some((p) => p.status === 'invited') && players.filter((p) => p.status === 'joined').length >= MIN_PLAYERS) return start(loadT(t.id), now);
    const next = loadT(t.id);
    emitT(next);
    return next;
  }

  for (const action of ['join', 'decline', 'start', 'cancel']) {
    app.post(`/api/chess/tournaments/:id/${action}`, ...auth, handle((req, res) => res.json({ tournament: serializeT(answer(req, action)) })));
  }

  return { onGameFinished, nameOfT: (id) => loadT(id)?.name || null, memberIds };
}

module.exports = { setupTournaments, standingsOf, pairingsOf, cupsOf, MIN_PLAYERS, MAX_PLAYERS };
