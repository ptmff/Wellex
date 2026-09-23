import { Navbar } from "./Navbar";
import { BottomNav } from "./BottomNav";
import { SiteFooter } from "./SiteFooter";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-6 pb-20 md:pb-6">{children}</main>
      <SiteFooter />
      <BottomNav />
    </div>
  );
}
