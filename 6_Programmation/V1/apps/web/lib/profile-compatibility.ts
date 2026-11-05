import type { ReportedState } from "@spp/contracts";

export interface ProfileIdentity {
  id: string;
  version: number;
}

export const profilesMatch = (
  configured: ProfileIdentity,
  reported: { id: string; version: number | undefined },
) => reported.id === configured.id && reported.version === configured.version;

export const profileMismatchMessage = (
  configured: ProfileIdentity,
  reported: { id: string; version: number | undefined },
) => `Firmware profile ${reported.id}@${reported.version ?? "unknown"} does not match configured profile ${configured.id}@${configured.version}`;

export const enforceReportedProfile = (
  configured: ProfileIdentity,
  reported: ReportedState,
): ReportedState => {
  const firmwareProfile = {
    id: reported.profileId,
    version: reported.profileVersion || undefined,
  };
  if (profilesMatch(configured, firmwareProfile)) return reported;
  return {
    ...reported,
    state: reported.online ? "error" : "offline",
    error: {
      code: "profile_mismatch",
      message: profileMismatchMessage(configured, firmwareProfile),
    },
  };
};
