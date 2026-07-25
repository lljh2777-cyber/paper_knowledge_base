import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONT_MONO, SCENE_FRAMES } from "../constants";
import { Icon } from "../components/Icon";
import { CountUp, Panel, Reveal, SceneFrame, SceneHeading } from "../components/Primitives";

const checks = ["链接完整性", "孤立页面", "元数据缺口", "证据深度", "索引一致性", "代码—方法关系"];

export const QualityScene: React.FC = () => {
  const frame = useCurrentFrame();
  const scanIndex = Math.min(checks.length, Math.max(0, Math.floor((frame - 120) / 22) + 1));
  const execution = interpolate(frame, [155, 265], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <SceneFrame duration={SCENE_FRAMES.quality}>
      <Reveal delay={4}>
        <SceneHeading eyebrow="QUALITY + LOCAL EXECUTION" title={<>AI 负责推理，<br/><span style={{ color: COLORS.lime }}>确定性工具负责检查与执行</span></>} />
      </Reveal>

      <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        {[
          [167, "Markdown 知识资产", COLORS.cyan, ""],
          [993, "Wikilink 连接", COLORS.lime, ""],
          [97, "知识库健康分", COLORS.red, " / 100"],
          [0, "严重错误", COLORS.amber, ""],
        ].map(([value, label, color, suffix], index) => (
          <Reveal key={String(label)} delay={22 + index * 10}>
            <Panel accent={String(color)} style={{ height: 150, padding: "22px 28px" }}>
              <div style={{ fontSize: 54, lineHeight: 1 }}><CountUp value={Number(value)} suffix={String(suffix)} delay={42 + index * 8} color={String(color)}/></div>
              <div style={{ marginTop: 20, fontSize: 24, color: COLORS.muted }}>{label}</div>
            </Panel>
          </Reveal>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 22, marginTop: 22, height: 330 }}>
        <Panel accent={COLORS.lime} style={{ padding: "22px 26px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 27, fontWeight: 800 }}><Icon name="shield" color={COLORS.lime} size={32}/>知识库体检</div>
            <div style={{ color: COLORS.lime, fontFamily: FONT_MONO, fontSize: 17 }}>DETERMINISTIC</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginTop: 20 }}>
            {checks.map((check, index) => {
              const done = index < scanIndex;
              return <div key={check} style={{ height: 62, display: "flex", alignItems: "center", gap: 12, padding: "0 15px", border: `1px solid ${done ? COLORS.lime : COLORS.line}`, color: done ? COLORS.text : COLORS.muted, fontSize: 22, background: done ? `${COLORS.lime}0C` : COLORS.panelSoft }}><Icon name={done ? "check" : "search"} color={done ? COLORS.lime : COLORS.muted} size={23}/>{check}</div>;
            })}
          </div>
        </Panel>

        <Panel accent={COLORS.cyan} style={{ padding: "22px 26px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 27, fontWeight: 800 }}><Icon name="notebook" color={COLORS.cyan} size={32}/>Python / R 代码练习</div>
            <div style={{ color: COLORS.cyan, fontFamily: FONT_MONO, fontSize: 17 }}>STATELESS CELLS</div>
          </div>
          <div style={{ marginTop: 20, border: `1px solid ${COLORS.line}`, background: "#070B0E" }}>
            <div style={{ display: "grid", gridTemplateColumns: "86px 1fr", minHeight: 88, borderBottom: `1px solid ${COLORS.line}` }}>
              <div style={{ padding: "20px 12px", color: COLORS.cyan, fontFamily: FONT_MONO, fontSize: 18 }}>In [1]:</div>
              <div style={{ padding: "18px 20px", fontFamily: FONT_MONO, fontSize: 22 }}><span style={{ color: COLORS.red }}>values</span> <span style={{ color: COLORS.muted }}>&lt;-</span> c(1, 2, 3, 4)<br/><span style={{ color: COLORS.lime }}>mean</span>(values)</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "86px 1fr", minHeight: 74, opacity: execution }}>
              <div style={{ padding: "20px 12px", color: COLORS.amber, fontFamily: FONT_MONO, fontSize: 18 }}>Out[1]:</div>
              <div style={{ padding: "18px 20px", fontFamily: FONT_MONO, fontSize: 23, color: COLORS.text }}>2.5 <span style={{ color: COLORS.lime, marginLeft: 18 }}>✓ 286 ms</span></div>
            </div>
          </div>
        </Panel>
      </div>
    </SceneFrame>
  );
};
