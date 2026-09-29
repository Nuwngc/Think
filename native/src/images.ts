import AsyncStorage from "@react-native-async-storage/async-storage";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

export type PreparedImage = { uri: string; width: number; height: number; mime: string };

const MAX_SIDE = 1600;

/** Mở thư viện ảnh (hoặc máy ảnh). Trả về danh sách ảnh đã chọn, rỗng nếu người dùng hủy. */
export async function pickImages({ camera = false, multiple = true } = {}): Promise<ImagePicker.ImagePickerAsset[]> {
  if (camera) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Chưa cho phép Think dùng máy ảnh. Bật trong Cài đặt của điện thoại.");
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9 });
    return res.canceled ? [] : res.assets;
  }
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: multiple,
    selectionLimit: multiple ? 10 : 1,
    quality: 1,
    orderedSelection: true,
  });
  return res.canceled ? [] : res.assets;
}

/* Máy yếu hay bị Android tắt app trong lúc đang chụp / chọn ảnh. Nhớ đang gửi cho cuộc trò chuyện nào
   để mở lại app thì hỏi gửi tiếp. */
const PICK_KEY = "think.pendingPick";

export const rememberPick = (convId: number) => AsyncStorage.setItem(PICK_KEY, String(convId)).catch(() => undefined);
export const forgetPick = () => AsyncStorage.removeItem(PICK_KEY).catch(() => undefined);

export async function recoverPick(): Promise<{ convId: number; assets: ImagePicker.ImagePickerAsset[] } | null> {
  if (Platform.OS !== "android") return null;
  const convId = Number(await AsyncStorage.getItem(PICK_KEY).catch(() => null));
  if (!convId) return null;
  await forgetPick();
  try {
    const res = await ImagePicker.getPendingResultAsync();
    if (!res || !("assets" in res) || res.canceled || !res.assets?.length) return null;
    return { convId, assets: res.assets };
  } catch {
    return null;
  }
}

/** Chọn một ảnh vuông làm ảnh đại diện */
export async function pickAvatar(): Promise<PreparedImage | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const side = Math.min(a.width || 512, a.height || 512);
  const actions = side > 512 ? [{ resize: a.width <= a.height ? { width: 512 } : { height: 512 } }] : [];
  const out = await manipulateAsync(a.uri, actions, { compress: 0.85, format: SaveFormat.JPEG });
  return { uri: out.uri, width: out.width, height: out.height, mime: "image/jpeg" };
}

/** Chọn ảnh bìa trang cá nhân: cắt theo khung 16:6, cạnh dài tối đa 1500px */
export async function pickCover(): Promise<PreparedImage | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [16, 6], quality: 1 });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const actions = (a.width || 0) > 1500 ? [{ resize: { width: 1500 } }] : [];
  const out = await manipulateAsync(a.uri, actions, { compress: 0.85, format: SaveFormat.JPEG });
  return { uri: out.uri, width: out.width, height: out.height, mime: "image/jpeg" };
}

/** Thu nhỏ ảnh trên máy trước khi gửi (cạnh dài tối đa 1600px, JPEG) để gửi nhanh và nhẹ. Giữ nguyên ảnh động GIF. */
export async function prepareImage(asset: ImagePicker.ImagePickerAsset): Promise<PreparedImage> {
  const mime = asset.mimeType || "";
  if (/gif/i.test(mime) && (asset.fileSize || 0) <= 8 * 1024 * 1024 && asset.width && asset.height) {
    return { uri: asset.uri, width: asset.width, height: asset.height, mime: "image/gif" };
  }
  const w = asset.width || 0;
  const h = asset.height || 0;
  const actions = Math.max(w, h) > MAX_SIDE ? [{ resize: w >= h ? { width: MAX_SIDE } : { height: MAX_SIDE } }] : [];
  const out = await manipulateAsync(asset.uri, actions, { compress: 0.85, format: SaveFormat.JPEG });
  return { uri: out.uri, width: out.width, height: out.height, mime: "image/jpeg" };
}
