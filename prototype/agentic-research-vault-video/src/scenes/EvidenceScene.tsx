import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONT_MONO, SCENE_FRAMES } from "../constants";
import { Icon } from "../components/Icon";
import { DataNode, Panel, Reveal, SceneFrame, SceneHeading } from "../components/Primitives";

const stages = [
  { id: "01", title: "Metadata-only", cn: "身份与元数据", color: COLORS.amber, items: ["DOI / citekey", "去重", "来源路径"] },
  { id: "02", title: "Abstract-level", cn: "保守摘要结论", color: COLORS.cyan, items: ["摘要", "研究问题", "初步结果"] },
  { id: "03", title: "X-ray", cn: "全文证据检查", color: COLORS.red, items: ["图表", "方法", "局限与证据链"] },
];

export const EvidenceScene: React.FC = () => {
  const frame = useCurrentFrame();
  const paperX = interpolate(frame, [55, 270], [90, 1530], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const stageIndex = frame < 125 ? 0 : frame < 205 ? 1 : 2;

  return (
    <SceneFrame duration={SCENE_FRAMES.evidence}>
      <Reveal delay={5}>
        <SceneHeading eyebrow="EVIDENCE-AWARE PIPELINE" title={<>结论强度，<span style={{ color: COLORS.red }}>由证据深度决定</span></>} description="身份核验、文本转换、来源笔记、图表检查与跨文献综合，按阶段逐层交接。" />
      </Reveal>

      <div style={{ position: "relative", marginTop: 46 }}>
        <div style={{ position: "absolute", left: 80, right: 80, top: 40, height: 2, background: COLORS.lineBright }} />
        <div style={{ position: "absolute", left: 80, top: 33, width: paperX, height: 16, background: `linear-gradient(90deg, ${COLORS.cyan}00, ${COLORS.cyan})`, opacity: 0.72 }} />
        <div style={{ position: "absolute", left: paperX, top: 10, width: 62, height: 62, display: "grid", placeItems: "center", border: `1px solid ${stages[stageIndex].color}`, background: COLORS.bg, boxShadow: `0 0 24px ${stages[stageIndex].color}55`, zIndex: 4 }}>
          <Icon name="paper" color={stages[stageIndex].color} size={38}/>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, paddingTop: 82 }}>
          {stages.map((stage, index) => {
            const active = index <= stageIndex;
            return (
              <Reveal key={stage.title} delay={30 + index * 26}>
                <Panel accent={active ? stage.color : COLORS.line} style={{ height: 230, padding: "30px 32px", background: active ? `${stage.color}12` : "rgba(10,15,19,0.92)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <div style={{ fontFamily: FONT_MONO, color: stage.color, fontSize: 21 }}>{stage.id} / DEPTH</div>
                    <div style={{ fontSize: 24, color: COLORS.muted }}>{stage.cn}</div>
                  </div>
                  <div style={{ marginTop: 24, fontFamily: FONT_MONO, fontSize: 36, fontWeight: 800, color: active ? COLORS.text : COLORS.muted }}>{stage.title}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 24 }}>
                    {stage.items.map((item) => <DataNode key={item} label={item} color={stage.color} active={active}/>) }
                  </div>
                </Panel>
              </Reveal>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 34, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
        {[
          ["元数据不生成论文结论", COLORS.amber],
          ["摘要级不冒充全文深读", COLORS.cyan],
          ["完整证据检查后才能标记 X-ray", COLORS.red],
        ].map(([label, color], index) => (
          <Reveal key={label} delay={190 + index * 18}>
            <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 27, lineHeight: 1.4, color: COLORS.text }}>
              <span style={{ width: 12, height: 12, background: color, boxShadow: `0 0 18px ${color}` }} />{label}
            </div>
          </Reveal>
        ))}
      </div>
    </SceneFrame>
  );
};
