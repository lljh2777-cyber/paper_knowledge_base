import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONT_MONO, SCENE_FRAMES } from "../constants";
import { Icon, type IconName } from "../components/Icon";
import { Panel, Reveal, SceneFrame, SceneHeading } from "../components/Primitives";

const gaps: Array<{ issue: string; route: string; icon: IconName; color: string }> = [
  { issue: "待建方法页", route: "综合分析", icon: "method", color: COLORS.red },
  { issue: "待深读文献", route: "PDF 深读", icon: "scan", color: COLORS.cyan },
  { issue: "缺少代码关联", route: "代码分析", icon: "code", color: COLORS.lime },
  { issue: "缺少证据来源", route: "文献入库", icon: "paper", color: COLORS.amber },
];

export const KnowledgeGapScene: React.FC = () => {
  const frame = useCurrentFrame();
  const active = Math.min(3, Math.max(0, Math.floor((frame - 72) / 48)));
  const repaired = interpolate(frame, [110, 265], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <SceneFrame duration={SCENE_FRAMES.gaps}>
      <Reveal delay={5}>
        <SceneHeading eyebrow="KNOWLEDGE GAP LOOP" title={<>知识缺口，不只是提醒，<br/><span style={{ color: COLORS.red }}>而是可执行任务</span></>} description="处理按钮将缺口类型转换为明确的操作、Skill 与文件写入责任。" />
      </Reveal>

      <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "1.4fr 0.8fr", gap: 26, height: 470 }}>
        <Panel accent={COLORS.red} style={{ padding: "24px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div style={{ fontSize: 30, fontWeight: 800 }}>待处理问题</div>
            <div style={{ fontFamily: FONT_MONO, color: COLORS.red, fontSize: 19 }}>4 OPEN GAPS</div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {gaps.map((gap, index) => {
              const isActive = frame > 72 && index === active;
              const done = frame > 120 + index * 46;
              return (
                <Reveal key={gap.issue} delay={28 + index * 11}>
                  <div style={{ height: 82, padding: "14px 18px", display: "grid", gridTemplateColumns: "48px 1fr 220px 92px", alignItems: "center", gap: 16, border: `1px solid ${isActive ? gap.color : COLORS.line}`, background: done ? `${COLORS.lime}10` : isActive ? `${gap.color}12` : COLORS.panelSoft }}>
                    <Icon name={gap.icon} color={gap.color} size={32}/>
                    <div style={{ fontSize: 27, fontWeight: 700 }}>{gap.issue}</div>
                    <div style={{ fontFamily: FONT_MONO, color: isActive ? gap.color : COLORS.muted, fontSize: 19 }}>ROUTE → {gap.route}</div>
                    <div style={{ justifySelf: "end", padding: "8px 14px", border: `1px solid ${done ? COLORS.lime : gap.color}`, color: done ? COLORS.lime : gap.color, fontSize: 20 }}>{done ? "已修复" : isActive ? "处理中" : "处理"}</div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </Panel>

        <Panel accent={COLORS.cyan} style={{ position: "relative", display: "grid", placeItems: "center" }}>
          <div style={{ position: "absolute", left: 22, top: 20, fontFamily: FONT_MONO, color: COLORS.cyan, fontSize: 18 }}>GRAPH REPAIR</div>
          <svg width="470" height="370" viewBox="0 0 470 370">
            {[[235,185,95,90],[235,185,370,84],[235,185,105,290],[235,185,365,290],[105,90,370,84],[105,290,365,290]].map((line, index) => (
              <line key={index} x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} stroke={index < Math.floor(repaired * 7) ? COLORS.cyan : COLORS.line} strokeWidth="2" strokeDasharray={index < Math.floor(repaired * 7) ? "0" : "8 10"}/>
            ))}
            {[[235,185,COLORS.red],[95,90,COLORS.cyan],[370,84,COLORS.lime],[105,290,COLORS.amber],[365,290,COLORS.cyan]].map(([x,y,color], index) => (
              <g key={index}><circle cx={Number(x)} cy={Number(y)} r={index === 0 ? 34 : 22} fill={COLORS.panel} stroke={String(color)} strokeWidth="2"/><circle cx={Number(x)} cy={Number(y)} r="6" fill={String(color)}/></g>
            ))}
          </svg>
          <div style={{ position: "absolute", bottom: 24, display: "flex", alignItems: "center", gap: 12, color: repaired > 0.85 ? COLORS.lime : COLORS.muted, fontFamily: FONT_MONO, fontSize: 19 }}>
            <Icon name={repaired > 0.85 ? "check" : "link"} color={repaired > 0.85 ? COLORS.lime : COLORS.cyan} size={26}/>
            {repaired > 0.85 ? "RELATIONSHIPS RESTORED" : "REBUILDING LINKS"}
          </div>
        </Panel>
      </div>
    </SceneFrame>
  );
};
