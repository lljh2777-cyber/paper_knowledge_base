import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS, FONT_MONO, SCENE_FRAMES } from "../constants";
import { CornerMarks, Reveal, SceneFrame, TechLabel } from "../components/Primitives";

export const ProductRevealScene: React.FC = () => {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [12, 75], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const push = interpolate(frame, [0, SCENE_FRAMES.reveal], [1.03, 1.1], { extrapolateRight: "clamp" });

  return (
    <SceneFrame duration={SCENE_FRAMES.reveal} style={{ paddingBottom: 150 }}>
      <Img src={staticFile("assets/vault-core.png")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", opacity: 0.58, scale: push, filter: "brightness(0.68) contrast(1.18)" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(5,7,9,0.98) 0%, rgba(5,7,9,0.88) 42%, rgba(5,7,9,0.18) 79%, rgba(5,7,9,0.42) 100%)" }} />
      <div style={{ position: "relative", width: 1110, height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 28 }}>
        <Reveal delay={8}><TechLabel>AGENTIC RESEARCH VAULT</TechLabel></Reveal>
        <div style={{ overflow: "hidden" }}>
          <div style={{ fontSize: 118, lineHeight: 1.03, fontWeight: 900, clipPath: `inset(0 ${100 - reveal}% 0 0)`, letterSpacing: 0 }}>
            智能体研究<br/><span style={{ color: COLORS.cyan }}>操作中心</span>
          </div>
        </div>
        <Reveal delay={55}>
          <div style={{ fontSize: 34, lineHeight: 1.65, color: COLORS.text, maxWidth: 1000 }}>
            以 Obsidian 为知识界面，以 Codex 为执行引擎，<br/>以 Skill 约束任务边界。
          </div>
        </Reveal>
        <Reveal delay={90} style={{ display: "flex", gap: 16, marginTop: 14 }}>
          {["LOCAL-FIRST", "EVIDENCE-AWARE", "ACTIONABLE"].map((item, index) => (
            <div key={item} style={{ padding: "12px 18px", border: `1px solid ${[COLORS.cyan, COLORS.red, COLORS.lime][index]}`, color: [COLORS.cyan, COLORS.red, COLORS.lime][index], fontFamily: FONT_MONO, fontSize: 20, background: "rgba(5,7,9,0.72)" }}>{item}</div>
          ))}
        </Reveal>
      </div>
      <div style={{ position: "absolute", right: 104, top: 92, width: 600, height: 600 }}>
        <CornerMarks color={COLORS.cyan}/>
        <div style={{ position: "absolute", right: 28, top: 28, fontFamily: FONT_MONO, color: COLORS.cyan, fontSize: 18 }}>VAULT CORE // ONLINE</div>
      </div>
    </SceneFrame>
  );
};
