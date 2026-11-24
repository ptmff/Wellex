import { Component, lazy, Suspense, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/auth/AuthContext";
import { ProtectedRoute } from "@/auth/ProtectedRoute";
import { I18nProvider } from "@/i18n/I18nContext";
import { useI18n } from "@/i18n/useI18n";
import { CookieConsentProvider } from "@/components/CookieBanner";
import { QueryError } from "@/components/QueryError";

const Index = lazy(() => import("./pages/Index"));
const MarketDetail = lazy(() => import("./pages/MarketDetail"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const Profile = lazy(() => import("./pages/Profile"));
const CreateMarket = lazy(() => import("./pages/CreateMarket"));
const Shop = lazy(() => import("./pages/Shop"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const PaymentResult = lazy(() => import("./pages/PaymentResult"));
const LegalDocumentPage = lazy(() => import("./pages/legal/LegalDocumentPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (attempt, error) => {
        const { status } = error as { status?: number };
        return error?.name !== "AbortError" && !(typeof status === "number" && status >= 400 && status < 500) && attempt < 1;
      },
    },
  },
});

function PageLoading() {
  const { language } = useI18n();
  return <p role="status" className="py-16 text-center text-sm text-muted-foreground">{language === "ru" ? "Загрузка…" : "Loading…"}</p>;
}

function PageUnavailable() {
  const { language } = useI18n();
  return (
    <main className="container py-12">
      <QueryError
        message={language === "ru" ? "Не удалось открыть страницу." : "Could not open this page."}
        retry={() => window.location.reload()}
      />
    </main>
  );
}

class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <PageUnavailable /> : this.props.children;
  }
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <AuthProvider>
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <CookieConsentProvider>
                <PageErrorBoundary>
                  <Suspense fallback={<PageLoading />}>
                    <Routes>
                      <Route path="/" element={<Navigate to="/markets" replace />} />
                      <Route path="/markets" element={<Index />} />
                      <Route path="/market/:id" element={<MarketDetail />} />

                      <Route
                        path="/portfolio"
                        element={
                          <ProtectedRoute>
                            <Portfolio />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/profile"
                        element={
                          <ProtectedRoute>
                            <Profile />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/shop"
                        element={
                          <ProtectedRoute>
                            <Shop />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="/payment/result"
                        element={
                          <ProtectedRoute>
                            <PaymentResult />
                          </ProtectedRoute>
                        }
                      />
                      <Route path="/leaderboard" element={<Leaderboard />} />
                      <Route
                        path="/create"
                        element={
                          <ProtectedRoute staffOnly>
                            <CreateMarket />
                          </ProtectedRoute>
                        }
                      />

                      <Route path="/login" element={<Login />} />
                      <Route path="/register" element={<Register />} />
                      <Route path="/legal/:slug" element={<LegalDocumentPage />} />

                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </PageErrorBoundary>
              </CookieConsentProvider>
            </BrowserRouter>
          </TooltipProvider>
        </MotionConfig>
      </AuthProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
