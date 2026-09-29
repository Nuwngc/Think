// File âm thanh đóng gói trong app (tách riêng để kiểm thử thay được). Tự tổng hợp bằng scripts/chess-sounds.py
export const SOURCES = {
  move: require("../../assets/sounds/move.wav"),
  "move-opp": require("../../assets/sounds/move-opp.wav"),
  capture: require("../../assets/sounds/capture.wav"),
  castle: require("../../assets/sounds/castle.wav"),
  check: require("../../assets/sounds/check.wav"),
  promote: require("../../assets/sounds/promote.wav"),
  start: require("../../assets/sounds/start.wav"),
  end: require("../../assets/sounds/end.wav"),
  illegal: require("../../assets/sounds/illegal.wav"),
  lowtime: require("../../assets/sounds/lowtime.wav"),
};

export type SoundName = keyof typeof SOURCES;
