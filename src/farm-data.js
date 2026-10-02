'use strict';
// Dữ liệu game Nông trại: cây trồng, chuồng trại, xưởng chế biến, món ăn, khách đặt hàng.
// Máy chủ gửi nguyên bộ này cho web và app (GET /api/farm), nên muốn thêm cây / món mới chỉ cần sửa ở đây.
// Giá (price) là giá gốc ở chợ, mỗi ngày dao động ±; xp là điểm kinh nghiệm cho mỗi sản phẩm làm ra.
// Thời gian tính bằng phút.

/** Cây trồng: hạt giống mua bằng xu, chín sau `min` phút, thu được `yield` sản phẩm */
const CROPS = [
  { id: 'lua_mi', name: 'Lúa mì', emoji: '🌾', level: 1, seed: 0, min: 3, yield: 2, price: 2, xp: 1 },
  { id: 'rau_cai', name: 'Rau cải', emoji: '🥬', level: 1, seed: 2, min: 5, yield: 2, price: 4, xp: 1 },
  { id: 'bap', name: 'Bắp', emoji: '🌽', level: 2, seed: 4, min: 8, yield: 2, price: 7, xp: 2 },
  { id: 'mia', name: 'Mía', emoji: '🎋', level: 3, seed: 5, min: 12, yield: 2, price: 9, xp: 2 },
  { id: 'ot', name: 'Ớt', emoji: '🌶️', level: 4, seed: 6, min: 20, yield: 3, price: 7, xp: 2 },
  { id: 'ca_rot', name: 'Cà rốt', emoji: '🥕', level: 5, seed: 8, min: 30, yield: 2, price: 14, xp: 3 },
  { id: 'la_che', name: 'Lá chè', emoji: '🍃', level: 6, seed: 7, min: 25, yield: 2, price: 12, xp: 3 },
  { id: 'khoai_mi', name: 'Khoai mì', emoji: '🍠', level: 7, seed: 9, min: 40, yield: 2, price: 16, xp: 3 },
  { id: 'ca_chua', name: 'Cà chua', emoji: '🍅', level: 8, seed: 10, min: 50, yield: 3, price: 12, xp: 3 },
  { id: 'dau_tay', name: 'Dâu tây', emoji: '🍓', level: 9, seed: 12, min: 60, yield: 3, price: 14, xp: 4 },
  { id: 'khoai_tay', name: 'Khoai tây', emoji: '🥔', level: 10, seed: 14, min: 90, yield: 3, price: 17, xp: 4 },
  { id: 'dua_hau', name: 'Dưa hấu', emoji: '🍉', level: 11, seed: 20, min: 120, yield: 1, price: 70, xp: 10 },
  { id: 'bo', name: 'Bơ', emoji: '🥑', level: 12, seed: 24, min: 180, yield: 2, price: 48, xp: 8 },
  { id: 'ca_phe', name: 'Cà phê', emoji: '🫘', level: 13, seed: 28, min: 240, yield: 3, price: 36, xp: 7 },
  { id: 'xoai', name: 'Xoài', emoji: '🥭', level: 14, seed: 35, min: 360, yield: 3, price: 45, xp: 9 },
];

/** Chuồng trại, xưởng, bếp: mỗi nơi làm lần lượt từng món, xếp hàng tối đa `slots` món (nâng cấp thêm chỗ) */
const BUILDINGS = [
  { id: 'may_xay', name: 'Máy xay thức ăn', emoji: '🏭', level: 2, cost: 40, desc: 'Xay lúa, bắp làm thức ăn cho gà, bò' },
  { id: 'chuong_ga', name: 'Chuồng gà', emoji: '🐔', level: 2, cost: 60, desc: 'Cho gà ăn cám, gà đẻ trứng' },
  { id: 'bep', name: 'Bếp nấu', emoji: '🔥', level: 3, cost: 100, desc: 'Nấu mì cay, bánh bao, lẩu thái…' },
  { id: 'xuong', name: 'Xưởng chế biến', emoji: '🫙', level: 4, cost: 150, desc: 'Làm đường, mì sợi, trà khô, trân châu' },
  { id: 'quay_nuoc', name: 'Quầy nước', emoji: '🫖', level: 4, cost: 180, desc: 'Pha nước mía, trà sữa, sinh tố, cà phê' },
  { id: 'lo_nuong', name: 'Lò nướng', emoji: '🍞', level: 5, cost: 240, desc: 'Nướng bánh mì, pizza, bánh kem' },
  { id: 'chuong_bo', name: 'Chuồng bò', emoji: '🐄', level: 6, cost: 300, desc: 'Cho bò ăn cỏ khô, bò cho sữa' },
  { id: 'may_kem', name: 'Máy làm kem', emoji: '🍨', level: 14, cost: 900, desc: 'Làm kem xoài mát lạnh' },
];

/**
 * Sản phẩm chế biến: làm ở `building` từ `inputs` trong `min` phút.
 * kind: 'feed' thức ăn cho vật nuôi, 'animal' sản phẩm chăn nuôi, 'goods' nguyên liệu, 'food' món ăn / thức uống
 */
const PRODUCTS = [
  { id: 'cam_ga', name: 'Cám gà', emoji: '🥣', kind: 'feed', building: 'may_xay', level: 2, min: 5, inputs: { lua_mi: 2, bap: 1 }, price: 13, xp: 1 },
  { id: 'trung', name: 'Trứng gà', emoji: '🥚', kind: 'animal', building: 'chuong_ga', level: 2, min: 15, inputs: { cam_ga: 1 }, price: 20, xp: 2 },
  { id: 'bap_rang', name: 'Bắp rang', emoji: '🍿', kind: 'food', building: 'bep', level: 3, min: 6, inputs: { bap: 3 }, price: 28, xp: 2 },
  { id: 'duong', name: 'Đường', emoji: '🍬', kind: 'goods', building: 'xuong', level: 4, min: 10, inputs: { mia: 3 }, price: 33, xp: 2 },
  { id: 'nuoc_mia', name: 'Nước mía', emoji: '🥤', kind: 'food', building: 'quay_nuoc', level: 4, min: 6, inputs: { mia: 3 }, price: 34, xp: 2 },
  { id: 'mi_soi', name: 'Mì sợi', emoji: '🍝', kind: 'goods', building: 'xuong', level: 5, min: 8, inputs: { lua_mi: 3, trung: 1 }, price: 32, xp: 2 },
  { id: 'mi_cay', name: 'Mì cay', emoji: '🍜', kind: 'food', building: 'bep', level: 5, min: 20, inputs: { mi_soi: 1, ot: 2, rau_cai: 1, trung: 1 }, price: 98, xp: 6 },
  { id: 'banh_mi', name: 'Bánh mì', emoji: '🥖', kind: 'food', building: 'lo_nuong', level: 5, min: 15, inputs: { lua_mi: 3, trung: 1 }, price: 40, xp: 3 },
  { id: 'co_kho', name: 'Cỏ khô', emoji: '🌿', kind: 'feed', building: 'may_xay', level: 6, min: 8, inputs: { bap: 2, rau_cai: 2 }, price: 24, xp: 1 },
  { id: 'sua', name: 'Sữa bò', emoji: '🥛', kind: 'animal', building: 'chuong_bo', level: 6, min: 30, inputs: { co_kho: 1 }, price: 40, xp: 4 },
  { id: 'tra_kho', name: 'Trà khô', emoji: '🍵', kind: 'goods', building: 'xuong', level: 6, min: 10, inputs: { la_che: 3 }, price: 44, xp: 2 },
  { id: 'banh_bao', name: 'Bánh bao', emoji: '🥟', kind: 'food', building: 'bep', level: 6, min: 25, inputs: { lua_mi: 2, trung: 1, ca_rot: 1 }, price: 58, xp: 4 },
  { id: 'tran_chau', name: 'Trân châu', emoji: '⚫', kind: 'goods', building: 'xuong', level: 7, min: 15, inputs: { khoai_mi: 2, duong: 1 }, price: 80, xp: 3 },
  { id: 'tra_sua', name: 'Trà sữa trân châu', emoji: '🧋', kind: 'food', building: 'quay_nuoc', level: 7, min: 20, inputs: { tra_kho: 1, sua: 1, tran_chau: 1, duong: 1 }, price: 270, xp: 12 },
  { id: 'goi_rau', name: 'Gỏi rau', emoji: '🥗', kind: 'food', building: 'bep', level: 8, min: 10, inputs: { rau_cai: 2, ca_rot: 1, ca_chua: 2 }, price: 66, xp: 4 },
  { id: 'mi_cay_7', name: 'Mì cay cấp 7', emoji: '🥵', kind: 'food', building: 'bep', level: 8, min: 25, inputs: { mi_soi: 1, ot: 7, trung: 1 }, price: 160, xp: 9 },
  { id: 'pizza', name: 'Pizza', emoji: '🍕', kind: 'food', building: 'lo_nuong', level: 9, min: 30, inputs: { lua_mi: 3, ca_chua: 2, sua: 1 }, price: 102, xp: 6 },
  { id: 'lau_thai', name: 'Lẩu thái', emoji: '🍲', kind: 'food', building: 'bep', level: 9, min: 40, inputs: { ot: 3, ca_chua: 2, rau_cai: 2, trung: 1 }, price: 108, xp: 7 },
  { id: 'khoai_chien', name: 'Khoai tây chiên', emoji: '🍟', kind: 'food', building: 'bep', level: 10, min: 15, inputs: { khoai_tay: 3 }, price: 74, xp: 4 },
  { id: 'banh_kem', name: 'Bánh kem dâu', emoji: '🍰', kind: 'food', building: 'lo_nuong', level: 10, min: 45, inputs: { lua_mi: 2, trung: 2, sua: 1, dau_tay: 3, duong: 1 }, price: 230, xp: 12 },
  { id: 'nuoc_ep_dua', name: 'Nước ép dưa hấu', emoji: '🧃', kind: 'food', building: 'quay_nuoc', level: 11, min: 10, inputs: { dua_hau: 1, duong: 1 }, price: 140, xp: 6 },
  { id: 'sinh_to_bo', name: 'Sinh tố bơ', emoji: '🍹', kind: 'food', building: 'quay_nuoc', level: 12, min: 15, inputs: { bo: 1, sua: 1, duong: 1 }, price: 165, xp: 8 },
  { id: 'ca_phe_sua', name: 'Cà phê sữa đá', emoji: '☕', kind: 'food', building: 'quay_nuoc', level: 13, min: 20, inputs: { ca_phe: 2, sua: 1, duong: 1 }, price: 200, xp: 9 },
  { id: 'kem_xoai', name: 'Kem xoài', emoji: '🍦', kind: 'food', building: 'may_kem', level: 14, min: 30, inputs: { xoai: 2, sua: 1, duong: 1 }, price: 225, xp: 10 },
];

/** Đồ trang trí sân vườn: mua một lần, bạn bè ghé thăm sẽ thấy; mỗi món cộng điểm "vườn đẹp" */
const DECOR = [
  { id: 'huong_duong', name: 'Luống hướng dương', emoji: '🌻', level: 3, cost: 120, beauty: 2 },
  { id: 'cay_dua', name: 'Cây dừa', emoji: '🌴', level: 5, cost: 300, beauty: 4 },
  { id: 'den_long', name: 'Đèn lồng', emoji: '🏮', level: 6, cost: 500, beauty: 6 },
  { id: 'hoa_dao', name: 'Cây hoa đào', emoji: '🌸', level: 8, cost: 900, beauty: 9 },
  { id: 'ao_ca', name: 'Ao cá', emoji: '🐟', level: 9, cost: 1500, beauty: 12 },
  { id: 'nha_vuon', name: 'Nhà vườn', emoji: '🏡', level: 10, cost: 3000, beauty: 18 },
  { id: 'phun_nuoc', name: 'Đài phun nước', emoji: '⛲', level: 12, cost: 6000, beauty: 25 },
  { id: 'cau_vong', name: 'Cầu vồng', emoji: '🌈', level: 15, cost: 12000, beauty: 35 },
  { id: 'lau_dai', name: 'Lâu đài', emoji: '🏯', level: 20, cost: 30000, beauty: 60 },
];

/** Khách đặt hàng (bảng Đơn hàng) */
const CUSTOMERS = [
  { name: 'Bà Tư', emoji: '👵' },
  { name: 'Ông Sáu', emoji: '👴' },
  { name: 'Chị Hai', emoji: '👩' },
  { name: 'Anh Ba', emoji: '👨' },
  { name: 'Bé Na', emoji: '👧' },
  { name: 'Cu Tí', emoji: '👦' },
  { name: 'Cô Út', emoji: '👩‍🌾' },
  { name: 'Chú Bảy', emoji: '👨‍🍳' },
  { name: 'Thầy Tâm', emoji: '👨‍🏫' },
  { name: 'Mèo Mun', emoji: '🐱' },
];

/** Các con số của game */
const RULES = {
  startCoins: 60,
  startPlots: 6,
  maxPlots: 24,
  startStorage: 100,
  storageStep: 25,
  maxStorage: 600,
  startSlots: 2,
  maxSlots: 6,
  maxLevel: 50,
  dogLevel: 5,
  dogCost: 350,
  dogCatch: 0.35, // chó bắt được người hái trộm
  dogFine: 15, // người bị chó bắt phải đền cho chủ vườn
  bugChance: 0.22, // cây trồng lâu có thể bị sâu
  bugMinMinutes: 8,
  bumperChance: 0.1, // "được mùa": thêm 1 sản phẩm
  helpCoins: 3,
  helpXp: 1,
  helpsPerDay: 15,
  stealsPerDay: 6,
  stealsPerFarmPerDay: 3,
  orderRefillMs: 30 * 1000,
  orderDiscardMs: 3 * 60 * 1000,
  dailyGift: [15, 20, 25, 30, 40, 50, 80],
  levelUpCoins: { base: 20, perLevel: 10 },
};

module.exports = { CROPS, BUILDINGS, PRODUCTS, DECOR, CUSTOMERS, RULES };
