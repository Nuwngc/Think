import { fileUrl } from "../api";
import { currentToken } from "../session";

/** Ảnh của tin (ở /uploads/img, cần đăng nhập mới xem được): gửi kèm mã phiên, giống ảnh trong tin nhắn */
export function storyImage(path: string) {
  const token = currentToken();
  return { uri: fileUrl(path), headers: token ? { Authorization: `Bearer ${token}` } : undefined, cacheKey: path };
}
