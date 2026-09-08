import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useI18n } from "@/i18n/I18nContext";
import { isStaffRole } from "@/lib/money";

export function ProtectedRoute({
  children,
  staffOnly = false,
}: {
  children: React.ReactNode;
  staffOnly?: boolean;
}) {
  const { user, isLoading } = useAuth();
  const { language } = useI18n();

  if (isLoading) {
    return <div className="text-center py-20 text-muted-foreground">{language === "ru" ? "Загрузка..." : "Loading..."}</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (staffOnly && !isStaffRole(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
