import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import { createContext, memo, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { KeyboardAvoidingView, KeyboardEvents } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fileUrl } from "./api";
import { colorOf, initialOf } from "./format";
import { radius, useColors, type Colors } from "./theme";
import type { Conversation, User } from "./types";

/* ---------------- Biểu tượng ---------------- */

export type IconName = ComponentProps<typeof MaterialIcons>["name"];

export function Icon({ name, size = 22, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const c = useColors();
  return <MaterialIcons name={name} size={size} color={color || c.text2} style={style} />;
}

/* ---------------- Ảnh đại diện ---------------- */

export const Avatar = memo(function Avatar({
  user,
  size = 48,
  dot = true,
  meId,
}: {
  user: Pick<User, "id" | "displayName" | "avatar" | "online"> | null | undefined;
  size?: number;
  dot?: boolean;
  meId?: number;
}) {
  const c = useColors();
  const [failed, setFailed] = useState(false);
  const src = user?.avatar && !failed ? fileUrl(user.avatar) : null;
  useEffect(() => setFailed(false), [user?.avatar]);
  const showDot = dot && user?.online && user.id !== meId;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.avatar,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: src ? c.field : colorOf(user?.id) },
        ]}
      >
        {src ? (
          <Image
            source={{ uri: src }}
            style={{ width: size, height: size }}
            contentFit="cover"
            cachePolicy="disk"
            transition={120}
            onError={() => setFailed(true)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>{initialOf(user?.displayName)}</Text>
        )}
      </View>
      {showDot ? (
        <View
          style={[
            styles.dot,
            {
              width: Math.max(12, size * 0.27),
              height: Math.max(12, size * 0.27),
              borderRadius: size,
              backgroundColor: c.online,
              borderColor: c.surface,
            },
          ]}
        />
      ) : null}
    </View>
  );
});

/** Ảnh của cuộc trò chuyện: người (chat riêng), biểu tượng (phòng chung), chữ cái bo góc (nhóm riêng) */
export function ConvAvatar({
  conv,
  users,
  size = 48,
  dot = true,
  meId,
}: {
  conv: Pick<Conversation, "id" | "type" | "name" | "peerId"> & { avatar?: string | null };
  users: Record<number, User>;
  size?: number;
  dot?: boolean;
  meId?: number;
}) {
  const c = useColors();
  if (conv.type === "dm") return <Avatar user={conv.peerId != null ? users[conv.peerId] : null} size={size} dot={dot} meId={meId} />;
  if (conv.type === "group") return <GroupAvatar conv={conv} size={size} />;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: c.jade }]}>
      <Icon name="forum" size={size * 0.52} color="#fff" />
    </View>
  );
}

/** Ảnh nhóm: ảnh đã đặt (2.9.0), không có hoặc lỗi tải thì chữ cái đầu trong ô bo góc */
function GroupAvatar({ conv, size }: { conv: Pick<Conversation, "id" | "name"> & { avatar?: string | null }; size: number }) {
  const c = useColors();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [conv.avatar]);
  const src = conv.avatar && !failed ? fileUrl(conv.avatar) : null;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: src ? c.field : colorOf(conv.id + 3) }]}>
      {src ? (
        <Image
          source={{ uri: src }}
          style={{ width: size, height: size }}
          contentFit="cover"
          cachePolicy="disk"
          transition={120}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>{initialOf(conv.name)}</Text>
      )}
    </View>
  );
}

/* ---------------- Nút ---------------- */

export function Button({
  title,
  onPress,
  kind = "primary",
  icon,
  busy,
  disabled,
  style,
  small,
}: {
  title: string;
  onPress?: () => void;
  kind?: "primary" | "secondary" | "danger" | "ghost";
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const c = useColors();
  const bg = kind === "primary" ? c.jade : kind === "danger" ? c.dangerWash : kind === "secondary" ? c.field : "transparent";
  const fg = kind === "primary" ? c.onJade : kind === "danger" ? c.danger : c.accent;
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: off ? 0.55 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon name={icon} size={small ? 18 : 20} color={fg} /> : null}
      <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({
  name,
  onPress,
  color,
  size = 24,
  label,
  style,
  disabled,
}: {
  name: IconName;
  onPress?: () => void;
  color?: string;
  size?: number;
  label: string;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.4 : pressed ? 0.55 : 1 }, style]}
    >
      <Icon name={name} size={size} color={color} />
    </Pressable>
  );
}

/* ---------------- Ô nhập ---------------- */

export function Field({
  label,
  error,
  style,
  ref,
  ...props
}: TextInputProps & { label?: string; error?: string | null; ref?: Ref<TextInput> }) {
  const c = useColors();
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={[styles.fieldLabel, { color: c.text2 }]}>{label}</Text> : null}
      <TextInput
        ref={ref}
        placeholderTextColor={c.muted}
        style={[styles.field, { backgroundColor: c.field, color: c.text, borderColor: error ? c.danger : "transparent" }, style]}
        {...props}
      />
    </View>
  );
}

export function FormError({ text }: { text?: string | null }) {
  const c = useColors();
  if (!text) return null;
  return (
    <View style={[styles.formError, { backgroundColor: c.dangerWash }]} accessibilityLiveRegion="polite">
      <Icon name="error-outline" size={18} color={c.danger} />
      <Text style={[styles.formErrorText, { color: c.danger }]}>{text}</Text>
    </View>
  );
}

/* ---------------- Bàn phím ---------------- */

const KeyboardOpen = createContext(false);

/** Bàn phím đang mở (trong vùng KeyboardAware): lúc này không cần chừa chỗ cho thanh điều hướng nữa */
export const useKeyboardOpen = () => useContext(KeyboardOpen);

/** Theo dõi bàn phím đang mở hay đóng (báo trước lúc bàn phím bắt đầu trượt lên / xuống) */
export function useKeyboardVisible() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const a = KeyboardEvents.addListener("keyboardWillShow", () => setOpen(true));
    const b = KeyboardEvents.addListener("keyboardWillHide", () => setOpen(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return open;
}

/**
 * Chừa chỗ cho bàn phím, dùng react-native-keyboard-controller: đo bàn phím bằng WindowInsets của
 * Android nên đúng ở mọi đời máy (kể cả máy tràn viền, có tai thỏ), không phụ thuộc toạ độ màn hình.
 */
export function KeyboardAware({ children, style, bottomInset = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; bottomInset?: boolean }) {
  const insets = useSafeAreaInsets();
  const open = useKeyboardVisible();
  return (
    <KeyboardOpen.Provider value={open}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={[{ flex: 1, paddingBottom: !open && bottomInset ? insets.bottom : 0 }, style]}>{children}</View>
      </KeyboardAvoidingView>
    </KeyboardOpen.Provider>
  );
}

/* ---------------- Bảng trượt từ dưới lên ---------------- */

export function Sheet({
  visible,
  onClose,
  title,
  children,
  scroll = true,
  footer,
  scrollRef,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  /** Để tự cuộn nội dung (vd tới bình luận mới nhất) */
  scrollRef?: Ref<ScrollView>;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  // Android: bảng nằm trong cửa sổ riêng, không tràn ra sau thanh hệ thống, nên máy tự thu nhỏ khi mở bàn phím
  // (adjustResize) ở mọi đời Android. iOS phải tự chừa chỗ cho bàn phím.
  const android = Platform.OS === "android";
  const content = (
    <>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={onClose} accessibilityLabel="Đóng" />
      <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: android ? 12 : Math.max(insets.bottom, 12) }]}>
        <View style={[styles.grabber, { backgroundColor: c.line }]} />
        {title ? (
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: c.text }]} numberOfLines={1}>
              {title}
            </Text>
            <IconButton name="close" label="Đóng" onPress={onClose} />
          </View>
        ) : null}
        {scroll ? (
          <ScrollView ref={scrollRef} style={styles.sheetScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody} bounces={false}>
            {children}
          </ScrollView>
        ) : (
          <View style={styles.sheetBody}>{children}</View>
        )}
        {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
      </View>
    </>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent={!android}>
      {android ? (
        <View style={[styles.sheetRoot, { flex: 1 }]}>{content}</View>
      ) : (
        <KeyboardAware bottomInset={false} style={styles.sheetRoot}>
          {content}
        </KeyboardAware>
      )}
    </Modal>
  );
}

/** Một dòng lựa chọn trong bảng (menu) */
export function SheetItem({
  icon,
  label,
  onPress,
  danger,
  hint,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  hint?: string;
}) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.sheetItem, pressed && { backgroundColor: c.field }]} accessibilityRole="button">
      <Icon name={icon} size={22} color={danger ? c.danger : c.accent} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.sheetItemText, { color: danger ? c.danger : c.text }]}>{label}</Text>
        {hint ? <Text style={[styles.hint, { color: c.muted }]}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

/* ---------------- Khác ---------------- */

export function Badge({ count, style }: { count: number; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  if (!count) return null;
  return (
    <View style={[styles.badge, { backgroundColor: c.turmeric }, style]}>
      <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const c = useColors();
  return <Text style={[styles.sectionLabel, { color: c.muted }]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }, style]}>{children}</View>;
}

export function Loading({ text }: { text?: string }) {
  const c = useColors();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={c.accent} />
      {text ? <Text style={[styles.hint, { color: c.muted, textAlign: "center" }]}>{text}</Text> : null}
    </View>
  );
}

export function useStyles<T>(make: (c: Colors) => T): T {
  const c = useColors();
  const cache = useRef<{ c: Colors; s: T } | null>(null);
  if (!cache.current || cache.current.c !== c) cache.current = { c, s: make(c) };
  return cache.current.s;
}

const styles = StyleSheet.create({
  avatar: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarText: { color: "#fff", fontWeight: "700" },
  dot: { position: "absolute", right: -1, bottom: -1, borderWidth: 2.5 },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  buttonSmall: { minHeight: 38, paddingHorizontal: 12, borderRadius: radius.sm },
  buttonText: { fontSize: 15, fontWeight: "700" },
  buttonTextSmall: { fontSize: 14 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  fieldWrap: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "600" },
  field: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, borderWidth: 1.5 },
  formError: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 12, borderRadius: radius.sm },
  formErrorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  sheetRoot: { justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "90%" },
  sheetScroll: { flexGrow: 0, flexShrink: 1, flexBasis: "auto" },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginTop: 8 },
  sheetHeader: { flexDirection: "row", alignItems: "center", paddingLeft: 20, paddingRight: 8, paddingTop: 6 },
  sheetTitle: { flex: 1, fontSize: 18, fontWeight: "800" },
  sheetBody: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8, gap: 12 },
  sheetFooter: { paddingHorizontal: 20, paddingTop: 8 },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 13, paddingHorizontal: 8, borderRadius: radius.sm },
  sheetItemText: { fontSize: 16, fontWeight: "600" },
  hint: { fontSize: 13, lineHeight: 18 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "#14201C", fontSize: 12, fontWeight: "800" },
  sectionLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.6, marginTop: 18, marginBottom: 8, marginHorizontal: 4 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
});

/** Hỏi xác nhận (bản web dùng hộp thoại của trình duyệt) */
export function confirm(title: string, message: string, okText: string, destructive = true): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Hủy", style: "cancel", onPress: () => resolve(false) },
        { text: okText, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
