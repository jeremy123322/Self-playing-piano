import { LibraryApp } from "@/components/library-app";
import { viewerRole } from "@/lib/authorization";

const HomePage = async () => {
  const role = await viewerRole();
  return <LibraryApp viewerRole={role} />;
};

export default HomePage;
