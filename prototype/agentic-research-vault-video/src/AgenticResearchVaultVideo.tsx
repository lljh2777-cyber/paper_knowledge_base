import { AbsoluteFill, Series } from "remotion";
import { AmbientBackground } from "./components/AmbientBackground";
import { AudioCueMarkers } from "./components/AudioCueMarkers";
import { SubtitleTrack } from "./components/SubtitleTrack";
import { SCENE_FRAMES } from "./constants";
import { ActionsScene } from "./scenes/ActionsScene";
import { ClosingScene } from "./scenes/ClosingScene";
import { ConnectionsScene } from "./scenes/ConnectionsScene";
import { EvidenceScene } from "./scenes/EvidenceScene";
import { ExportScene } from "./scenes/ExportScene";
import { KnowledgeGapScene } from "./scenes/KnowledgeGapScene";
import { ProblemScene } from "./scenes/ProblemScene";
import { ProductRevealScene } from "./scenes/ProductRevealScene";
import { QualityScene } from "./scenes/QualityScene";

export type AgenticResearchVaultVideoProps = {
  showCaptions: boolean;
  showAudioCueMarkers: boolean;
};

export const AgenticResearchVaultVideo: React.FC<AgenticResearchVaultVideoProps> = ({ showCaptions, showAudioCueMarkers }) => (
  <AbsoluteFill>
    <AmbientBackground />
    <Series>
      <Series.Sequence durationInFrames={SCENE_FRAMES.problem} premountFor={30}><ProblemScene /></Series.Sequence>
      <Series.Sequence durationInFrames={SCENE_FRAMES.reveal} premountFor={30}><ProductRevealScene /></Series.Sequence>
      <Series.Sequence durationInFrames={SCENE_FRAMES.actions} premountFor={30}><ActionsScene /></Series.Sequence>
      <Series.Sequence durationInFrames={SCENE_FRAMES.evidence} premountFor={30}><EvidenceScene /></Series.Sequence>
      <Series.Sequence durationInFrames={SCENE_FRAMES.connections} premountFor={30}><ConnectionsScene /></Series.Sequence>
      <Series.Sequence durationInFrames={SCENE_FRAMES.gaps} premountFor={30}><KnowledgeGapScene /></Series.Sequence>
      <Series.Sequence durationInFrames={SCENE_FRAMES.quality} premountFor={30}><QualityScene /></Series.Sequence>
      <Series.Sequence durationInFrames={SCENE_FRAMES.export} premountFor={30}><ExportScene /></Series.Sequence>
      <Series.Sequence durationInFrames={SCENE_FRAMES.closing} premountFor={30}><ClosingScene /></Series.Sequence>
    </Series>
    {showCaptions ? <SubtitleTrack /> : null}
    {showAudioCueMarkers ? <AudioCueMarkers /> : null}
  </AbsoluteFill>
);
