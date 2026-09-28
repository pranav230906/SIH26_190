"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "@/components/mark";
import { can, usePermissions } from "@/components/session-context";

type NavItem = {
  href: string;
  label: string;
  enabled: boolean;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { permissions, role } = usePermissions();
  const groups = navigationFor(permissions, role);

  return (
    <>
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden transition-opacity"
          aria-label="Close navigation"
          onClick={onClose}
        />
      ) : null}
      <aside
        className={`${open ? "flex" : "hidden"} fixed inset-y-0 left-0 z-40 w-64 flex-col bg-[#0F172A] text-slate-300 lg:sticky lg:flex lg:h-screen border-r border-slate-800 shadow-xl`}
      >
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-slate-800/60 px-6 py-5 bg-[#0B1121]">
          <Mark tone="light" />
          <div>
            <p className="text-[15px] font-semibold tracking-wide text-white">RAKSHA</p>
            <p className="text-[11px] font-medium tracking-wider text-slate-400 uppercase">Legal Platform</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-4 py-6" aria-label="Primary">
          <div className="space-y-8">
            {groups.map((group) => {
              if (group.items.length === 0) return null;
              return (
                <div key={group.title}>
                  <h3 className="mb-2 px-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">
                    {group.title}
                  </h3>
                  <ul className="space-y-1">
                    {group.items.map((item) => {
                      const active =
                        item.enabled &&
                        (item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href));
                      if (!item.enabled) {
                        return (
                          <li key={item.label}>
                            <span
                              aria-disabled="true"
                              className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-slate-600"
                            >
                              {item.label}
                              <span className="text-[10px] tracking-wide uppercase">Later</span>
                            </span>
                          </li>
                        );
                      }
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            className={`block flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200 ${
                              active
                                ? "bg-blue-600/10 font-medium text-blue-400"
                                : "text-slate-400 hover:bg-slate-800/50 hover:text-white"
                            }`}
                            onClick={onClose}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-blue-500" : "bg-transparent"}`}></span>
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </nav>
      </aside>
    </>
  );
}

function navigationFor(permissions: string[], role: string): NavGroup[] {
  const workspace: NavItem[] = [{ href: "/dashboard", label: "Dashboard", enabled: true }];
  if (can(permissions, "CASE.READ")) {
    workspace.push({ href: "/cases", label: "Cases", enabled: true });
  }

  const intel: NavItem[] = [];
  if (can(permissions, "DOCUMENT.READ") || can(permissions, "CASE.READ")) {
    intel.push({ href: "/search", label: "Search", enabled: true });
  }
  if (can(permissions, "CASE.READ")) {
    intel.push({ href: "/assistant", label: "AI Assistant", enabled: true });
  }

  const operations: NavItem[] = [];
  if (role === "FORENSIC_EXAMINER" && can(permissions, "FORENSIC_REPORT.UPDATE")) {
    operations.push({ href: "/forensics/work-queue", label: "Forensic Queue", enabled: true });
  }
  if (role === "FORENSIC_REVIEWER" && can(permissions, "FORENSIC_REPORT.REVIEW")) {
    operations.push({ href: "/forensics/reviews", label: "Forensic Reviews", enabled: true });
  }
  if (
    can(permissions, "ACCESS_REQUEST.CREATE") ||
    can(permissions, "ACCESS_REQUEST.READ") ||
    can(permissions, "ACCESS_REQUEST.APPROVE")
  ) {
    operations.push({ href: "/requests", label: "Access Requests", enabled: true });
  }

  const legal: NavItem[] = [];
  if (can(permissions, "COURT_PACKAGE.READ")) {
    legal.push({ href: "/court-packages", label: "Court Packages", enabled: true });
  }

  const system: NavItem[] = [];
  if (can(permissions, "USER.READ")) {
    system.push({ href: "/users", label: "Users", enabled: true });
  }
  if (can(permissions, "DEPARTMENT.READ")) {
    system.push({ href: "/departments", label: "Departments", enabled: true });
  }
  if (can(permissions, "AUDIT_LOG.READ")) {
    system.push({ href: "/audit", label: "Audit Trail", enabled: true });
  }

  return [
    { title: "Workspace", items: workspace },
    { title: "Intelligence", items: intel },
    { title: "Operations", items: operations },
    { title: "Legal & Court", items: legal },
    { title: "System", items: system },
  ];
}
