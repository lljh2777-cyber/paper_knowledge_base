import { Composition } from "remotion";
import { AgenticResearchVaultVideo } from "./AgenticResearchVaultVideo";
import { FPS, TOTAL_FRAMES } from "./constants";

export const VideoComposition: React.FC = () => {
  return (
    <Composition
      id="AgenticResearchVault"
      component={AgenticResearchVaultVideo}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ showCaptions: true, showAudioCueMarkers: false }}
    />
  );
};
