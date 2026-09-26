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

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { permissions, role } = usePermissions();
  const items = navigationFor(permissions, role);

  return (
    <>
      {open ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-navy/40 lg:hidden"
          aria-label="Close navigation"
          onClick={onClose}
        />
      ) : null}
      <aside
        className={`${open ? "flex" : "hidden"} fixed inset-y-0 left-0 z-40 w-64 flex-col bg-navy text-white lg:sticky lg:flex lg:h-screen`}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <Mark tone="light" />
          <div>
            <p className="text-sm font-semibold">Secure DMS</p>
            <p className="text-xs text-white/65">Case records</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
          <ul className="space-y-1">
            {items.map((item) => {
              const active = item.enabled && (item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href));
              if (!item.enabled) {
                return (
                  <li key={item.label}>
                    <span aria-disabled="true" className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-white/40">
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
                    className={`block rounded-md border-l-2 px-3 py-2 text-sm ${
                      active
                        ? "border-brass bg-white/10 font-medium text-white"
                        : "border-transparent text-white/80 hover:bg-white/5"
                    }`}
                    onClick={onClose}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <p className="border-t border-white/10 px-5 py-4 text-xs leading-5 text-white/55">
          Prototype · fictional demonstration data
        </p>
      </aside>
    </>
  );
}

function navigationFor(permissions: string[], role: string): NavItem[] {
  const items: NavItem[] = [{ href: "/dashboard", label: "Dashboard", enabled: true }];
  if (can(permissions, "CASE.READ")) {
    items.push({ href: "/cases", label: "Cases", enabled: true });
  }
  if (can(permissions, "DOCUMENT.READ") || can(permissions, "CASE.READ")) {
    items.push({ href: "/search", label: "Search", enabled: true });
  }
  if (can(permissions, "CASE.READ")) {
    items.push({ href: "/assistant", label: "Case assistant", enabled: true });
  }
  if (role === "FORENSIC_EXAMINER" && can(permissions, "FORENSIC_REPORT.UPDATE")) {
    items.push({ href: "/forensics/work-queue", label: "Forensic work", enabled: true });
  }
  if (role === "FORENSIC_REVIEWER" && can(permissions, "FORENSIC_REPORT.REVIEW")) {
    items.push({ href: "/forensics/reviews", label: "Forensic reviews", enabled: true });
  }
  if (
    can(permissions, "ACCESS_REQUEST.CREATE") ||
    can(permissions, "ACCESS_REQUEST.READ") ||
    can(permissions, "ACCESS_REQUEST.APPROVE")
  ) {
    items.push({ href: "/requests", label: "Requests", enabled: true });
  }
  if (can(permissions, "USER.READ")) {
    items.push({ href: "/users", label: "Users", enabled: true });
  }
  if (can(permissions, "DEPARTMENT.READ")) {
    items.push({ href: "/departments", label: "Departments", enabled: true });
  }
  if (can(permissions, "AUDIT_LOG.READ")) {
    items.push({ href: "/audit", label: "Audit", enabled: true });
  }
  if (can(permissions, "COURT_PACKAGE.READ")) {
    items.push({ href: "/court-packages", label: "Court packages", enabled: false });
  }
  return items;
}
