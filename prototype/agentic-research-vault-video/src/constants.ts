export const FPS = 30;

export const COLORS = {
  bg: "#050709",
  panel: "#0A0F13",
  panelSoft: "#0D1419",
  line: "#25343D",
  lineBright: "#41606D",
  text: "#F4F7F8",
  muted: "#98A7AF",
  cyan: "#27D7E8",
  red: "#FF4D5D",
  lime: "#B8F34B",
  amber: "#F4B942",
} as const;

export const SCENE_FRAMES = {
  problem: 8 * FPS,
  reveal: 9 * FPS,
  actions: 12 * FPS,
  evidence: 12 * FPS,
  connections: 12 * FPS,
  gaps: 10 * FPS,
  quality: 10 * FPS,
  export: 8 * FPS,
  closing: 9 * FPS,
} as const;

export const TOTAL_FRAMES = Object.values(SCENE_FRAMES).reduce(
  (sum, duration) => sum + duration,
  0,
);

export const SCENE_STARTS = {
  problem: 0,
  reveal: SCENE_FRAMES.problem,
  actions: SCENE_FRAMES.problem + SCENE_FRAMES.reveal,
  evidence:
    SCENE_FRAMES.problem + SCENE_FRAMES.reveal + SCENE_FRAMES.actions,
  connections:
    SCENE_FRAMES.problem +
    SCENE_FRAMES.reveal +
    SCENE_FRAMES.actions +
    SCENE_FRAMES.evidence,
  gaps:
    SCENE_FRAMES.problem +
    SCENE_FRAMES.reveal +
    SCENE_FRAMES.actions +
    SCENE_FRAMES.evidence +
    SCENE_FRAMES.connections,
  quality:
    SCENE_FRAMES.problem +
    SCENE_FRAMES.reveal +
    SCENE_FRAMES.actions +
    SCENE_FRAMES.evidence +
    SCENE_FRAMES.connections +
    SCENE_FRAMES.gaps,
  export:
    SCENE_FRAMES.problem +
    SCENE_FRAMES.reveal +
    SCENE_FRAMES.actions +
    SCENE_FRAMES.evidence +
    SCENE_FRAMES.connections +
    SCENE_FRAMES.gaps +
    SCENE_FRAMES.quality,
  closing:
    SCENE_FRAMES.problem +
    SCENE_FRAMES.reveal +
    SCENE_FRAMES.actions +
    SCENE_FRAMES.evidence +
    SCENE_FRAMES.connections +
    SCENE_FRAMES.gaps +
    SCENE_FRAMES.quality +
    SCENE_FRAMES.export,
} as const;

export const FONT_SANS =
  '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif';
export const FONT_MONO =
  '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace';
