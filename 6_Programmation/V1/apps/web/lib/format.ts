export const formatDuration = (milliseconds: number) => {
  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

/** Absolute date + time, e.g. "22 Jul 2026, 19:04" - precise timestamps matter most for debugging. */
export const formatDateTime = (isoDate: string) =>
  new Date(isoDate).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
