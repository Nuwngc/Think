// Kiểu dữ liệu game Nông trại (giống máy chủ: src/farm-data.js, src/farm-logic.js, src/farm.js)

export type Crop = { id: string; name: string; emoji: string; level: number; seed: number; min: number; yield: number; price: number; xp: number };
export type Building = { id: string; name: string; emoji: string; level: number; cost: number; desc: string };
export type ProductKind = "feed" | "animal" | "goods" | "food";
export type Product = {
  id: string;
  name: string;
  emoji: string;
  kind: ProductKind;
  building: string;
  level: number;
  min: number;
  inputs: Record<string, number>;
  price: number;
  xp: number;
};
export type Decor = { id: string; name: string; emoji: string; level: number; cost: number; beauty: number };
export type Customer = { name: string; emoji: string };

export type Rules = {
  startPlots: number;
  startStorage: number;
  startSlots: number;
  maxPlots: number;
  maxStorage: number;
  storageStep: number;
  maxSlots: number;
  maxLevel: number;
  dogLevel: number;
  dogCost: number;
  dogCatch: number;
  dogFine: number;
  helpCoins: number;
  helpsPerDay: number;
  stealsPerDay: number;
  stealsPerFarmPerDay: number;
  dailyGift: number[];
};

export type Catalog = {
  crops: Crop[];
  buildings: Building[];
  products: Product[];
  decor: Decor[];
  customers: Customer[];
  rules: Rules;
  xpTable: number[];
  plotCosts: { n: number; cost: number; level: number }[];
  storageCosts: number[];
  slotCosts: Record<string, number[]>;
};

/** Một món bất kỳ (nông sản hoặc sản phẩm) */
export type Item = {
  id: string;
  name: string;
  emoji: string;
  kind: "crop" | ProductKind;
  level: number;
  price: number;
  xp: number;
  min: number;
};

/** Ô đất: c = cây, p = lúc gieo, r = lúc chín, y = số sản phẩm, b = lúc sâu xuất hiện (0 = không), bd = đã bắt sâu, st = id người hái trộm */
export type Plot = { c: string | null; p: number; r: number; y: number; b: number; bd: boolean; st: number };
export type QueueItem = { id: string; s: number; e: number };
export type OwnBuilding = { slots: number; q: QueueItem[] };
export type Order = { id: number; who: number; items: [string, number][]; coins: number; xp: number; at: number };
export type LogEntry = { t: number; type: "help" | "steal" | "caught"; by: number; c?: string; coins?: number };

/** Nông trại của chính mình */
export type Farm = {
  v: number;
  coins: number;
  xp: number;
  level: number;
  xpCur: number;
  xpNext: number;
  plots: Plot[];
  inv: Record<string, number>;
  storage: number;
  used: number;
  buildings: Record<string, OwnBuilding>;
  orders: Order[];
  dog: boolean;
  decor: string[];
  day: string;
  helps: number;
  steals: number;
  giftDay: string;
  giftStreak: number;
  beauty: number;
  weekCoins: number;
  log: LogEntry[];
  stats: { harvest: number; craft: number; orders: number; sold: number; earned: number; helps: number; steals: number };
  created?: number;
};

/** Ô đất ở vườn người khác */
export type PublicPlot = { c: string | null; p: number; r: number; bug: boolean; st: "me" | "other" | null; canSteal: boolean };
export type PublicFarm = {
  level: number;
  dog: boolean;
  decor: string[];
  plots: PublicPlot[];
  buildings: Record<string, { slots: number; busy: number }>;
};

export type Market = { day: string; hot: string; prices: Record<string, { price: number; trend: number }> };

export type FriendSummary = {
  userId: number;
  level: number;
  xp: number;
  ripe: number;
  stealable: number;
  bugs: number;
  dog: boolean;
  beauty: number;
  plots: number;
};
export type Leaderboard = {
  weekStart: number;
  level: { rank: number; userId: number; xp: number; level: number; beauty: number }[];
  week: { rank: number; userId: number; coins: number }[];
};

export type LevelUp = { level: number; coins: number; unlocks: string[] };

/** Kết quả trả về của một thao tác (các trường tùy thao tác) */
export type ActResult = {
  gained?: Record<string, number>;
  xp?: number;
  full?: boolean;
  skipped?: number;
  planted?: number[];
  harvested?: number[];
  levelUps?: LevelUp[];
  coins?: number;
  caught?: boolean;
  fine?: number;
  item?: string;
  streak?: number;
  made?: number;
  collected?: Record<string, number>;
};

export type FarmAction =
  | "plant"
  | "harvest"
  | "clearBug"
  | "craft"
  | "collect"
  | "build"
  | "addSlot"
  | "buyPlot"
  | "upgradeStorage"
  | "buyDog"
  | "buyDecor"
  | "sell"
  | "deliver"
  | "discard"
  | "gift";

export type FarmTab = "field" | "build" | "orders" | "storage" | "friends";

export type FarmEvent = { type: "help" | "steal" | "caught"; by: number; plot: number; item: string | null };
