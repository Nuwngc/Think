import { Fragment, type ReactNode } from "react";
import { Text } from "react-native";

import { parse, sub, sup } from "./core";

/**
 * Công thức trong một đoạn chữ (đặt bên trong <Text>): x^2 → x², H_2O → H₂O bằng chữ số nhỏ Unicode.
 * Ký tự không có dạng nhỏ (vd π trong e^{iπ}) thì viết cỡ chữ nhỏ hơn, để không vỡ dòng chữ.
 */
export function Fx({ text, size, color }: { text: string; size: number; color: string }) {
  const parts = parse(text);
  if (parts.length === 1 && parts[0].t === "text") return <>{parts[0].s}</>;
  return (
    <>
      {parts.map((p, i) => {
        if (p.t === "text") return <Fragment key={i}>{p.s}</Fragment>;
        const map = p.t === "sup" ? sup : sub;
        const whole = map(p.s);
        if (whole != null) return <Fragment key={i}>{whole}</Fragment>;
        // Đổi từng ký tự: được thì dùng chữ số nhỏ, không thì chữ cỡ nhỏ
        const out: ReactNode[] = [];
        let run = "";
        const flush = () => {
          if (run) out.push(run);
          run = "";
        };
        Array.from(p.s).forEach((ch, k) => {
          const v = map(ch);
          if (v != null) run += v;
          else {
            flush();
            out.push(
              <Text key={k} style={{ fontSize: Math.round(size * 0.72), color }}>
                {ch}
              </Text>,
            );
          }
        });
        flush();
        return <Fragment key={i}>{out}</Fragment>;
      })}
    </>
  );
}
