import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { COLORS, FONT_MONO, SCENE_FRAMES } from "../constants";
import { CornerMarks, Reveal, SceneFrame, TechLabel } from "../components/Primitives";

export const ClosingScene: React.FC = () => {
  const frame = useCurrentFrame();
  const corePulse = 1 + Math.sin(frame / 12) * 0.018;
  const fade = interpolate(frame, [225, 269], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <SceneFrame duration={SCENE_FRAMES.closing} style={{ opacity: fade, paddingBottom: 150 }}>
      <Img src={staticFile("assets/vault-core.png")} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.62, scale: corePulse, filter: "brightness(0.62) contrast(1.22)" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(5,7,9,0.96) 0%, rgba(5,7,9,0.84) 47%, rgba(5,7,9,0.18) 82%), linear-gradient(0deg, rgba(5,7,9,0.76), transparent 48%)" }} />
      <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", gap: 28, maxWidth: 1180 }}>
        <Reveal delay={12}><TechLabel>AGENTIC RESEARCH VAULT</TechLabel></Reveal>
        <Reveal delay={28}>
          <div style={{ fontSize: 108, lineHeight: 1.08, fontWeight: 900 }}>让研究知识<br/><span style={{ color: COLORS.cyan }}>在本地持续协作</span></div>
        </Reveal>
        <Reveal delay={56}><div style={{ fontSize: 38, lineHeight: 1.55, color: COLORS.text }}>从资料管理，走向可执行的研究基础设施。</div></Reveal>
        <Reveal delay={86} style={{ display: "flex", gap: 18, marginTop: 14 }}>
          {["LOCAL-FIRST", "EVIDENCE-AWARE", "ACTIONABLE"].map((label, index) => <div key={label} style={{ color: [COLORS.cyan,COLORS.red,COLORS.lime][index], fontFamily: FONT_MONO, fontSize: 21, padding: "12px 16px", border: `1px solid ${[COLORS.cyan,COLORS.red,COLORS.lime][index]}`, background: "rgba(5,7,9,0.66)" }}>{label}</div>)}
        </Reveal>
      </div>
      <div style={{ position: "absolute", right: 105, top: 110, width: 590, height: 590, scale: corePulse }}><CornerMarks color={COLORS.cyan}/></div>
      <div style={{ position: "absolute", left: 104, right: 104, bottom: 150, height: 1, background: COLORS.line }} />
      <div style={{ position: "absolute", right: 104, bottom: 122, fontFamily: FONT_MONO, color: COLORS.muted, fontSize: 18 }}>OBSIDIAN · CODEX · SPECIALIZED SKILLS · PYTHON / R</div>
    </SceneFrame>
  );
};
