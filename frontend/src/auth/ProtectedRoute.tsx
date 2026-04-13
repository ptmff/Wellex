import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { useI18n } from "@/i18n/I18nContext";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const { language } = useI18n();

  if (isLoading) {
    return <div className="text-center py-20 text-muted-foreground">{language === "ru" ? "Загрузка..." : "Loading..."}</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

