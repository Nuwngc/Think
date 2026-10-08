// Công thức toán, hóa trong tin nhắn (2.16.0) — giống hệt public/formula-core.js của bản web
// (tests/formula.test.ts so khớp hai bản). Máy chủ dùng bản web để viết thông báo đẩy.
// Cách viết: mũ x^2  10^-3  e^x  Fe^3+  Na^+  x^{n+1}  2^(n+1); chỉ số dưới H_2O  x_1  C_{n}H_{2n+2}.
// App vẽ mũ / chỉ số bằng chữ số nhỏ Unicode (x², H₂O) khi đổi được (xem FormulaText.tsx).

export type FormulaPart = { t: "text" | "sup" | "sub"; s: string };

// prettier-ignore
const SUP: Record<string, string> = {
  0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", " ": " ", "/": "⁄", ".": "·",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ",
  n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
  A: "ᴬ", B: "ᴮ", D: "ᴰ", E: "ᴱ", G: "ᴳ", H: "ᴴ", I: "ᴵ", J: "ᴶ", K: "ᴷ", L: "ᴸ", M: "ᴹ", N: "ᴺ",
  O: "ᴼ", P: "ᴾ", R: "ᴿ", T: "ᵀ", U: "ᵁ", V: "ⱽ", W: "ᵂ",
  α: "ᵅ", β: "ᵝ", γ: "ᵞ", δ: "ᵟ", θ: "ᶿ", φ: "ᵠ", χ: "ᵡ",
};
// prettier-ignore
const SUB: Record<string, string> = {
  0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", " ": " ",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ",
  s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ", y: "ᵧ",
  β: "ᵦ", γ: "ᵧ", ρ: "ᵨ", φ: "ᵩ", χ: "ᵪ",
};

// Không đổi trong đường link, địa chỉ email (minh_12@gmail.com)
const SKIP_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+|[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/gi;
// Chữ cái (Latinh, tiếng Việt, Hy Lạp) viết hẳn ra, không dùng \p{L} (Hermes chưa chắc hiểu)
const L = "A-Za-zÀ-ɏḀ-ỿͰ-Ͽ";
const LETTER_RE = new RegExp(`[${L}]`);
// Chỉ số dưới sau một từ dài: chỉ khi từ đó là công thức hóa học (NaHCO_3, SO_4: các nguyên tố viết hoa đầu)
// hoặc hàm toán (log_2); tên người dùng, tên file, mật khẩu (minh_12, Nha_88, file_12) giữ nguyên
const CHEM_RE = /^(?:[A-Z][a-z]?)+$/;
const MATH_WORDS = ["log", "lg", "ln", "lim", "max", "min", "sup", "inf", "sum", "prod"];
function subBaseOk(s: string, i: number) {
  let a = i;
  while (a > 0 && LETTER_RE.test(s[a - 1])) a--;
  const run = s.slice(a, i);
  return run.length < 2 || CHEM_RE.test(run) || MATH_WORDS.includes(run.toLowerCase());
}
// Chữ / số / ngoặc / chữ số nhỏ (x₁^2) đứng ngay trước dấu ^ hoặc _ (không có thì không phải công thức: ^_^, -_-)
const BASE_RE = new RegExp(`[${L}0-9)\\]}'′\\u00B2\\u00B3\\u00B9\\u2070-\\u209C\\u1D2C-\\u1D6A]`);
// ^{…}  ^(…)  ^2  ^-1  ^3+  ^+  ^n   |   _{…}  _2  _12
// Dấu +/- sau số mũ chỉ tính khi đứng cuối (Fe^3+), để x^2+1 vẫn là x² + 1
const MARK_RE = new RegExp(
  `\\^(?:\\{([^{}\\n]{1,40})\\}|\\(([^()\\n]{1,40})\\)|([+\\-−]?[0-9]{1,6})(?:([+\\-−])(?![${L}0-9(]))?|([+\\-−])(?![${L}0-9(^])|([a-zα-ω])(?![${L}0-9]))` +
    `|_(?:\\{([^{}\\n]{1,40})\\}|([0-9]{1,2})(?![0-9]))`,
  "g",
);

/** Tách tin nhắn thành các đoạn: chữ thường, chỉ số trên (sup), chỉ số dưới (sub) */
export function parse(text: string | null | undefined): FormulaPart[] {
  const s = String(text == null ? "" : text);
  if (s.indexOf("^") < 0 && s.indexOf("_") < 0) return [{ t: "text", s }];
  const urls: [number, number][] = [];
  SKIP_RE.lastIndex = 0;
  let u: RegExpExecArray | null;
  while ((u = SKIP_RE.exec(s))) urls.push([u.index, u.index + u[0].length]);
  const out: FormulaPart[] = [];
  const push = (t: FormulaPart["t"], v: string) => {
    if (!v) return;
    const prev = out[out.length - 1];
    if (t === "text" && prev && prev.t === "text") prev.s += v;
    else out.push({ t, s: v });
  };
  let last = 0;
  let m: RegExpExecArray | null;
  MARK_RE.lastIndex = 0;
  while ((m = MARK_RE.exec(s))) {
    const i = m.index;
    const inUrl = urls.some(([a, b]) => i >= a && i < b);
    const content =
      m[1] != null ? m[1] : m[2] != null ? m[2] : m[3] != null ? m[3] + (m[4] || "") : m[5] != null ? m[5] : m[6] != null ? m[6] : m[7] != null ? m[7] : m[8];
    if (inUrl || i === 0 || !BASE_RE.test(s[i - 1]) || !/\S/.test(content) || (s[i] === "_" && !subBaseOk(s, i))) {
      MARK_RE.lastIndex = i + 1;
      continue;
    }
    push("text", s.slice(last, i));
    push(s[i] === "^" ? "sup" : "sub", content);
    last = MARK_RE.lastIndex;
  }
  push("text", s.slice(last));
  return out.length ? out : [{ t: "text", s }];
}

const mapAll = (s: string, table: Record<string, string>) => {
  let r = "";
  for (const ch of String(s)) {
    const v = table[ch];
    if (v == null) return null;
    r += v;
  }
  return r;
};
/** Chữ số nhỏ Unicode cho một đoạn mũ / chỉ số dưới; không đổi được hết thì trả null */
export const sup = (s: string) => mapAll(s, SUP);
export const sub = (s: string) => mapAll(s, SUB);

/** Cả tin nhắn ở dạng chữ thường (dòng xem trước, sao chép, trích dẫn): x^2 → x², H_2O → H₂O */
export function toUnicode(text: string | null | undefined): string {
  const parts = parse(text);
  if (parts.length === 1 && parts[0].t === "text") return parts[0].s;
  return parts
    .map((p) => {
      if (p.t === "text") return p.s;
      const v = p.t === "sup" ? sup(p.s) : sub(p.s);
      if (v != null) return v;
      const mark = p.t === "sup" ? "^" : "_";
      return Array.from(p.s).length === 1 ? mark + p.s : `${mark}(${p.s})`;
    })
    .join("");
}

/** Tin nhắn có công thức không */
export const has = (text: string | null | undefined) => parse(text).some((p) => p.t !== "text");

/** Phím: [nhãn, chữ chèn vào (‸ là chỗ đặt con trỏ), tên đọc cho người khiếm thị, nhãn dạng công thức cho web] */
export type PadKey = [string, string?, string?, string?];
export type PadGroup = { id: string; name: string; keys: PadKey[] };

// prettier-ignore
export const PAD: PadGroup[] = [
  {
    id: "math",
    name: "Toán",
    keys: [
      ["xⁿ", "^{‸}", "Số mũ", "x^{n}"], ["xₙ", "_{‸}", "Chỉ số dưới", "x_{n}"], ["x²", "²", "Bình phương", "x^2"], ["x³", "³", "Lập phương", "x^3"], ["x⁻¹", "⁻¹", "Mũ trừ một", "x^{-1}"],
      ["√", "√(‸)", "Căn bậc hai"], ["∛", "∛(‸)", "Căn bậc ba"], ["π"], ["∞", "∞", "Vô cực"], ["±"], ["×"], ["÷"], ["≠"], ["≈"], ["≤"], ["≥"],
      ["°", "°", "Độ"], ["∑"], ["∫"], ["Δ"], ["∈"], ["∉"], ["⊂"], ["∪"], ["∩"], ["∅"], ["⇒"], ["⇔"], ["∀"], ["∃"], ["∠"], ["⊥"], ["∥"],
      ["½"], ["⅓"], ["¼"], ["¾"], ["ℝ"], ["ℕ"], ["ℤ"], ["ℚ"], ["′"], ["‰"], ["|x|", "|‸|", "Giá trị tuyệt đối"],
    ],
  },
  {
    id: "chem",
    name: "Hóa",
    keys: [
      ["xₙ", "_{‸}", "Chỉ số dưới", "x_{n}"], ["xⁿ⁺", "^{‸}", "Điện tích", "x^{n+}"], ["₂"], ["₃"], ["₄"], ["₅"], ["₆"], ["₇"], ["⁺"], ["⁻"], ["²⁺"], ["²⁻"], ["³⁺"], ["³⁻"],
      ["→", "→", "Mũi tên phản ứng"], ["⇌", "⇌", "Phản ứng thuận nghịch"], ["⇄"], ["↑", "↑", "Chất khí"], ["↓", "↓", "Kết tủa"], ["t°", "t°", "Nhiệt độ"],
      ["°C"], ["Δ"], ["·", "·", "Dấu chấm giữa"], ["≡"], ["e⁻", "e⁻", "Electron"], ["⁰"], ["¹"], ["ₓ"], ["ᵧ"],
    ],
  },
  {
    id: "greek",
    name: "Hy Lạp",
    keys: ["α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "λ", "μ", "ν", "ξ", "π", "ρ", "σ", "τ", "φ", "χ", "ψ", "ω", "Γ", "Δ", "Θ", "Λ", "Π", "Σ", "Φ", "Ψ", "Ω"].map(
      (k): PadKey => [k],
    ),
  },
];

const CARET = "‸";
/** Chèn chữ của một phím vào ô nhập (vị trí con trỏ start..end): trả về chữ mới và vị trí con trỏ mới */
export function insert(value: string, start: number | null | undefined, end: number | null | undefined, ins: string) {
  const v = String(value || "");
  const a = Math.max(0, Math.min(start == null ? v.length : start, v.length));
  const b = Math.max(a, Math.min(end == null ? a : end, v.length));
  const cut = ins.indexOf(CARET);
  const raw = cut < 0 ? ins : ins.slice(0, cut) + ins.slice(cut + 1);
  const selected = v.slice(a, b);
  // Đang bôi đen chữ: phím có chỗ con trỏ thì bọc chữ đó lại (bôi đen "n+1" rồi bấm xⁿ → ^{n+1})
  const text = cut >= 0 && selected ? raw.slice(0, cut) + selected + raw.slice(cut) : raw;
  const caret = a + (cut < 0 || selected ? text.length : cut);
  return { value: v.slice(0, a) + text + v.slice(b), caret };
}
