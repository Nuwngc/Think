'use strict';
// Trang cá nhân và bảng tin: đăng bài (chữ, ảnh, ván cờ), thả tim, bình luận.
// Mọi thành viên trong nhóm đều xem được bài của nhau (nhóm riêng, tài khoản do admin cấp).
const { get, all, run, transaction } = require('./db');

const MAX_POST = 2000;
const MAX_COMMENT = 1000;
const PAGE = 20;

class SocialError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanText(value, max) {
  const s = String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (s.length > max) throw new SocialError(400, `Nội dung dài quá ${max} ký tự.`);
  return s;
}

// Giới hạn tốc độ đơn giản trong bộ nhớ: tối đa n lần trong ms
function rateLimit(n, ms) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < ms);
    if (list.length >= n) return false;
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) hits.clear();
    return true;
  };
}

/**
 * app, io: máy chủ Express + Socket.IO
 * takeUpload(url, userId): nhận ảnh vừa tải lên qua /api/upload (trả false nếu không hợp lệ)
 * removeUpload(url): xóa ảnh khỏi máy chủ
 * gameForShare(id): ván cờ đã rút gọn để hiện trong bài đăng (null nếu không có)
 * notify(userId, payload), isActive(userId): thông báo đẩy khi người đó không mở app
 */
function setupSocial({ app, io, requireAuth, requireReady, takeUpload, removeUpload, gameForShare, notify, isActive, nameOf }) {
  const auth = [requireAuth, requireReady];
  const postLimit = rateLimit(8, 10 * 60 * 1000);
  const commentLimit = rateLimit(30, 60 * 1000);
  const likeLimit = rateLimit(120, 60 * 1000);

  const handle = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof SocialError) return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Máy chủ gặp lỗi. Thử lại sau ít phút.' });
    }
  };

  const pushIfAway = (uid, payload) => {
    if (uid == null || isActive(uid)) return;
    notify(uid, payload).catch((err) => console.warn('[push]', err.message));
  };

  /* ----- Chuyển bài đăng ra JSON ----- */

  function serialize(rows, viewerId) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const marks = ids.map(() => '?').join(',');
    const likes = new Map(all(`SELECT post_id, COUNT(*) AS n FROM post_likes WHERE post_id IN (${marks}) GROUP BY post_id`, ...ids).map((r) => [r.post_id, r.n]));
    const comments = new Map(all(`SELECT post_id, COUNT(*) AS n FROM post_comments WHERE post_id IN (${marks}) GROUP BY post_id`, ...ids).map((r) => [r.post_id, r.n]));
    const mine = new Set(all(`SELECT post_id FROM post_likes WHERE user_id = ? AND post_id IN (${marks})`, viewerId, ...ids).map((r) => r.post_id));
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      text: r.text || '',
      image: r.image || null,
      game: r.game_id ? gameForShare(r.game_id) : null,
      createdAt: r.created_at,
      likes: likes.get(r.id) || 0,
      liked: mine.has(r.id),
      comments: comments.get(r.id) || 0,
    }));
  }
  const one = (id, viewerId) => serialize(all('SELECT * FROM posts WHERE id = ?', id), viewerId)[0] || null;

  const serializeComment = (c) => ({ id: c.id, postId: c.post_id, userId: c.user_id, text: c.text, createdAt: c.created_at });

  // Bài của tài khoản đã bị khóa: ẩn với mọi người (trừ admin), giống bảng tin
  function postOf(id, req) {
    const p = get('SELECT p.*, u.disabled AS author_disabled FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?', Number(id));
    if (!p || (p.author_disabled && req.user.role !== 'admin')) throw new SocialError(404, 'Bài đăng không còn nữa.');
    return p;
  }

  function page(where, params, req) {
    const before = Number(req.query.before) > 0 ? Number(req.query.before) : Number.MAX_SAFE_INTEGER;
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || PAGE));
    const rows = all(
      `SELECT p.* FROM posts p JOIN users u ON u.id = p.user_id WHERE ${where} AND p.id < ? ORDER BY p.id DESC LIMIT ?`,
      ...params, before, limit + 1
    );
    return { posts: serialize(rows.slice(0, limit), req.user.id), hasMore: rows.length > limit };
  }

  /* ----- Trang cá nhân ----- */

  app.get('/api/users/:id/profile', ...auth, handle((req, res) => {
    const u = get('SELECT id FROM users WHERE id = ?', Number(req.params.id));
    if (!u) throw new SocialError(404, 'Không tìm thấy người này.');
    const posts = get('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?', u.id).n;
    const likes = get('SELECT COUNT(*) AS n FROM post_likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?', u.id).n;
    const chess = get('SELECT rating, games, wins FROM chess_ratings WHERE user_id = ?', u.id);
    res.json({ stats: { posts, likes, chess: chess ? { rating: chess.rating, games: chess.games, wins: chess.wins } : null } });
  }));

  // Bảng tin: bài mới của cả nhóm
  app.get('/api/posts', ...auth, handle((req, res) => {
    res.json(page('u.disabled = 0', [], req));
  }));

  // Bài của một người
  app.get('/api/users/:id/posts', ...auth, handle((req, res) => {
    res.json(page('p.user_id = ? AND (u.disabled = 0 OR ?)', [Number(req.params.id), req.user.role === 'admin' ? 1 : 0], req));
  }));

  app.get('/api/posts/:id', ...auth, handle((req, res) => {
    res.json({ post: one(postOf(req.params.id, req).id, req.user.id) });
  }));

  /* ----- Đăng, xóa bài ----- */

  app.post('/api/posts', ...auth, handle((req, res) => {
    const text = cleanText(req.body?.text, MAX_POST);
    const image = req.body?.image ? String(req.body.image) : null;
    let gameId = null;
    if (req.body?.gameId != null) {
      const g = get('SELECT id, status, white_id, black_id FROM chess_games WHERE id = ?', Number(req.body.gameId));
      if (!g || (g.white_id !== req.user.id && g.black_id !== req.user.id)) throw new SocialError(400, 'Bạn chỉ chia sẻ được ván cờ mình đã chơi.');
      if (!['active', 'finished', 'aborted'].includes(g.status)) throw new SocialError(400, 'Ván cờ này chưa bắt đầu.');
      gameId = g.id;
    }
    if (!text && !image && !gameId) throw new SocialError(400, 'Bài đăng đang trống.');
    if (!postLimit(req.user.id)) throw new SocialError(429, 'Bạn đăng hơi nhiều rồi, nghỉ tay vài phút nhé.');
    // Nhận ảnh sau cùng: bài bị từ chối (ván cờ sai, đăng quá nhanh…) thì ảnh vẫn dùng lại được
    if (image && !takeUpload(image, req.user.id)) throw new SocialError(400, 'Ảnh đã hết hạn. Hãy chọn lại ảnh.');
    const now = Date.now();
    const id = Number(run('INSERT INTO posts (user_id, text, image, game_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      req.user.id, text || null, image, gameId, now, now).lastInsertRowid);
    const post = one(id, req.user.id);
    io.emit('post:new', { post: { ...post, liked: false } });
    res.json({ post });
  }));

  app.delete('/api/posts/:id', ...auth, handle((req, res) => {
    const p = postOf(req.params.id, req);
    if (p.user_id !== req.user.id && req.user.role !== 'admin') throw new SocialError(403, 'Bạn chỉ xóa được bài của mình.');
    run('DELETE FROM posts WHERE id = ?', p.id);
    if (p.image) removeUpload(p.image);
    io.emit('post:deleted', { postId: p.id });
    res.json({ ok: true });
  }));

  /* ----- Thả tim ----- */

  app.post('/api/posts/:id/like', ...auth, handle((req, res) => {
    const p = postOf(req.params.id, req);
    if (!likeLimit(req.user.id)) throw new SocialError(429, 'Chậm lại một chút nhé.');
    const want = req.body?.liked === undefined ? null : Boolean(req.body.liked);
    const had = Boolean(get('SELECT 1 AS x FROM post_likes WHERE post_id = ? AND user_id = ?', p.id, req.user.id));
    const liked = want == null ? !had : want;
    if (liked && !had) run('INSERT OR IGNORE INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)', p.id, req.user.id, Date.now());
    if (!liked && had) run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', p.id, req.user.id);
    const likes = get('SELECT COUNT(*) AS n FROM post_likes WHERE post_id = ?', p.id).n;
    io.emit('post:likes', { postId: p.id, likes, userId: req.user.id, liked });
    if (liked && !had && p.user_id !== req.user.id) {
      pushIfAway(p.user_id, {
        type: 'post',
        actorId: req.user.id,
        title: `${nameOf(req.user.id)} đã thả ❤️`,
        body: p.text ? `vào bài: “${String(p.text).slice(0, 80)}”` : 'vào bài đăng của bạn.',
        tag: `post-${p.id}`,
        url: `/#/p/${p.id}`,
        postId: p.id,
      });
    }
    res.json({ liked, likes });
  }));

  app.get('/api/posts/:id/likes', ...auth, handle((req, res) => {
    const p = postOf(req.params.id, req);
    res.json({ userIds: all('SELECT user_id FROM post_likes WHERE post_id = ? ORDER BY created_at DESC LIMIT 500', p.id).map((r) => r.user_id) });
  }));

  /* ----- Bình luận ----- */

  app.get('/api/posts/:id/comments', ...auth, handle((req, res) => {
    const p = postOf(req.params.id, req);
    const rows = all('SELECT * FROM post_comments WHERE post_id = ? ORDER BY id LIMIT 500', p.id);
    res.json({ comments: rows.map(serializeComment) });
  }));

  app.post('/api/posts/:id/comments', ...auth, handle((req, res) => {
    const p = postOf(req.params.id, req);
    const text = cleanText(req.body?.text, MAX_COMMENT);
    if (!text) throw new SocialError(400, 'Bình luận đang trống.');
    if (!commentLimit(req.user.id)) throw new SocialError(429, 'Bạn bình luận hơi nhanh, chờ một chút nhé.');
    const id = Number(run('INSERT INTO post_comments (post_id, user_id, text, created_at) VALUES (?, ?, ?, ?)', p.id, req.user.id, text, Date.now()).lastInsertRowid);
    const comment = serializeComment(get('SELECT * FROM post_comments WHERE id = ?', id));
    const count = get('SELECT COUNT(*) AS n FROM post_comments WHERE post_id = ?', p.id).n;
    io.emit('post:comment', { postId: p.id, comments: count, comment });
    // Báo cho chủ bài và những người đã bình luận trước đó
    const notifyIds = new Set([p.user_id, ...all('SELECT DISTINCT user_id FROM post_comments WHERE post_id = ?', p.id).map((r) => r.user_id)]);
    notifyIds.delete(req.user.id);
    for (const uid of notifyIds) {
      pushIfAway(uid, {
        type: 'post',
        actorId: req.user.id,
        title: uid === p.user_id ? `${nameOf(req.user.id)} đã bình luận bài của bạn` : `${nameOf(req.user.id)} cũng bình luận`,
        body: text.slice(0, 140),
        tag: `post-${p.id}`,
        url: `/#/p/${p.id}`,
        postId: p.id,
      });
    }
    res.json({ comment, comments: count });
  }));

  app.delete('/api/comments/:id', ...auth, handle((req, res) => {
    const c = get('SELECT c.*, p.user_id AS owner_id FROM post_comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?', Number(req.params.id));
    if (!c) throw new SocialError(404, 'Bình luận không còn nữa.');
    if (c.user_id !== req.user.id && c.owner_id !== req.user.id && req.user.role !== 'admin') {
      throw new SocialError(403, 'Bạn không xóa được bình luận này.');
    }
    const count = transaction(() => {
      run('DELETE FROM post_comments WHERE id = ?', c.id);
      return get('SELECT COUNT(*) AS n FROM post_comments WHERE post_id = ?', c.post_id).n;
    });
    io.emit('post:comment-deleted', { postId: c.post_id, commentId: c.id, comments: count });
    res.json({ ok: true, comments: count });
  }));

}

module.exports = { setupSocial, cleanText };
