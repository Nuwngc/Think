import { Image } from "expo-image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { describeGame, myColor } from "../chess/format";
import { API_URL } from "../config";
import { chessShareText, convTitle, timeAgo } from "../format";
import { pickImages, prepareImage, type PreparedImage } from "../images";
import { ImageViewer } from "../screens/ImageViewer";
import { namesOf, sendPrepared, showToast, useStore } from "../store";
import { useColors, type Colors } from "../theme";
import { Avatar, Button, ConvAvatar, FormError, Icon, IconButton, Sheet, useStyles } from "../ui";
import { GameCard, PostCard } from "./PostCard";
import {
  addComment,
  canDeleteComment,
  closeSheet,
  createPost,
  deleteComment,
  openComposer,
  openUser,
  useSocial,
  viewImage,
  type SocialSheet,
} from "./store";

// Các bảng của trang cá nhân / bảng tin: viết bài, bình luận, người đã thích, chia sẻ ván cờ, xem ảnh lớn.
// Đặt một lần ở MainScreen; màn nào cũng mở được qua các hàm trong ./store.

type Of<K extends SocialSheet["kind"]> = Extract<SocialSheet, { kind: K }>;

/** Giữ nội dung bảng trong lúc bảng đang trượt xuống (sau khi đã đóng) */
function useLast<T>(v: T | null): T | null {
  const [last, setLast] = useState<T | null>(v);
  useEffect(() => {
    if (v) setLast(v);
  }, [v]);
  return v || last;
}

export function SocialHost() {
  const sheet = useSocial((s) => s.sheet);
  const viewer = useSocial((s) => s.viewer);
  return (
    <>
      <ComposerSheet sheet={sheet?.kind === "composer" ? sheet : null} />
      <CommentsSheet sheet={sheet?.kind === "comments" ? sheet : null} />
      <LikersSheet sheet={sheet?.kind === "likers" ? sheet : null} />
      <ShareSheet sheet={sheet?.kind === "share" ? sheet : null} />
      <ImageViewer path={viewer} onClose={() => viewImage(null)} />
    </>
  );
}

/* ---------------- Viết bài ---------------- */

function ComposerSheet({ sheet }: { sheet: Of<"composer"> | null }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const cur = useLast(sheet);
  const game = cur?.game || null;
  const [text, setText] = useState("");
  const [img, setImg] = useState<PreparedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setPicking(true);
    try {
      const [asset] = await pickImages({ multiple: false });
      if (asset) setImg(await prepareImage(asset));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa chọn được ảnh.");
    } finally {
      setPicking(false);
    }
  };

  // Mỗi lần mở: bắt đầu bài mới
  useEffect(() => {
    if (!sheet) return;
    setText("");
    setImg(null);
    setError(null);
    setBusy(false);
    if (sheet.pickImage) pick();
  }, [sheet]);

  const submit = async () => {
    if (!text.trim() && !img && !game) {
      setError("Viết gì đó hoặc chọn một ảnh nhé.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await createPost({ text, image: img, game });
      closeSheet();
      showToast(game ? "Đã chia sẻ ván cờ lên trang cá nhân." : "Đã đăng bài.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chưa đăng được bài.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={sheet != null}
      onClose={closeSheet}
      title={game ? "Chia sẻ ván cờ" : "Tạo bài viết"}
      footer={
        <View style={s.row}>
          <Button title={img ? "Đổi ảnh" : "Ảnh"} icon="add-photo-alternate" kind="secondary" busy={picking} onPress={pick} />
          <Button title="Đăng bài" style={{ flex: 1 }} busy={busy} onPress={submit} />
        </View>
      }
    >
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        maxLength={2000}
        placeholder={game ? "Nói gì đó về ván cờ này…" : "Bạn đang nghĩ gì?"}
        placeholderTextColor={c.muted}
        accessibilityLabel="Nội dung bài đăng"
        style={[s.composeInput, { backgroundColor: c.field, color: c.text }]}
        textAlignVertical="top"
      />
      {img ? (
        <View>
          <Image source={{ uri: img.uri }} style={[s.preview, { aspectRatio: img.width / Math.max(1, img.height) }]} contentFit="cover" />
          <IconButton name="close" label="Bỏ ảnh" color="#fff" onPress={() => setImg(null)} style={s.previewX} />
        </View>
      ) : null}
      {game ? <GameCard game={game} /> : null}
      <FormError text={error} />
    </Sheet>
  );
}

/* ---------------- Bình luận ---------------- */

function CommentsSheet({ sheet }: { sheet: Of<"comments"> | null }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const cur = useLast(sheet);
  const postId = cur?.postId ?? -1;
  const post = useSocial((st) => st.posts[postId]);
  const list = useSocial((st) => st.comments[postId]);
  const users = useStore((st) => st.users);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const count = list?.length ?? 0;
  const lastCount = useRef(count);

  useEffect(() => {
    if (sheet) setText("");
  }, [sheet]);
  // Có bình luận mới (của mình hoặc người khác gửi tới): cuộn xuống cuối
  useEffect(() => {
    if (count > lastCount.current) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    lastCount.current = count;
  }, [count]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await addComment(postId, t);
      setText("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Chưa gửi được bình luận.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={sheet != null}
      onClose={closeSheet}
      title="Bình luận"
      scrollRef={scrollRef}
      footer={
        <View style={s.commentBar}>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1000}
            placeholder="Viết bình luận…"
            placeholderTextColor={c.muted}
            accessibilityLabel="Viết bình luận"
            style={[s.commentInput, { backgroundColor: c.field, color: c.text }]}
          />
          <Pressable
            onPress={send}
            disabled={!text.trim() || busy}
            style={({ pressed }) => [s.sendBtn, { backgroundColor: text.trim() ? c.jade : c.field, opacity: pressed ? 0.8 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Gửi bình luận"
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Icon name="arrow-upward" size={22} color={text.trim() ? "#fff" : c.muted} />}
          </Pressable>
        </View>
      }
    >
      {post ? <PostCard post={post} flat /> : <ActivityIndicator color={c.accent} />}
      <View style={[s.divider, { backgroundColor: c.line }]} />
      {!list ? (
        <Text style={s.emptyText}>Đang tải…</Text>
      ) : list.length === 0 ? (
        <Text style={s.emptyText}>Chưa có bình luận nào. Hãy là người đầu tiên!</Text>
      ) : (
        list.map((cm) => {
          const u = users[cm.userId];
          return (
            <View key={cm.id} style={s.comment}>
              <Pressable onPress={() => openUser(cm.userId)} accessibilityLabel={`Trang cá nhân của ${u?.displayName || "Người dùng"}`}>
                <Avatar user={u} size={34} dot={false} />
              </Pressable>
              <View style={{ flexShrink: 1, gap: 3 }}>
                <View style={[s.bubble, { backgroundColor: c.field }]}>
                  <Text style={s.commentName}>{u?.displayName || "Người dùng"}</Text>
                  <Text style={s.commentText} selectable>
                    {cm.text}
                  </Text>
                </View>
                <View style={s.commentMeta}>
                  <Text style={s.meta}>{timeAgo(cm.createdAt)}</Text>
                  {canDeleteComment(cm, post) ? (
                    <Pressable onPress={() => deleteComment(cm)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Xóa bình luận">
                      <Text style={[s.meta, { color: c.danger, fontWeight: "800" }]}>Xóa</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </View>
          );
        })
      )}
    </Sheet>
  );
}

/* ---------------- Ai đã thích ---------------- */

function LikersSheet({ sheet }: { sheet: Of<"likers"> | null }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const cur = useLast(sheet);
  const ids = useSocial((st) => (cur ? st.likers[cur.postId] : undefined));
  const users = useStore((st) => st.users);
  return (
    <Sheet visible={sheet != null} onClose={closeSheet} title="Người đã thích">
      {!ids ? (
        <ActivityIndicator color={c.accent} />
      ) : ids.length === 0 ? (
        <Text style={s.emptyText}>Chưa có ai thả tim.</Text>
      ) : (
        ids.map((id) => (
          <Pressable key={id} onPress={() => openUser(id)} style={({ pressed }) => [s.person, pressed && { backgroundColor: c.field }]} accessibilityRole="button">
            <Avatar user={users[id]} size={40} />
            <Text style={s.personName}>{users[id]?.displayName || "Người dùng"}</Text>
            <Icon name="favorite" size={20} color="#E5484D" />
          </Pressable>
        ))
      )}
    </Sheet>
  );
}

/* ---------------- Chia sẻ ván cờ ---------------- */

function ShareSheet({ sheet }: { sheet: Of<"share"> | null }) {
  const c = useColors();
  const s = useStyles(makeStyles);
  const cur = useLast(sheet);
  const g = cur?.game;
  const convs = useStore((st) => st.convs);
  const users = useStore((st) => st.users);
  const me = useStore((st) => st.me);
  const nameOf = (id: number | null | undefined) => namesOf({ me, users }).nameOf(id);
  const [sending, setSending] = useState<number | null>(null);

  const list = useMemo(
    () =>
      Object.values(convs).sort(
        (a, b) => (b.lastMessage?.createdAt || b.createdAt || 0) - (a.lastMessage?.createdAt || a.createdAt || 0),
      ),
    [convs],
  );

  if (!g) return <Sheet visible={false} onClose={closeSheet}>{null}</Sheet>;
  const player = me ? myColor(g, me.id) != null : false;

  const send = async (convId: number, title: string) => {
    if (sending != null) return;
    const d = describeGame(g, nameOf);
    setSending(convId);
    const ok = await sendPrepared(convId, chessShareText({ ...d, id: g.id }, API_URL));
    setSending(null);
    // Lỗi thì app đã báo; để bảng mở cho người dùng thử lại
    if (!ok) return;
    closeSheet();
    showToast(`Đã gửi ván cờ vào “${title}”.`);
  };

  return (
    <Sheet visible={sheet != null} onClose={closeSheet} title="Chia sẻ ván cờ">
      <GameCard game={g} />
      {player ? <Button title="Đăng lên trang cá nhân" icon="post-add" onPress={() => openComposer({ game: g })} /> : null}
      <Text style={s.label}>GỬI VÀO CUỘC TRÒ CHUYỆN</Text>
      {list.length === 0 ? <Text style={s.emptyText}>Chưa có cuộc trò chuyện nào.</Text> : null}
      {list.map((conv) => {
        const title = convTitle(conv, nameOf);
        return (
          <Pressable
            key={conv.id}
            onPress={() => send(conv.id, title)}
            style={({ pressed }) => [s.person, pressed && { backgroundColor: c.field }]}
            accessibilityRole="button"
            accessibilityLabel={`Gửi vào ${title}`}
          >
            <ConvAvatar conv={conv} users={users} size={40} meId={me?.id} />
            <Text style={s.personName} numberOfLines={1}>
              {title}
            </Text>
            {sending === conv.id ? <ActivityIndicator color={c.accent} size="small" /> : <Icon name="send" size={20} color={c.accent} />}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    row: { flexDirection: "row", gap: 10 },
    composeInput: { minHeight: 120, maxHeight: 260, borderRadius: 16, padding: 14, fontSize: 16, lineHeight: 22 },
    preview: { width: "100%", maxHeight: 320, borderRadius: 16, backgroundColor: c.field },
    previewX: { position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.5)" },
    divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
    emptyText: { color: c.muted, fontSize: 14, textAlign: "center", paddingVertical: 14 },
    comment: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
    bubble: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
    commentName: { color: c.text, fontSize: 14, fontWeight: "800" },
    commentText: { color: c.text, fontSize: 15, lineHeight: 21 },
    commentMeta: { flexDirection: "row", gap: 14, paddingHorizontal: 12 },
    meta: { color: c.muted, fontSize: 12.5 },
    commentBar: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
    commentInput: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 15.5 },
    sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
    label: { color: c.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: 6 },
    person: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 12 },
    personName: { flex: 1, color: c.text, fontSize: 16, fontWeight: "700" },
  });
