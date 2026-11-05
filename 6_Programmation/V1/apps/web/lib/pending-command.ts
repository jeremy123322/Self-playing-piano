import type { CommandType, ReportedState } from "@spp/contracts";

export interface PendingCommand {
  type: CommandType;
  revision: number | undefined;
}

export type PendingCommandOutcome = "pending" | "accepted" | "rejected";

export const pendingCommandOutcome = (
  command: PendingCommand,
  status: ReportedState,
): PendingCommandOutcome => {
  const durableAcknowledgementPending = status.statusDelivery?.pendingReports !== 0;
  if (command.revision === undefined ||
      status.lastHandledRevision < command.revision ||
      durableAcknowledgementPending) {
    return "pending";
  }
  if (status.acknowledgement?.revision === command.revision &&
      status.acknowledgement.result === "rejected") {
    return "rejected";
  }
  return "accepted";
};
