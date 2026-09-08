import type { AuthRequest } from "./markets";

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  payload: unknown;
  read: boolean;
  createdAt: string;
};

export type NotificationList = {
  unread: number;
  items: AppNotification[];
};

export async function listNotifications(request: AuthRequest) {
  return request<NotificationList>("/notifications", { method: "GET", authRequired: true });
}

export async function markNotificationRead(request: AuthRequest, id: string) {
  return request<NotificationList>(`/notifications/${id}/read`, { method: "POST", authRequired: true });
}

export async function markAllNotificationsRead(request: AuthRequest) {
  return request<NotificationList>("/notifications/read-all", { method: "POST", authRequired: true });
}
