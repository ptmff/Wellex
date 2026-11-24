import { useI18n } from "@/i18n/useI18n";
import { Navbar } from "./Navbar";
import { BottomNav } from "./BottomNav";
import { SiteFooter } from "./SiteFooter";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { language } = useI18n();
  return (
    <div className="min-h-[100dvh] bg-background pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-background focus:px-4 focus:py-3">
        {language === "ru" ? "К основному содержанию" : "Skip to main content"}
      </a>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="container min-w-0 py-5 sm:py-6">{children}</main>
      <SiteFooter />
      <BottomNav />
    </div>
  );
}
