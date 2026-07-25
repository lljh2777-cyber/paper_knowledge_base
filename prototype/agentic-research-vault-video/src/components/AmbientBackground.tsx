import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "../constants";

const particles = [
  [110, 180, COLORS.cyan], [330, 720, COLORS.red], [520, 270, COLORS.lime],
  [740, 850, COLORS.cyan], [940, 130, COLORS.amber], [1170, 520, COLORS.cyan],
  [1390, 250, COLORS.red], [1580, 760, COLORS.lime], [1790, 410, COLORS.cyan],
] as const;

export const AmbientBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const scanY = interpolate(frame % 360, [0, 359], [-120, 1200]);
  const drift = frame * 0.12;

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          opacity: 0.52,
          backgroundImage:
            "linear-gradient(rgba(39,215,232,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(39,215,232,0.055) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          backgroundPosition: `${drift % 64}px ${(drift * 0.6) % 64}px`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.18,
          backgroundImage:
            "linear-gradient(115deg, transparent 0%, rgba(39,215,232,0.12) 48%, transparent 56%)",
          translate: `${(frame * 0.35) % 2100 - 400}px 0`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: scanY,
          height: 2,
          background: COLORS.cyan,
          opacity: 0.16,
          boxShadow: `0 0 24px ${COLORS.cyan}`,
        }}
      />
      {particles.map(([x, y, color], index) => {
        const pulse = 0.3 + (Math.sin(frame / 20 + index * 1.7) + 1) * 0.22;
        return (
          <div
            key={`${x}-${y}`}
            style={{
              position: "absolute",
              left: x + Math.sin(frame / 90 + index) * 12,
              top: y + Math.cos(frame / 110 + index) * 10,
              width: 5,
              height: 5,
              borderRadius: "50%",
              backgroundColor: color,
              opacity: pulse,
              boxShadow: `0 0 16px ${color}`,
            }}
          />
        );
      })}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(5,7,9,0.22), transparent 20%, transparent 80%, rgba(5,7,9,0.32)), linear-gradient(0deg, rgba(5,7,9,0.28), transparent 24%, transparent 78%, rgba(5,7,9,0.36))",
        }}
      />
    </AbsoluteFill>
  );
};
