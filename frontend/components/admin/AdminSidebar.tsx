'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  ShieldCheck,
  ArrowLeftRight,
  BarChart2,
  ScrollText,
  ExternalLink,
  Menu,
  X,
  ChevronRight,
  Shield,
  LogOut,
} from 'lucide-react';
import { createClient } from '@/utils/supabase/client';

interface AdminSidebarProps {
  userEmail?: string;
}

const navItems = [
  {
    href: '/admin-dashboard',
    label: 'Overview',
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: '/admin-dashboard/kyc-kyb-analytics',
    label: 'KYC & KYB Verifications',
    icon: ShieldCheck,
    exact: false,
  },
  {
    href: '/admin-dashboard/marketplace',
    label: 'Marketplace',
    icon: ArrowLeftRight,
    exact: false,
  },
  {
    href: '/admin-dashboard/campaigns',
    label: 'Campaign Moderation',
    icon: BarChart2,
    exact: false,
  },
  {
    href: '/admin-dashboard/audit-log',
    label: 'Activity & Audit Log',
    icon: ScrollText,
    exact: false,
  },
];

export default function AdminSidebar({ userEmail }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const isActive = (href: string, exact: boolean) => {
    if (exact) {
      return pathname === href;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const handleSignOut = async () => {
    try {
      setIsSigningOut(true);
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/admin-login');
    } catch (err) {
      console.error('Sign out error:', err);
      window.location.href = '/admin-login';
    }
  };

  const navContent = (
    <div className="flex flex-col h-full justify-between">
      {/* Navigation Links */}
      <div className="flex-1 py-4 px-2.5 space-y-5 overflow-y-auto">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500 px-2.5 mb-2">
            Menu
          </p>

          <div className="flex flex-col gap-1">
            {navItems.map((item) => {
              const active = isActive(item.href, item.exact);
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`group relative flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs font-medium transition-all duration-150 ${
                    active
                      ? 'bg-[#a78bfa]/15 text-[#a78bfa] border border-[#a78bfa]/30 font-semibold'
                      : 'text-gray-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  {/* Active Indicator Bar */}
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-[#a78bfa]" />
                  )}

                  {/* Icon */}
                  <Icon
                    size={16}
                    className={`shrink-0 transition-colors ${
                      active ? 'text-[#a78bfa]' : 'text-gray-400 group-hover:text-white'
                    }`}
                  />

                  {/* Label */}
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Shortcuts */}
        <div className="pt-3 border-t border-white/5">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500 px-2.5 mb-2">
            Shortcuts
          </p>

          <div className="flex flex-col gap-1">
            <Link
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-2.5 py-2 rounded-xl text-[11px] text-gray-400 hover:text-white hover:bg-white/[0.04] transition"
            >
              <span className="flex items-center gap-2">
                <ExternalLink size={13} className="text-gray-500" />
                Live Platform
              </span>
              <ChevronRight size={12} className="text-gray-600" />
            </Link>

            <Link
              href="/marketplace"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-2.5 py-2 rounded-xl text-[11px] text-gray-400 hover:text-white hover:bg-white/[0.04] transition"
            >
              <span className="flex items-center gap-2">
                <ExternalLink size={13} className="text-gray-500" />
                Secondary Market
              </span>
              <ChevronRight size={12} className="text-gray-600" />
            </Link>
          </div>
        </div>
      </div>

      {/* Footer Info & Sign Out */}
      <div className="p-2.5 border-t border-white/10 bg-[#141a2e]/60 space-y-2">
        <div className="p-2.5 rounded-xl bg-[#181A2A] border border-white/5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5 text-gray-400">
              <Shield size={12} className="text-[#a78bfa]" />
              <span className="font-semibold text-gray-300">Master Control</span>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Online
            </span>
          </div>

          <div className="text-[10px] font-mono text-gray-400 truncate">
            {userEmail ? (
              <span title={userEmail}>{userEmail}</span>
            ) : (
              <span>Sepolia Testnet</span>
            )}
          </div>
        </div>

        {/* Sign Out Button */}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          suppressHydrationWarning
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
        >
          <LogOut size={13} />
          <span>{isSigningOut ? 'Signing out…' : 'Sign Out'}</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Toggle Button */}
      <div className="md:hidden fixed top-3 left-4 z-50 flex items-center">
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle admin sidebar"
          suppressHydrationWarning
          className="p-2 rounded-xl bg-[#141a2e] border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition shadow-lg"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile Overlay Backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition-opacity"
        />
      )}

      {/* Mobile Drawer */}
      <aside
        className={`md:hidden fixed top-[61px] left-0 bottom-0 z-50 w-[220px] bg-[#141a2e] border-r border-white/10 transform transition-transform duration-300 ease-in-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {navContent}
      </aside>

      {/* Desktop Fixed Sidebar */}
      <aside className="hidden md:flex fixed top-[61px] left-0 bottom-0 z-40 w-[220px] bg-[#141a2e] border-r border-white/10 flex-col">
        {navContent}
      </aside>
    </>
  );
}
