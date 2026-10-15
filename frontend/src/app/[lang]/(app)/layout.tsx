import { AppShell } from "@/features/shell/AppShell";

export default function AppLayout({ children }: LayoutProps<"/[lang]">) {
  return <AppShell>{children}</AppShell>;
}
