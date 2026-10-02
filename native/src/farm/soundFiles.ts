// File âm thanh Nông trại đóng gói trong app (tự tổng hợp bằng scripts/farm-sounds.py). Tách riêng để kiểm thử thay được.
export const FARM_SOURCES = {
  plant: require("../../assets/sounds/farm/plant.wav"),
  harvest: require("../../assets/sounds/farm/harvest.wav"),
  coin: require("../../assets/sounds/farm/coin.wav"),
  order: require("../../assets/sounds/farm/order.wav"),
  craft: require("../../assets/sounds/farm/craft.wav"),
  collect: require("../../assets/sounds/farm/collect.wav"),
  levelup: require("../../assets/sounds/farm/levelup.wav"),
  bug: require("../../assets/sounds/farm/bug.wav"),
  steal: require("../../assets/sounds/farm/steal.wav"),
  dog: require("../../assets/sounds/farm/dog.wav"),
  build: require("../../assets/sounds/farm/build.wav"),
  gift: require("../../assets/sounds/farm/gift.wav"),
  error: require("../../assets/sounds/farm/error.wav"),
};

export type FarmSound = keyof typeof FARM_SOURCES;
