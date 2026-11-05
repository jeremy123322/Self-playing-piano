import type { ReportedState } from "@spp/contracts";

export interface UncertainCommand {
  sessionId: string;
  revision: number;
}

export const uncertainCommandResolved = (
  command: UncertainCommand,
  reported: ReportedState,
) => reported.lastHandledRevision >= command.revision;
