import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import * as F from "../src/formula/core";

const require = createRequire(import.meta.url);
const web = require("../../public/formula-core.js");

// Công thức toán, hóa (2.16.0): bản app và bản web (máy chủ cũng dùng bản web cho thông báo) phải giống hệt nhau
const SAMPLES = [
  "x^2 + y^2 = r^2",
  "x^2+1",
  "10^-3 và 2^10",
  "e^x, e^{i*pi}, 2^(n+1), x^{n-1}",
  "H_2O, CO_2, H_2SO_4, Ca(OH)_2",
  "2H_2 + O_2 → 2H_2O",
  "Fe^3+ + 3e → Fe; SO_4^2- và SO_4^{2-}",
  "Na^+ + Cl^- → NaCl",
  "C_{n}H_{2n+2}, x_{10}, log_2 x",
  "x₁^2, a²^{n+1}",
  "x^{1/2}, 10^{1.5}, e^{iπ}, x^T, x_n, x^, x^{ }",
  "^_^ T_T O_o -_- u_u n^^ :^) ^-^",
  "IMG_2024.jpg snake_case __init__",
  "minh_12@gmail.com, wifi: Nha_88, file_12.png, www.site.vn/a_1, pass: abc_12, NHA_88",
  "NaHCO_3, KMnO_4, K_2Cr_2O_7, C_6H_{12}O_6, log_2 x, lim_{x→0}, m^2, cm^3",
  "https://a.vn/x_1^2 và x_1",
  "",
  "Không có công thức",
];

describe("công thức toán, hóa", () => {
  it("bản app và bản web cho cùng kết quả", () => {
    for (const t of SAMPLES) {
      expect(F.parse(t)).toEqual(web.parse(t));
      expect(F.toUnicode(t)).toBe(web.toUnicode(t));
      expect(F.has(t)).toBe(web.has(t));
    }
    for (const x of ["n+1", "2-", "q", "αβ", "1/2"]) {
      expect(F.sup(x)).toBe(web.sup(x));
      expect(F.sub(x)).toBe(web.sub(x));
    }
    expect(F.PAD).toEqual(web.PAD);
  });

  it("đổi sang chữ số nhỏ", () => {
    expect(F.toUnicode("x^2 + y^2 = r^2")).toBe("x² + y² = r²");
    expect(F.toUnicode("2H_2 + O_2 → 2H_2O")).toBe("2H₂ + O₂ → 2H₂O");
    expect(F.toUnicode("Fe^3+ và SO_4^2-")).toBe("Fe³⁺ và SO₄²⁻");
    expect(F.toUnicode("C_{n}H_{2n+2}")).toBe("CₙH₂ₙ₊₂");
    expect(F.toUnicode("x^{1/2}")).toBe("x¹⁄²");
    expect(F.toUnicode("e^{iπ}")).toBe("e^(iπ)");
    expect(F.toUnicode("T_T ^_^")).toBe("T_T ^_^");
  });

  it("chèn phím tại con trỏ", () => {
    const cases: [string, number | null, number | null, string][] = [
      ["x", 1, 1, "²"],
      ["x + 1", 1, 1, "^{‸}"],
      ["2 n+1", 2, 5, "^{‸}"],
      ["", null, null, "√(‸)"],
      ["abc", 9, 9, "π"],
    ];
    for (const [v, a, b, ins] of cases) expect(F.insert(v, a, b, ins)).toEqual(web.insert(v, a, b, ins));
    expect(F.insert("x + 1", 1, 1, "^{‸}")).toEqual({ value: "x^{} + 1", caret: 3 });
    expect(F.insert("2 n+1", 2, 5, "^{‸}")).toEqual({ value: "2 ^{n+1}", caret: 8 });
  });
});
