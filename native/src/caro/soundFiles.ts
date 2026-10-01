// File âm thanh cờ caro đóng gói trong app (tự tổng hợp bằng scripts/caro-sounds.py). Tách riêng để kiểm thử thay được.
export const CARO_SOURCES = {
  "place-x": require("../../assets/sounds/caro/place-x.wav"),
  "place-o": require("../../assets/sounds/caro/place-o.wav"),
  turn: require("../../assets/sounds/caro/turn.wav"),
  threat: require("../../assets/sounds/caro/threat.wav"),
  invalid: require("../../assets/sounds/caro/invalid.wav"),
  start: require("../../assets/sounds/caro/start.wav"),
  win: require("../../assets/sounds/caro/win.wav"),
  lose: require("../../assets/sounds/caro/lose.wav"),
  draw: require("../../assets/sounds/caro/draw.wav"),
};

export type CaroSound = keyof typeof CARO_SOURCES;
