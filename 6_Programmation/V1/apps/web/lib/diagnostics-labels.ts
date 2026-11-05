import type { CommandType } from "@spp/contracts";
import type { MessageKey } from "@/lib/i18n/messages";
import type { CommandStatusValue, SessionStateValue } from "@/lib/diagnostics-types";

export const COMMAND_TYPE_LABEL_KEY: Record<CommandType, MessageKey> = {
  play: "diagnostics.commandType.play",
  pause: "diagnostics.commandType.pause",
  resume: "diagnostics.commandType.resume",
  restart: "diagnostics.commandType.restart",
  stop: "diagnostics.commandType.stop",
  emergency_recover: "diagnostics.commandType.emergency_recover",
  restart_controller: "diagnostics.commandType.restart_controller",
  enter_provisioning: "diagnostics.commandType.enter_provisioning",
};

export const COMMAND_STATUS_LABEL_KEY: Record<CommandStatusValue, MessageKey> = {
  pending: "diagnostics.commandStatus.pending",
  published: "diagnostics.commandStatus.published",
  acknowledged: "diagnostics.commandStatus.acknowledged",
  rejected: "diagnostics.commandStatus.rejected",
  dispatch_failed: "diagnostics.commandStatus.dispatch_failed",
  dispatch_uncertain: "diagnostics.commandStatus.dispatch_uncertain",
};

export const COMMAND_STATUS_BADGE_CLASS: Record<CommandStatusValue, string> = {
  pending: "bg-muted text-muted-foreground",
  published: "bg-info/15 text-info",
  acknowledged: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  dispatch_failed: "bg-destructive/15 text-destructive",
  dispatch_uncertain: "bg-warning/15 text-warning",
};

export const SESSION_STATE_LABEL_KEY: Record<SessionStateValue, MessageKey> = {
  dispatching: "diagnostics.sessionState.dispatching",
  preparing: "diagnostics.sessionState.preparing",
  playing: "diagnostics.sessionState.playing",
  paused: "diagnostics.sessionState.paused",
  completed: "diagnostics.sessionState.completed",
  stopped: "diagnostics.sessionState.stopped",
  failed: "diagnostics.sessionState.failed",
};

export const SESSION_STATE_BADGE_CLASS: Record<SessionStateValue, string> = {
  dispatching: "bg-info/15 text-info",
  preparing: "bg-info/15 text-info",
  playing: "bg-warning/15 text-warning",
  paused: "bg-info/15 text-info",
  completed: "bg-success/15 text-success",
  stopped: "bg-muted text-muted-foreground",
  failed: "bg-destructive/15 text-destructive",
};
