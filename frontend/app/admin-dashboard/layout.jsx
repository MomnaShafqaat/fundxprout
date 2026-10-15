import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import Link from "next/link";
import { ShieldCheck, LogOut, ExternalLink } from "lucide-react";

import AdminSidebar from "@/components/admin/AdminSidebar";

export default async function AdminLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin-login");
  }

  const isMetadataAdmin = user?.user_metadata?.is_admin === true;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("user_id", user.id)
    .single();

  if (profile?.role !== "admin" && !isMetadataAdmin) {
    redirect("/admin-login"); // Unauthorized users redirected to admin login portal
  }

  return (
    <div className="min-h-screen bg-[#181A2A] text-white">
      {/* Top Admin Navigation Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#181A2A]/95 backdrop-blur-md border-b border-white/10 px-4 sm:px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3 pl-12 md:pl-0">
          <div className="h-9 w-9 rounded-xl bg-[#a78bfa]/10 border border-[#a78bfa]/20 flex items-center justify-center text-[#a78bfa]">
            <ShieldCheck size={20} />
          </div>
          <div>
            <Link href="/admin-dashboard" className="font-bold text-white text-base hover:text-[#a78bfa] transition">
              FundXProut Admin
            </Link>
            <span className="ml-2 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#a78bfa]/20 text-[#a78bfa] font-bold">
              Master Control
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <span className="text-gray-400 hidden sm:inline">
            Logged in as <strong className="text-white font-mono">{user.email}</strong>
          </span>
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 text-gray-300 hover:text-white hover:border-white/20 transition"
          >
            App Main Site <ExternalLink size={12} />
          </Link>
        </div>
      </header>

      {/* Admin Shell: Sidebar + Content */}
      <div className="flex min-h-[calc(100vh-61px)]">
        <AdminSidebar userEmail={user.email} />
        <main className="flex-1 md:pl-[220px] min-w-0 transition-all duration-200">
          {children}
        </main>
      </div>
    </div>
  );
}
