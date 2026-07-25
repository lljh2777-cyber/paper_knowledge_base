export type AudioCue = {
  atSeconds: number;
  id: string;
  description: string;
};

export const audioCues: AudioCue[] = [
  { atSeconds: 0, id: "ambient-in", description: "低频环境声渐入" },
  { atSeconds: 7.6, id: "vault-pull", description: "碎片汇聚的短促上升音" },
  { atSeconds: 17, id: "matrix-on", description: "命令矩阵启动脉冲" },
  { atSeconds: 29, id: "scan", description: "证据流水线扫描音" },
  { atSeconds: 53, id: "route-click", description: "知识缺口处理点击音" },
  { atSeconds: 63, id: "quality-pass", description: "检查通过提示音" },
  { atSeconds: 73, id: "package", description: "结构化导出组装音" },
  { atSeconds: 89, id: "ambient-out", description: "核心脉冲后渐隐" },
];
