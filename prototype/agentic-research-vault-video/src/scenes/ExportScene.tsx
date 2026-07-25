import { interpolate, useCurrentFrame } from "remotion";
import { COLORS, FONT_MONO, SCENE_FRAMES } from "../constants";
import { Icon } from "../components/Icon";
import { DataNode, Reveal, SceneFrame, SceneHeading } from "../components/Primitives";

const exportLabels = [
  ["Machine-readable", COLORS.cyan],
  ["Portable", COLORS.lime],
  ["Evidence-aware", COLORS.red],
  ["Provenance intact", COLORS.amber],
] as const;

export const ExportScene: React.FC = () => {
  const frame = useCurrentFrame();
  const assemble = interpolate(frame, [42, 150], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const outbound = interpolate(frame, [145, 225], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <SceneFrame duration={SCENE_FRAMES.export}>
      <Reveal delay={5}>
        <SceneHeading eyebrow="OPEN KNOWLEDGE FORMAT" title={<>知识不仅可阅读，<br/><span style={{ color: COLORS.cyan }}>也可迁移、验证与复用</span></>} />
      </Reveal>

      <div style={{ position: "relative", height: 530, marginTop: 28, display: "grid", placeItems: "center" }}>
        <svg viewBox="0 0 1712 530" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          {[[856,255,180,100],[856,255,1530,105],[856,255,205,430],[856,255,1500,425]].map((line, index) => (
            <path key={index} d={`M${line[0]} ${line[1]} C${index % 2 === 0 ? 600 : 1110} ${line[1]}, ${index % 2 === 0 ? 480 : 1250} ${line[3]}, ${line[2]} ${line[3]}`} fill="none" stroke={exportLabels[index][1]} strokeWidth="2" strokeDasharray={`${Math.max(1, outbound * 900)} 950`} opacity="0.7"/>
          ))}
        </svg>

        <div style={{ position: "relative", width: 440, height: 360, display: "grid", placeItems: "center" }}>
          {[0,1,2].map((layer) => <div key={layer} style={{ position: "absolute", width: 300, height: 230, border: `1px solid ${[COLORS.lineBright, COLORS.cyan, COLORS.red][layer]}`, background: layer === 2 ? "rgba(10,15,19,0.96)" : "rgba(13,20,25,0.65)", translate: `${interpolate(assemble, [0,1], [(layer-1)*130, (layer-1)*18])}px ${interpolate(assemble, [0,1], [(layer-1)*-90, (layer-1)*-18])}px`, rotate: `${interpolate(assemble, [0,1], [(layer-1)*8, 0])}deg`, opacity: 0.55 + layer * 0.2 }} />)}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
            <Icon name="package" color={COLORS.cyan} size={68}/>
            <div style={{ fontFamily: FONT_MONO, fontSize: 40, fontWeight: 900 }}>OKF EXPORT</div>
            <div style={{ color: COLORS.muted, fontFamily: FONT_MONO, fontSize: 18 }}>STRUCTURED KNOWLEDGE PACKAGE</div>
          </div>
        </div>

        {exportLabels.map(([label, color], index) => {
          const positions = [{left: 40, top: 56},{right: 36, top: 62},{left: 72, bottom: 52},{right: 66, bottom: 56}];
          return <Reveal key={label} delay={82 + index * 16} style={{ position: "absolute", ...positions[index] }}><DataNode label={label} color={color} active={outbound > index * 0.14}/></Reveal>;
        })}
      </div>
    </SceneFrame>
  );
};
