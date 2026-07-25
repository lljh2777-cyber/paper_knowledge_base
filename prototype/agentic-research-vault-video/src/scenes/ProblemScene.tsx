import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS, FONT_MONO, SCENE_FRAMES } from "../constants";
import { Icon, type IconName } from "../components/Icon";
import { Reveal, SceneFrame, SceneHeading } from "../components/Primitives";

const artifacts: Array<{ label: string; detail: string; icon: IconName; x: number; y: number; color: string }> = [
  { label: "PDF PAPER", detail: "full-text.pdf", icon: "paper", x: 70, y: 32, color: COLORS.red },
  { label: "MARKDOWN", detail: "source-note.md", icon: "paper", x: 510, y: 8, color: COLORS.cyan },
  { label: "R SCRIPT", detail: "analysis.R", icon: "code", x: 960, y: 40, color: COLORS.lime },
  { label: "PYTHON", detail: "pipeline.py", icon: "terminal", x: 1320, y: 12, color: COLORS.cyan },
  { label: "DATASET", detail: "matrix.h5ad", icon: "database", x: 230, y: 280, color: COLORS.amber },
  { label: "CITATION", detail: "doi:10.xxxx", icon: "link", x: 720, y: 310, color: COLORS.red },
  { label: "TASK", detail: "待验证假设", icon: "task", x: 1190, y: 286, color: COLORS.lime },
];

export const ProblemScene: React.FC = () => {
  const frame = useCurrentFrame();
  const pull = interpolate(frame, [145, 220], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const coreOpacity = interpolate(frame, [135, 205], [0, 0.92], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <SceneFrame duration={SCENE_FRAMES.problem}>
      <Reveal delay={8}>
        <SceneHeading
          eyebrow="FRAGMENTED RESEARCH"
          title={<>论文、代码与证据，<br/><span style={{ color: COLORS.red }}>为什么总是彼此分离？</span></>}
          description="研究资产散落在不同工具中，缺少共同身份、证据层级与持续关联。"
        />
      </Reveal>

      <div style={{ position: "relative", height: 430, marginTop: 44 }}>
        <svg width="100%" height="100%" viewBox="0 0 1712 430" style={{ position: "absolute", inset: 0, opacity: 0.35 * (1 - pull) }}>
          <path d="M190 100 L540 76 M650 85 L1010 105 M1120 110 L1420 85 M355 332 L775 355 M865 355 L1280 330" fill="none" stroke={COLORS.lineBright} strokeWidth="2" strokeDasharray="10 13" />
          <path d="M270 130 L320 295 M1030 140 L1240 300 M760 120 L790 315" fill="none" stroke={COLORS.line} strokeWidth="2" strokeDasharray="5 16" />
        </svg>

        <Img
          src={staticFile("assets/vault-core.png")}
          style={{ position: "absolute", width: 480, height: 270, objectFit: "cover", objectPosition: "69% 48%", left: 616, top: 85, opacity: coreOpacity, scale: interpolate(pull, [0, 1], [0.82, 1]), filter: "contrast(1.1) brightness(0.82)", border: `1px solid ${COLORS.cyan}` }}
        />

        {artifacts.map((item, index) => {
          const targetX = 750 + (index % 3) * 80;
          const targetY = 175 + (index % 2) * 45;
          return (
            <div key={item.label} style={{ position: "absolute", left: interpolate(pull, [0, 1], [item.x, targetX]), top: interpolate(pull, [0, 1], [item.y, targetY]), opacity: interpolate(pull, [0, 0.72, 1], [1, 0.75, 0]), scale: interpolate(pull, [0, 1], [1, 0.55]), width: 270, height: 100, padding: "18px 20px", display: "flex", gap: 16, alignItems: "center", background: "rgba(10,15,19,0.94)", border: `1px solid ${item.color}` }}>
              <Icon name={item.icon} color={item.color} size={34} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: FONT_MONO, fontSize: 20, color: item.color, fontWeight: 700 }}>{item.label}</div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 18, color: COLORS.muted, marginTop: 8, whiteSpace: "nowrap" }}>{item.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </SceneFrame>
  );
};
