import type { CommandType } from "@spp/contracts";

const adminCommands = new Set<CommandType>([
  "emergency_recover",
  "restart_controller",
  "enter_provisioning",
]);

export const isAdminCommand = (type: CommandType) => adminCommands.has(type);
export const commandRequiresActiveSession = (type: CommandType) => type !== "play" && !adminCommands.has(type);
