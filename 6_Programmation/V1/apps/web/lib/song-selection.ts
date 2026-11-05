export const visibleSelection = <T extends { id: string }>(items: T[], currentId: string | undefined) =>
  currentId && items.some((item) => item.id === currentId) ? currentId : items[0]?.id;
