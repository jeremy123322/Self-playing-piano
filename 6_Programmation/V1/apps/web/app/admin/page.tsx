import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { adminSession } from "@/lib/authorization";

const AdminPage = async () => {
  if (!await adminSession()) redirect("/login?admin=1");
  return <AdminDashboard />;
};

export default AdminPage;
