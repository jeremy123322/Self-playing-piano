interface StatusCursor {
  lastHandledRevision: number;
  lastAppliedRevision: number;
  reportedAt: string | Date;
}

const timestamp = (value: string | Date) =>
  value instanceof Date ? value.getTime() : Date.parse(value);

export const statusIsCurrentOrNewer = (
  current: StatusCursor,
  incoming: StatusCursor,
) => {
  if (incoming.lastHandledRevision !== current.lastHandledRevision) {
    return incoming.lastHandledRevision > current.lastHandledRevision;
  }
  if (incoming.lastAppliedRevision !== current.lastAppliedRevision) {
    return incoming.lastAppliedRevision > current.lastAppliedRevision;
  }
  return timestamp(incoming.reportedAt) >= timestamp(current.reportedAt);
};
