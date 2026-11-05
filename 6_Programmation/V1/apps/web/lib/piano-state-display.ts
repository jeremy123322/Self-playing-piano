import type { PianoState } from "@spp/contracts";
import type { MessageKey } from "@/lib/i18n/messages";

/** Single source of truth for how each `PianoState` is labelled, explained, and colored across the app. */
export const STATE_LABEL_KEY: Record<PianoState, MessageKey> = {
  booting: "status.booting",
  provisioning: "status.provisioning",
  connecting: "status.connecting",
  idle: "status.idle",
  preparing: "status.preparing",
  ready: "status.ready",
  playing: "status.playing",
  paused: "status.paused",
  stopping: "status.stopping",
  error: "status.error",
  offline: "status.offline",
};

export const STATE_TOOLTIP_KEY: Record<PianoState, MessageKey> = {
  booting: "status.tooltip.booting",
  provisioning: "status.tooltip.provisioning",
  connecting: "status.tooltip.connecting",
  idle: "status.tooltip.idle",
  preparing: "status.tooltip.preparing",
  ready: "status.tooltip.ready",
  playing: "status.tooltip.playing",
  paused: "status.tooltip.paused",
  stopping: "status.tooltip.stopping",
  error: "status.tooltip.error",
  offline: "status.tooltip.offline",
};

export const STATE_DOT_CLASS: Record<PianoState, string> = {
  booting: "bg-info animate-pulse",
  provisioning: "bg-info animate-pulse",
  connecting: "bg-info animate-pulse",
  playing: "bg-warning animate-pulse",
  preparing: "bg-warning animate-pulse",
  ready: "bg-warning",
  idle: "bg-success",
  paused: "bg-info",
  stopping: "bg-info",
  error: "bg-destructive",
  offline: "bg-muted-foreground/50",
};
