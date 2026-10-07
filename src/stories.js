'use strict';
// Tin 24 giờ (story, 2.13.0): đăng ảnh (kèm chú thích) hoặc dòng chữ trên nền màu, tự mất sau 24 giờ.
// - Cả nhóm xem được tin của nhau (giống bảng tin). Người đăng xem được ai đã xem, ai thả cảm xúc.
// - Thả cảm xúc / trả lời một tin = gửi tin nhắn riêng cho người đăng, tin nhắn có kèm "story" (ảnh nhỏ của tin)
//   để web và app vẽ khung "Đã trả lời tin của bạn". Tin hết hạn thì khung ghi "Tin không còn xem được".
// - Hết 24 giờ: máy chủ xóa tin và ảnh (dọn mỗi 5 phút), web / app cũng tự ẩn theo expiresAt.
// Màu nền chữ (STORY_BGS) có hai bản giống nhau: public/stories-ui.js và native/src/stories/bgs.ts.
const { db, get, all, run } = require('./db');

const TTL = 24 * 3600_000;
const MAX_TEXT = 250; // tin chữ
const MAX_CAPTION = 200; // chú thích ảnh
const MAX_ACTIVE = 30; // mỗi người tối đa 30 tin đang hiện
const MAX_REPLY = 1000;
const STORY_BGS = ['jade', 'sunset', 'berry', 'ocean', 'grape', 'night'];
const REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'];
const SWEEP_MS = 5 * 60_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    image TEXT,
    text TEXT,
    bg TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
  CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, id);
  CREATE TABLE IF NOT EXISTS story_views (
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at INTEGER NOT NULL,
    reaction TEXT,
    PRIMARY KEY (story_id, user_id)
  );
`);

class StoryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cleanText(value, max, what) {
  const s = String(value ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length > max) throw new StoryError(400, `${what} dài quá ${max} ký tự.`);
  return s;
}

/** Tin còn xem được không (cho khung "Đã trả lời tin của bạn" trong tin nhắn) */
function storyAlive(id, now = Date.now()) {
  const row = get('SELECT expires_at FROM stories WHERE id = ?', Number(id));
  return Boolean(row && row.expires_at > now);
}

function serialize(r, viewerId) {
  const out = {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    image: r.image || null,
    text: r.text || '',
    bg: r.bg || null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    seen: r.user_id === viewerId ? true : Boolean(r.seen),
  };
  if (r.user_id === viewerId) {
    out.views = r.views || 0;
    out.reactions = r.reactions || 0;
  } else if (r.my_reaction) out.myReaction = r.my_reaction;
  return out;
}

function storiesFor(viewerId, now = Date.now()) {
  return all(
    `SELECT s.*,
            EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.user_id = :viewer) AS seen,
            (SELECT v.reaction FROM story_views v WHERE v.story_id = s.id AND v.user_id = :viewer) AS my_reaction,
            CASE WHEN s.user_id = :viewer THEN (SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id) END AS views,
            CASE WHEN s.user_id = :viewer THEN (SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id AND v.reaction IS NOT NULL) END AS reactions
       FROM stories s JOIN users u ON u.id = s.user_id
      WHERE s.expires_at > :now AND u.disabled = 0
      ORDER BY s.id`,
    { viewer: viewerId, now }
  ).map((r) => serialize(r, viewerId));
}

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
 * takeUpload(url, userId): nhận ảnh vừa tải lên qua /api/upload; removeUpload(url): xóa ảnh
 * ensureDm(a, b): mã cuộc trò chuyện riêng giữa hai người (tạo nếu chưa có)
 * postMessage(convId, senderId, text, story): gửi tin nhắn (lưu, phát realtime, thông báo đẩy), trả về tin nhắn
 */
function setupStories({ app, io, requireAuth, requireReady, takeUpload, removeUpload, ensureDm, postMessage }) {
  const auth = [requireAuth, requireReady];
  const postLimit = rateLimit(15, 3600_000);
  const replyLimit = rateLimit(40, 60_000);

  const handle = (fn) => (req, res) => {
    try {
      fn(req, res);
    } catch (err) {
      if (err instanceof StoryError) return res.status(err.status).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Máy chủ gặp lỗi. Thử lại sau ít phút.' });
    }
  };

  function storyOf(id) {
    const s = get('SELECT s.*, u.disabled AS author_disabled FROM stories s JOIN users u ON u.id = s.user_id WHERE s.id = ?', Number(id));
    if (!s || s.expires_at <= Date.now() || s.author_disabled) throw new StoryError(404, 'Tin này không còn nữa.');
    return s;
  }

  function remove(s, reason) {
    run('DELETE FROM stories WHERE id = ?', s.id);
    if (s.image) removeUpload(s.image);
    io.emit('story:deleted', { storyId: s.id, userId: s.user_id, reason });
  }

  // Dọn tin hết hạn (xóa cả ảnh)
  function sweep(now = Date.now()) {
    const rows = all('SELECT id, user_id, image FROM stories WHERE expires_at <= ? LIMIT 500', now);
    for (const s of rows) remove(s, 'expired');
    return rows.length;
  }
  sweep();
  setInterval(sweep, SWEEP_MS).unref();

  app.get('/api/stories', ...auth, handle((req, res) => {
    res.json({ stories: storiesFor(req.user.id), serverTime: Date.now() });
  }));

  app.post('/api/stories', ...auth, handle((req, res) => {
    const image = req.body?.image ? String(req.body.image) : null;
    const text = cleanText(req.body?.text, image ? MAX_CAPTION : MAX_TEXT, image ? 'Chú thích' : 'Tin');
    const bg = STORY_BGS.includes(req.body?.bg) ? req.body.bg : STORY_BGS[0];
    if (!image && !text) throw new StoryError(400, 'Tin đang trống. Chọn ảnh hoặc viết vài chữ.');
    const now = Date.now();
    const active = get('SELECT COUNT(*) AS n FROM stories WHERE user_id = ? AND expires_at > ?', req.user.id, now).n;
    if (active >= MAX_ACTIVE) throw new StoryError(400, `Bạn đang có ${MAX_ACTIVE} tin. Xóa bớt tin cũ rồi đăng tiếp nhé.`);
    if (!postLimit(req.user.id)) throw new StoryError(429, 'Bạn đăng tin hơi nhiều rồi, nghỉ tay một lát nhé.');
    // Nhận ảnh sau cùng: tin bị từ chối thì ảnh vẫn dùng lại được
    if (image && !takeUpload(image, req.user.id)) throw new StoryError(400, 'Ảnh đã hết hạn. Hãy chọn lại ảnh.');
    const id = Number(
      run('INSERT INTO stories (user_id, kind, image, text, bg, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        req.user.id, image ? 'image' : 'text', image, text || null, image ? null : bg, now, now + TTL).lastInsertRowid
    );
    const row = get('SELECT * FROM stories WHERE id = ?', id);
    const story = serialize({ ...row, views: 0, reactions: 0 }, req.user.id);
    // Người khác nhận bản "chưa xem"
    io.emit('story:new', { story: serialize(row, -1) });
    res.json({ story });
  }));

  app.delete('/api/stories/:id', ...auth, handle((req, res) => {
    const s = get('SELECT id, user_id, image FROM stories WHERE id = ?', Number(req.params.id));
    if (!s) throw new StoryError(404, 'Tin này không còn nữa.');
    if (s.user_id !== req.user.id && req.user.role !== 'admin') throw new StoryError(403, 'Bạn chỉ xóa được tin của mình.');
    remove(s, 'deleted');
    res.json({ ok: true });
  }));

  // Đã xem (người đăng không tính)
  app.post('/api/stories/:id/view', ...auth, handle((req, res) => {
    const s = storyOf(req.params.id);
    if (s.user_id !== req.user.id) {
      const added = run('INSERT OR IGNORE INTO story_views (story_id, user_id, viewed_at) VALUES (?, ?, ?)', s.id, req.user.id, Date.now()).changes > 0;
      if (added) {
        const views = get('SELECT COUNT(*) AS n FROM story_views WHERE story_id = ?', s.id).n;
        io.to(`user:${s.user_id}`).emit('story:viewed', { storyId: s.id, views });
      }
    }
    res.json({ ok: true });
  }));

  // Ai đã xem (chỉ người đăng, admin)
  app.get('/api/stories/:id/viewers', ...auth, handle((req, res) => {
    const s = storyOf(req.params.id);
    if (s.user_id !== req.user.id && req.user.role !== 'admin') throw new StoryError(403, 'Chỉ người đăng xem được ai đã xem tin.');
    const viewers = all(
      `SELECT v.user_id, v.viewed_at, v.reaction FROM story_views v JOIN users u ON u.id = v.user_id
        WHERE v.story_id = ? AND u.disabled = 0 ORDER BY (v.reaction IS NULL), v.viewed_at DESC`,
      s.id
    ).map((v) => ({ userId: v.user_id, viewedAt: v.viewed_at, reaction: v.reaction || null }));
    res.json({ viewers });
  }));

  // Thả cảm xúc hoặc trả lời: gửi tin nhắn riêng cho người đăng
  app.post('/api/stories/:id/reply', ...auth, handle((req, res) => {
    const s = storyOf(req.params.id);
    if (s.user_id === req.user.id) throw new StoryError(400, 'Đây là tin của bạn.');
    const emoji = req.body?.emoji != null ? String(req.body.emoji) : null;
    if (emoji != null && !REACTIONS.includes(emoji)) throw new StoryError(400, 'Cảm xúc không hợp lệ.');
    const text = emoji ? emoji : cleanText(req.body?.text, MAX_REPLY, 'Tin nhắn');
    if (!text) throw new StoryError(400, 'Tin nhắn đang trống.');
    if (!replyLimit(req.user.id)) throw new StoryError(429, 'Bạn gửi nhanh quá, đợi một chút nhé.');
    const now = Date.now();
    run(
      `INSERT INTO story_views (story_id, user_id, viewed_at, reaction) VALUES (?, ?, ?, ?)
       ON CONFLICT(story_id, user_id) DO UPDATE SET reaction = COALESCE(excluded.reaction, story_views.reaction)`,
      s.id, req.user.id, now, emoji
    );
    const views = get('SELECT COUNT(*) AS n FROM story_views WHERE story_id = ?', s.id).n;
    io.to(`user:${s.user_id}`).emit('story:viewed', { storyId: s.id, views, reaction: emoji ? { userId: req.user.id, emoji } : undefined });
    const convId = ensureDm(req.user.id, s.user_id);
    const snap = { id: s.id, ownerId: s.user_id, kind: s.kind, image: s.image || null, text: s.text ? s.text.slice(0, 120) : '', bg: s.bg || null, reaction: Boolean(emoji) };
    const message = postMessage(convId, req.user.id, text, snap);
    res.json({ message, conversationId: convId });
  }));

  return { sweep, storiesFor };
}

module.exports = { setupStories, storyAlive, STORY_BGS, REACTIONS, TTL, MAX_TEXT, MAX_CAPTION };
