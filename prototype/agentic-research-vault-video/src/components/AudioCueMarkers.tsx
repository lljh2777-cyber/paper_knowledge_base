import { useCurrentFrame, useVideoConfig } from "remotion";
import { audioCues } from "../data/audioCues";
import { COLORS, FONT_MONO } from "../constants";

export const AudioCueMarkers: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cue = audioCues.find((item) => Math.abs(frame - item.atSeconds * fps) <= 15);
  if (!cue) return null;
  return (
    <div style={{ position: "absolute", right: 36, top: 32, color: COLORS.amber, fontFamily: FONT_MONO, fontSize: 18, border: `1px solid ${COLORS.amber}`, padding: "8px 12px", zIndex: 100 }}>
      AUDIO CUE · {cue.id}
    </div>
  );
};
