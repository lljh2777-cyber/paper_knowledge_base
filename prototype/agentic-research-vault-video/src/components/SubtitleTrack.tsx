import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { captions } from "../data/captions";
import { COLORS, FONT_SANS } from "../constants";

export const SubtitleTrack: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;
  const caption = captions.find((item) => nowMs >= item.startMs && nowMs <= item.endMs);
  if (!caption) return null;

  const localMs = nowMs - caption.startMs;
  const duration = caption.endMs - caption.startMs;
  const opacity = interpolate(localMs, [0, 220, duration - 220, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div style={{ position: "absolute", left: 230, right: 230, bottom: 92, display: "flex", justifyContent: "center", opacity, zIndex: 50 }}>
      <div style={{ maxWidth: 1400, padding: "14px 28px", background: "rgba(5,7,9,0.84)", borderTop: `1px solid ${COLORS.lineBright}`, color: COLORS.text, fontFamily: FONT_SANS, fontSize: 32, lineHeight: 1.45, textAlign: "center", boxShadow: "0 12px 40px rgba(0,0,0,0.28)" }}>
        {caption.text}
      </div>
    </div>
  );
};
