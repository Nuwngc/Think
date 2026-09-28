// File âm thanh đóng gói trong app (tách riêng để kiểm thử thay được)
export const SOURCES = {
  move: require("../../assets/sounds/move.wav"),
  capture: require("../../assets/sounds/capture.wav"),
  castle: require("../../assets/sounds/castle.wav"),
  check: require("../../assets/sounds/check.wav"),
  start: require("../../assets/sounds/start.wav"),
  end: require("../../assets/sounds/end.wav"),
};

export type SoundName = keyof typeof SOURCES;
