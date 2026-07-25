import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONT_MONO, SCENE_FRAMES } from "../constants";
import { Icon } from "../components/Icon";
import { DataNode, Panel, Reveal, SceneFrame, SceneHeading } from "../components/Primitives";

const paperNodes = ["研究问题", "核心结论", "图表证据", "数据集", "局限"];
const codeNodes = ["入口脚本", "关键函数", "依赖", "输入 / 输出", "代码依据"];

export const ConnectionsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const flow = interpolate(frame, [85, 265], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <SceneFrame duration={SCENE_FRAMES.connections}>
      <Reveal delay={5}>
        <SceneHeading eyebrow="CONNECTED KNOWLEDGE" title={<>让论文证据与<span style={{ color: COLORS.lime }}>代码实现形成关联</span></>} description="source note 与 code-script 不停留在孤立说明，而是共同指向规范的方法、概念和综合节点。" />
      </Reveal>

      <div style={{ position: "relative", marginTop: 38, height: 480, display: "grid", gridTemplateColumns: "1fr 390px 1fr", gap: 30 }}>
        <svg viewBox="0 0 1712 480" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          {[95, 175, 255, 335, 415].map((y, index) => <path key={`l-${y}`} d={`M545 ${y} C680 ${y}, 690 ${160 + index * 34}, 855 ${240}`} fill="none" stroke={COLORS.red} strokeWidth="2" strokeDasharray={`${Math.max(1, flow * 450)} 500`} opacity="0.7"/>)}
          {[95, 175, 255, 335, 415].map((y, index) => <path key={`r-${y}`} d={`M1167 ${y} C1030 ${y}, 1010 ${160 + index * 34}, 857 ${240}`} fill="none" stroke={COLORS.lime} strokeWidth="2" strokeDasharray={`${Math.max(1, flow * 450)} 500`} opacity="0.7"/>)}
        </svg>

        <Reveal delay={38}>
          <Panel accent={COLORS.red} style={{ height: 480, padding: "26px 30px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}><Icon name="paper" color={COLORS.red} size={38}/><div><div style={{ fontSize: 32, fontWeight: 800 }}>论文证据</div><div style={{ fontFamily: FONT_MONO, color: COLORS.red, fontSize: 18, marginTop: 4 }}>SOURCE NOTE / X-RAY</div></div></div>
            <div style={{ display: "grid", gap: 14, marginTop: 28 }}>{paperNodes.map((item, index) => <DataNode key={item} label={item} color={COLORS.red} active={flow > index * 0.15}/>)}</div>
          </Panel>
        </Reveal>

        <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
          <div style={{ width: 300, height: 300, border: `1px solid ${COLORS.cyan}`, background: "rgba(5,7,9,0.92)", rotate: "45deg", scale: interpolate(flow, [0, 1], [0.6, 1]), boxShadow: `0 0 ${50 * flow}px ${COLORS.cyan}44` }} />
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 18 }}>
            <Icon name="synthesis" color={COLORS.cyan} size={56}/>
            <div style={{ fontSize: 32, fontWeight: 800 }}>规范知识枢纽</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
              {["method", "concept", "synthesis"].map((item, index) => <DataNode key={item} label={item} color={[COLORS.cyan, COLORS.amber, COLORS.red][index]} active={flow > 0.72}/>) }
            </div>
          </div>
        </div>

        <Reveal delay={58}>
          <Panel accent={COLORS.lime} style={{ height: 480, padding: "26px 30px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}><Icon name="code" color={COLORS.lime} size={38}/><div><div style={{ fontSize: 32, fontWeight: 800 }}>代码实现</div><div style={{ fontFamily: FONT_MONO, color: COLORS.lime, fontSize: 18, marginTop: 4 }}>CODE PROJECT / SCRIPT</div></div></div>
            <div style={{ display: "grid", gap: 14, marginTop: 28 }}>{codeNodes.map((item, index) => <DataNode key={item} label={item} color={COLORS.lime} active={flow > index * 0.15}/>)}</div>
          </Panel>
        </Reveal>
      </div>
    </SceneFrame>
  );
};
