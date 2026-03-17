import { redirect } from "next/navigation";
import { AdminDashboard } from "@/components/admin-dashboard";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Admin — RedFlag AI",
  robots: "noindex, nofollow",
};

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!user || !adminEmail || user.email !== adminEmail) {
    redirect("/");
  }

  return <AdminDashboard />;
}
