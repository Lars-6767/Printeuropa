"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function AppNav({ items, label }: { items: { href: string; label: string; exact?: boolean }[]; label: string }) {
  const path = usePathname();
  return (
    <nav className="app-nav" aria-label={label}>
      <div className="container">
        <ul>
          {items.map((i) => {
            const active = i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/");
            return <li key={i.href}><Link href={i.href} aria-current={active ? "page" : undefined}>{i.label}</Link></li>;
          })}
        </ul>
      </div>
    </nav>
  );
}
