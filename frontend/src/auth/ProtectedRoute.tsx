import { Fragment, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";
import { useI18n } from "@/i18n/useI18n";
import { isStaffRole } from "@/lib/money";

export function ProtectedRoute({
  children,
  staffOnly = false,
}: {
  children: ReactNode;
  staffOnly?: boolean;
}) {
  const { user, isLoading } = useAuth();
  const { language } = useI18n();
  const location = useLocation();

  if (isLoading) {
    return <div role="status" className="text-center py-20 text-muted-foreground">{language === "ru" ? "Загрузка..." : "Loading..."}</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search + location.hash }} />;
  }

  if (staffOnly && !isStaffRole(user.role)) {
    return <Navigate to="/markets" replace />;
  }

  return <Fragment key={user.id}>{children}</Fragment>;
}
