import { auth } from "@/auth";

export type ViewerRole = "anonymous" | "controller" | "admin";

const isControllerRole = (role: string | undefined) => role === "controller" || role === "admin";
const isAdminRole = (role: string | undefined) => role === "admin";

export const controllerSession = async () => {
  const session = await auth();
  return isControllerRole(session?.user?.role) ? session : null;
};

export const adminSession = async () => {
  const session = await auth();
  return isAdminRole(session?.user?.role) ? session : null;
};

export const viewerRole = async (): Promise<ViewerRole> => {
  const session = await auth();
  if (isAdminRole(session?.user?.role)) return "admin";
  if (isControllerRole(session?.user?.role)) return "controller";
  return "anonymous";
};
