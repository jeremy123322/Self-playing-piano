import type { CommandType } from "@spp/contracts";

export type CommandStatus =
  | "pending"
  | "published"
  | "acknowledged"
  | "rejected"
  | "dispatch_failed"
  | "dispatch_uncertain";

const shutdownCommands = new Set<CommandType>([
  "stop",
  "emergency_recover",
  "restart_controller",
]);

export const commandCanBeAdmitted = (
  previousStatus: CommandStatus | undefined,
  requestedType: CommandType,
) => {
  if (previousStatus === "pending") return false;
  if (previousStatus !== "published" && previousStatus !== "dispatch_uncertain") return true;
  return shutdownCommands.has(requestedType);
};

export const commandShouldBeRetained = (type: CommandType) =>
  shutdownCommands.has(type);
