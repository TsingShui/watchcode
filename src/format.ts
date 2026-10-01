import type { SafeNotification } from "./types.js";

const labels = {
  needs_input: "需要你介入",
  completed: "任务已完成",
  failed: "任务失败",
} as const;

export function reasonLabel(notification: SafeNotification): string {
  return labels[notification.reason];
}

export function formatNotificationTitle(
  notification: SafeNotification,
): string {
  const icon =
    notification.reason === "completed"
      ? "✅"
      : notification.reason === "failed"
        ? "🔴"
        : "🟠";
  return `${icon} [${notification.agent}] ${notification.project} · ${notification.title}`;
}

export function formatNotificationBody(notification: SafeNotification): string {
  const lines = [
    `状态：${reasonLabel(notification)}`,
    `项目：${notification.project}`,
    `Agent：${notification.agent}`,
  ];
  lines.push(`耗时：${formatDuration(notification.durationSeconds)}`);
  if (notification.summary) lines.push(`摘要：${notification.summary}`);
  return lines.join("\n");
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}
