import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONT_MONO, FONT_SANS } from "../constants";

export const clamp = (value: number) => Math.max(0, Math.min(1, value));

export const SceneFrame: React.FC<{ duration: number; children: ReactNode; style?: CSSProperties }> = ({ duration, children, style }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(frame, [0, 16, duration - 18, duration - 1], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        padding: "92px 104px 170px",
        fontFamily: FONT_SANS,
        color: COLORS.text,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const Reveal: React.FC<{ delay?: number; children: ReactNode; style?: CSSProperties; fromY?: number }> = ({ delay = 0, children, style, fromY = 34 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({ frame: frame - delay, fps, config: { damping: 180, stiffness: 150, mass: 0.8 }, durationInFrames: 38 });
  return (
    <div style={{ opacity: clamp(progress), translate: `0 ${interpolate(progress, [0, 1], [fromY, 0])}px`, ...style }}>
      {children}
    </div>
  );
};

export const TechLabel: React.FC<{ children: ReactNode; color?: string }> = ({ children, color = COLORS.cyan }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14, color, fontFamily: FONT_MONO, fontSize: 24, fontWeight: 700, letterSpacing: 0 }}>
    <span style={{ width: 44, height: 3, background: color }} />
    {children}
  </div>
);

export const SceneHeading: React.FC<{ eyebrow: string; title: ReactNode; description?: string; align?: "left" | "center" }> = ({ eyebrow, title, description, align = "left" }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: align === "center" ? "center" : "flex-start", textAlign: align, maxWidth: align === "center" ? 1500 : 1420 }}>
    <TechLabel>{eyebrow}</TechLabel>
    <div style={{ fontSize: 82, lineHeight: 1.08, fontWeight: 850, letterSpacing: 0 }}>{title}</div>
    {description ? <div style={{ fontSize: 34, lineHeight: 1.55, color: COLORS.muted, maxWidth: 1340 }}>{description}</div> : null}
  </div>
);

export const Panel: React.FC<{ children: ReactNode; accent?: string; style?: CSSProperties }> = ({ children, accent = COLORS.line, style }) => (
  <div style={{ position: "relative", background: "rgba(10,15,19,0.92)", border: `1px solid ${accent}`, borderRadius: 8, overflow: "hidden", ...style }}>
    <div style={{ position: "absolute", left: 0, top: 0, width: 4, height: "100%", background: accent, opacity: 0.9 }} />
    {children}
  </div>
);

export const DataNode: React.FC<{ label: string; color?: string; active?: boolean; style?: CSSProperties }> = ({ label, color = COLORS.cyan, active = false, style }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: 12, minHeight: 48, padding: "8px 16px", border: `1px solid ${active ? color : COLORS.line}`, background: active ? `${color}18` : COLORS.panel, color: active ? COLORS.text : COLORS.muted, fontFamily: FONT_MONO, fontSize: 22, ...style }}>
    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: active ? `0 0 16px ${color}` : "none" }} />
    {label}
  </div>
);

export const CornerMarks: React.FC<{ color?: string }> = ({ color = COLORS.cyan }) => (
  <>
    <span style={{ position: "absolute", left: 16, top: 16, width: 22, height: 22, borderLeft: `2px solid ${color}`, borderTop: `2px solid ${color}` }} />
    <span style={{ position: "absolute", right: 16, top: 16, width: 22, height: 22, borderRight: `2px solid ${color}`, borderTop: `2px solid ${color}` }} />
    <span style={{ position: "absolute", left: 16, bottom: 16, width: 22, height: 22, borderLeft: `2px solid ${color}`, borderBottom: `2px solid ${color}` }} />
    <span style={{ position: "absolute", right: 16, bottom: 16, width: 22, height: 22, borderRight: `2px solid ${color}`, borderBottom: `2px solid ${color}` }} />
  </>
);

export const CountUp: React.FC<{ value: number; suffix?: string; delay?: number; color?: string }> = ({ value, suffix = "", delay = 0, color = COLORS.text }) => {
  const frame = useCurrentFrame();
  const shown = Math.round(interpolate(frame, [delay, delay + 50], [0, value], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }));
  return <span style={{ color, fontFamily: FONT_MONO, fontWeight: 800 }}>{shown}{suffix}</span>;
};
