// File âm thanh game Xếp Khối đóng gói trong app (tự tổng hợp bằng scripts/blocks-sounds.py). Tách riêng để kiểm thử thay được.
export const BLOCK_SOURCES = {
  pick: require("../../assets/sounds/blocks/pick.wav"),
  place: require("../../assets/sounds/blocks/place.wav"),
  invalid: require("../../assets/sounds/blocks/invalid.wav"),
  clear1: require("../../assets/sounds/blocks/clear1.wav"),
  clear2: require("../../assets/sounds/blocks/clear2.wav"),
  clear3: require("../../assets/sounds/blocks/clear3.wav"),
  combo1: require("../../assets/sounds/blocks/combo1.wav"),
  combo2: require("../../assets/sounds/blocks/combo2.wav"),
  combo3: require("../../assets/sounds/blocks/combo3.wav"),
  combo4: require("../../assets/sounds/blocks/combo4.wav"),
  combo5: require("../../assets/sounds/blocks/combo5.wav"),
  combo6: require("../../assets/sounds/blocks/combo6.wav"),
  combo7: require("../../assets/sounds/blocks/combo7.wav"),
  combo8: require("../../assets/sounds/blocks/combo8.wav"),
  allclear: require("../../assets/sounds/blocks/allclear.wav"),
  best: require("../../assets/sounds/blocks/best.wav"),
  gameover: require("../../assets/sounds/blocks/gameover.wav"),
  start: require("../../assets/sounds/blocks/start.wav"),
};

export type BlockSound = keyof typeof BLOCK_SOURCES;
