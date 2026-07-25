import { useCurrentFrame } from "remotion";
import { COLORS, FONT_MONO, SCENE_FRAMES } from "../constants";
import { Icon, type IconName } from "../components/Icon";
import { Panel, Reveal, SceneFrame, SceneHeading } from "../components/Primitives";

const actions: Array<{ label: string; skill: string; icon: IconName; color: string }> = [
  { label: "文献入库", skill: "research-vault-ingest", icon: "paper", color: COLORS.cyan },
  { label: "PDF 深读", skill: "research-vault-xray", icon: "scan", color: COLORS.red },
  { label: "代码分析", skill: "research-vault-code", icon: "code", color: COLORS.lime },
  { label: "知识库检索", skill: "research-vault-retrieval", icon: "search", color: COLORS.cyan },
  { label: "综合分析", skill: "research-vault-synthesis", icon: "synthesis", color: COLORS.red },
  { label: "知识库体检", skill: "deterministic lint", icon: "shield", color: COLORS.lime },
  { label: "OKF 导出", skill: "local export", icon: "export", color: COLORS.amber },
  { label: "代码练习", skill: "Python / R runner", icon: "notebook", color: COLORS.cyan },
];

export const ActionsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const activeIndex = Math.min(actions.length - 1, Math.max(0, Math.floor((frame - 90) / 27)));

  return (
    <SceneFrame duration={SCENE_FRAMES.actions}>
      <Reveal delay={6}>
        <SceneHeading eyebrow="ONE CONTROL CENTER" title={<>一个入口，连接<span style={{ color: COLORS.cyan }}>完整研究工作流</span></>} description="操作不是普通按钮，而是带有执行边界、模型策略与证据约束的任务入口。" />
      </Reveal>
      <div style={{ position: "relative", marginTop: 46, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 18 }}>
        {actions.map((action, index) => {
          const active = frame >= 82 && index === activeIndex;
          return (
            <Reveal key={action.label} delay={42 + index * 7}>
              <Panel accent={active ? action.color : COLORS.line} style={{ height: 150, padding: "24px 24px 22px", background: active ? `${action.color}15` : "rgba(10,15,19,0.92)", scale: active ? 1.025 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                  <div style={{ width: 58, height: 58, display: "grid", placeItems: "center", border: `1px solid ${action.color}`, background: `${action.color}12` }}><Icon name={action.icon} color={action.color} size={34}/></div>
                  <div style={{ fontSize: 32, fontWeight: 800 }}>{action.label}</div>
                </div>
                <div style={{ marginTop: 18, fontFamily: FONT_MONO, color: active ? action.color : COLORS.muted, fontSize: 18, whiteSpace: "nowrap" }}>{active ? "ROUTING → " : ""}{action.skill}</div>
              </Panel>
            </Reveal>
          );
        })}
        <div style={{ position: "absolute", left: (activeIndex % 4) * 432 + 382, top: Math.floor(activeIndex / 4) * 168 + 62, width: 18, height: 18, borderRadius: "50%", background: COLORS.text, boxShadow: `0 0 0 7px ${COLORS.cyan}28, 0 0 22px ${COLORS.cyan}` }} />
      </div>
      <Reveal delay={240} style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
        <div style={{ fontFamily: FONT_MONO, color: COLORS.muted, fontSize: 20, display: "flex", alignItems: "center", gap: 18 }}>
          <span style={{ color: COLORS.red }}>SKILL</span> → <span style={{ color: COLORS.cyan }}>EVIDENCE DEPTH</span> → <span style={{ color: COLORS.lime }}>OWNED FILE WRITES</span>
        </div>
      </Reveal>
    </SceneFrame>
  );
};
