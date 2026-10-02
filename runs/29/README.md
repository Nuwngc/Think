# Kiểm tra APK — lần chạy #29

Nhánh: `claude/cap-nhat-lon`, commit `684b456`, 2026-10-02 17:17 UTC

### ❌ Android 10 (API 29)

| Bước | Kết quả | Ghi chú | Ảnh |
|---|---|---|---|
| Mở app | ✅ |  | 01-m-app.png |
| Xếp Khối khi chưa đăng nhập | ✅ | điểm 0 → 2 | 02-x-p-kh-i-khi-ch-a-ng-nh-p.png |
| Quay lại màn đăng nhập | ✅ |  | 03-quay-l-i-m-n-ng-nh-p.png |
| Đăng nhập | ✅ |  | 04--ng-nh-p.png |
| Nhắn tin | ✅ |  | 05-nh-n-tin.png |
| Tin nhắn thoại (giữ nút micro) | ❌ | Giữ nút micro rồi thả nhưng máy chủ không nhận được tin thoại | 06-tin-nh-n-tho-i-gi-n-t-micro-.png |
| Rời cuộc trò chuyện | ✅ |  | 07-r-i-cu-c-tr-chuy-n.png |
| Mục Trò chơi | ✅ |  | 08-m-c-tr-ch-i.png |
| Nông trại: thu hoạch, gieo hạt (có âm thanh) | ✅ | thu hoạch, gieo hạt, mở đủ các mục | 09-n-ng-tr-i-thu-ho-ch-gieo-h-t-c-m-thanh-.png |
| Nông trại: ghé vườn bạn rồi quay lại | ✅ |  | 10-n-ng-tr-i-gh-v-n-b-n-r-i-quay-l-i.png |
| Chuỗi hằng ngày | ❌ | Không mở được bảng chuỗi hằng ngày | 11-chu-i-h-ng-ng-y.png |
| Quiz hôm nay: cờ vua (giải trên màn hình) | ❌ | Không thấy '^Quiz hôm nay Cờ vua' trên màn hình (đã vuốt tìm) | 12-quiz-h-m-nay-c-vua-gi-i-tr-n-m-n-h-nh-.png |
| Thử thách nhanh: cờ vua màn 1 | ❌ | Không thấy '^Thử thách nhanh Cờ vua' trên màn hình (đã vuốt tìm) | 13-th-th-ch-nhanh-c-vua-m-n-1.png |
| Quiz hôm nay: cờ caro, Xếp Khối | ❌ | Không thấy '^Quiz hôm nay Cờ caro' trên màn hình (đã vuốt tìm) | 14-quiz-h-m-nay-c-caro-x-p-kh-i.png |
| Cờ vua với máy (có âm thanh) | ❌ | Không thấy '^Cờ vua\.' trên màn hình (đã vuốt tìm) | 15-c-vua-v-i-m-y-c-m-thanh-.png |
| Rời ván cờ | ❌ | Không về được mục Trò chơi | 16-r-i-v-n-c-.png |
| Xếp Khối (có âm thanh) | ❌ | Không thấy '^Xếp Khối\.' trên màn hình (đã vuốt tìm) | 17-x-p-kh-i-c-m-thanh-.png |
| Thoát Xếp Khối | ❌ | Không thoát được Xếp Khối | 18-tho-t-x-p-kh-i.png |
| Chuỗi hằng ngày của các game | ❌ | Chuỗi hôm nay chưa đủ Nông trại, Cờ vua, Xếp Khối (có: ['blocks', 'farm']) | 19-chu-i-h-ng-ng-y-c-a-c-c-game.png |
| Chạy nền rồi mở lại | ✅ |  | 20-ch-y-n-n-r-i-m-l-i.png |
| Trang cá nhân | ✅ |  | 21-trang-c-nh-n.png |
| Cuộn bảng tin | ✅ |  | 22-cu-n-b-ng-tin.png |
| Tắt và bật màn hình | ✅ |  | 23-t-t-v-b-t-m-n-h-nh.png |
| Bong bóng chat: bật | ✅ | dịch vụ bong bóng chat đang chạy | 24-bong-b-ng-chat-b-t.png |
| Bong bóng chat: có tin mới khi app chạy nền | ✅ | bong bóng ở (887, 599, 1074, 786) | 25-bong-b-ng-chat-c-tin-m-i-khi-app-ch-y-n-.png |
| Bong bóng chat: chạm để mở khung chat | ✅ |  | 26-bong-b-ng-chat-ch-m-m-khung-chat.png |
| Bong bóng chat: trả lời trong khung chat | ✅ | máy chủ đã nhận tin trả lời từ khung chat nổi | 27-bong-b-ng-chat-tr-l-i-trong-khung-chat.png |
| Bong bóng chat: thu nhỏ | ✅ | đã thu nhỏ, bong bóng vẫn còn | 28-bong-b-ng-chat-thu-nh-.png |
| Bong bóng chat: kéo vào ✕ để ẩn | ✅ | đã ẩn bong bóng | 29-bong-b-ng-chat-k-o-v-o-n.png |
| Bong bóng chat: mở lại app | ✅ |  | 30-bong-b-ng-chat-m-l-i-app.png |
| Báo lỗi: màn hình bị lỗi | ✅ | máy chủ đã nhận: Google Android SDK built for x86_64 (x86_64) / Android 10 (API 29) | 32-b-o-l-i-m-n-h-nh-b-l-i.png |
| Báo lỗi: app crash | ✅ | máy chủ đã nhận crash: java.lang.IllegalStateException: Think: crash thử để kiểm tra báo lỗi (0.0.29 (1)) | 33-b-o-l-i-app-crash.png |

Không thấy lỗi crash nào trong logcat.

### ❌ Android 14 (API 34)

| Bước | Kết quả | Ghi chú | Ảnh |
|---|---|---|---|
| Mở app | ✅ |  | 01-m-app.png |
| Xếp Khối khi chưa đăng nhập | ✅ | điểm 0 → 4 | 02-x-p-kh-i-khi-ch-a-ng-nh-p.png |
| Quay lại màn đăng nhập | ✅ |  | 03-quay-l-i-m-n-ng-nh-p.png |
| Đăng nhập | ✅ |  | 04--ng-nh-p.png |
| Nhắn tin | ✅ |  | 05-nh-n-tin.png |
| Tin nhắn thoại (giữ nút micro) | ❌ | Giữ nút micro rồi thả nhưng máy chủ không nhận được tin thoại | 06-tin-nh-n-tho-i-gi-n-t-micro-.png |
| Rời cuộc trò chuyện | ✅ |  | 07-r-i-cu-c-tr-chuy-n.png |
| Mục Trò chơi | ✅ |  | 08-m-c-tr-ch-i.png |
| Nông trại: thu hoạch, gieo hạt (có âm thanh) | ✅ | thu hoạch, gieo hạt, mở đủ các mục | 09-n-ng-tr-i-thu-ho-ch-gieo-h-t-c-m-thanh-.png |
| Nông trại: ghé vườn bạn rồi quay lại | ✅ |  | 10-n-ng-tr-i-gh-v-n-b-n-r-i-quay-l-i.png |
| Chuỗi hằng ngày | ❌ | Không mở được bảng chuỗi hằng ngày | 11-chu-i-h-ng-ng-y.png |
| Quiz hôm nay: cờ vua (giải trên màn hình) | ❌ | Không thấy '^Quiz hôm nay Cờ vua' trên màn hình (đã vuốt tìm) | 12-quiz-h-m-nay-c-vua-gi-i-tr-n-m-n-h-nh-.png |
| Thử thách nhanh: cờ vua màn 1 | ❌ | Không thấy '^Thử thách nhanh Cờ vua' trên màn hình (đã vuốt tìm) | 13-th-th-ch-nhanh-c-vua-m-n-1.png |
| Quiz hôm nay: cờ caro, Xếp Khối | ❌ | Không thấy '^Quiz hôm nay Cờ caro' trên màn hình (đã vuốt tìm) | 14-quiz-h-m-nay-c-caro-x-p-kh-i.png |
| Cờ vua với máy (có âm thanh) | ❌ | Không thấy '^Cờ vua\.' trên màn hình (đã vuốt tìm) | 15-c-vua-v-i-m-y-c-m-thanh-.png |
| Rời ván cờ | ❌ | Không về được mục Trò chơi | 16-r-i-v-n-c-.png |
| Xếp Khối (có âm thanh) | ❌ | Không thấy '^Xếp Khối\.' trên màn hình (đã vuốt tìm) | 17-x-p-kh-i-c-m-thanh-.png |
| Thoát Xếp Khối | ❌ | Không thoát được Xếp Khối | 18-tho-t-x-p-kh-i.png |
| Chuỗi hằng ngày của các game | ❌ | Chuỗi hôm nay chưa đủ Nông trại, Cờ vua, Xếp Khối (có: ['blocks', 'farm']) | 19-chu-i-h-ng-ng-y-c-a-c-c-game.png |
| Chạy nền rồi mở lại | ✅ |  | 20-ch-y-n-n-r-i-m-l-i.png |
| Trang cá nhân | ✅ |  | 21-trang-c-nh-n.png |
| Cuộn bảng tin | ✅ |  | 22-cu-n-b-ng-tin.png |
| Tắt và bật màn hình | ✅ |  | 23-t-t-v-b-t-m-n-h-nh.png |
| Bong bóng chat: bật | ✅ | dịch vụ bong bóng chat đang chạy | 24-bong-b-ng-chat-b-t.png |
| Bong bóng chat: có tin mới khi app chạy nền | ✅ | bong bóng ở (887, 597, 1074, 784) | 25-bong-b-ng-chat-c-tin-m-i-khi-app-ch-y-n-.png |
| Bong bóng chat: chạm để mở khung chat | ✅ |  | 26-bong-b-ng-chat-ch-m-m-khung-chat.png |
| Bong bóng chat: trả lời trong khung chat | ✅ | máy chủ đã nhận tin trả lời từ khung chat nổi | 27-bong-b-ng-chat-tr-l-i-trong-khung-chat.png |
| Bong bóng chat: thu nhỏ | ✅ | đã thu nhỏ, bong bóng vẫn còn | 28-bong-b-ng-chat-thu-nh-.png |
| Bong bóng chat: kéo vào ✕ để ẩn | ✅ | đã ẩn bong bóng | 29-bong-b-ng-chat-k-o-v-o-n.png |
| Bong bóng chat: mở lại app | ✅ |  | 30-bong-b-ng-chat-m-l-i-app.png |
| Báo lỗi: màn hình bị lỗi | ✅ | máy chủ đã nhận: Google sdk_gphone64_x86_64 (x86_64) / Android 14 (API 34) | 32-b-o-l-i-m-n-h-nh-b-l-i.png |
| Báo lỗi: app crash | ✅ | máy chủ đã nhận crash: java.lang.IllegalStateException: Think: crash thử để kiểm tra báo lỗi (0.0.29 (1)) | 33-b-o-l-i-app-crash.png |

**Lỗi tìm thấy trong logcat: 0 lỗi nặng (crash / treo), 1 lỗi nhẹ.**

<details><summary>Lỗi React Native / Expo: 10-02 17:13:27.449  4027  4027 E unknown:ReactNative: Tried to remove non-existent frame callback</summary>

```
10-02 17:13:27.449  4027  4027 E unknown:ReactNative: Tried to remove non-existent frame callback
```
</details>


