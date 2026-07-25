import { COLORS } from "../constants";

export type IconName =
  | "paper" | "scan" | "code" | "search" | "synthesis" | "shield"
  | "export" | "notebook" | "database" | "method" | "concept" | "task"
  | "link" | "check" | "warning" | "terminal" | "package";

const paths: Record<IconName, React.ReactNode> = {
  paper: <><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 12h8M8 16h6"/></>,
  scan: <><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M7 12h10"/></>,
  code: <><path d="m9 7-5 5 5 5M15 7l5 5-5 5M13 5l-2 14"/></>,
  search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 5 5"/></>,
  synthesis: <><circle cx="5" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 12h5l5-6M12 12l5 6"/></>,
  shield: <><path d="M12 3 4 6v5c0 5 3.3 8.2 8 10 4.7-1.8 8-5 8-10V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
  export: <><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 14v7h14v-7"/></>,
  notebook: <><path d="M5 3h14v18H5zM9 3v18M3 7h4M3 12h4M3 17h4"/><path d="m12 10 2 2-2 2M15 14h2"/></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
  method: <><path d="M6 3h12M8 3v6l-4 9c-.5 1.2.2 3 2 3h12c1.8 0 2.5-1.8 2-3l-4-9V3"/><path d="M7 15h10"/></>,
  concept: <><path d="M9 18h6M10 22h4"/><path d="M8.5 14.5A7 7 0 1 1 15.5 14.5C14.5 15.3 14 16 14 18h-4c0-2-.5-2.7-1.5-3.5Z"/></>,
  task: <><path d="M9 5h11M9 12h11M9 19h11"/><path d="m3 5 1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2"/></>,
  link: <><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></>,
  check: <path d="m4 12 5 5L20 6"/>,
  warning: <><path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17.5h.01"/></>,
  terminal: <><path d="M4 5h16v14H4z"/><path d="m7 9 3 3-3 3M12 15h5"/></>,
  package: <><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 8 9 5 9-5v9l-9 5-9-5z"/></>,
};

export const Icon: React.FC<{ name: IconName; size?: number; color?: string; strokeWidth?: number }> = ({
  name,
  size = 32,
  color = COLORS.cyan,
  strokeWidth = 1.7,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
    {paths[name]}
  </svg>
);
