import { useId, useRef, useState, type FormEvent } from "react";
import { Bell, LogOut, Menu, Search, User, X } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/api/notifications";
import { accountKey } from "@/auth/accountQueries";
import { useAuth } from "@/auth/useAuth";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n/useI18n";
import { formatRelativeTime } from "@/lib/date";
import { isStaffRole } from "@/lib/money";

const iconButton = "min-h-11 min-w-11 rounded-lg text-muted-foreground hover:text-foreground";

export function Navbar() {
  const { user } = useAuth();
  return <Navigation key={user?.id ?? "guest"} />;
}

function Navigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const id = useId();
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState<"search" | "menu" | null>(null);
  const [search, setSearch] = useState("");
  const { user, logout } = useAuth();
  const { language, setLanguage, t } = useI18n();
  const ru = language === "ru";
  const navLinks = [
    { label: t("nav.markets"), path: "/markets" },
    { label: t("nav.portfolio"), path: "/portfolio" },
    { label: t("nav.shop"), path: "/shop" },
    { label: ru ? "Лидеры" : "Leaders", path: "/leaderboard" },
    ...(isStaffRole(user?.role) ? [{ label: t("nav.create"), path: "/create" }] : []),
  ];
  const accountName = user ? user.displayName || user.username : t("nav.login");

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const term = search.trim();
    setExpanded(null);
    navigate(term ? `/markets?q=${encodeURIComponent(term)}` : "/markets");
  };

  const renderLinks = () => navLinks.map(({ label, path }) => {
    const active = location.pathname === path || (path === "/markets" && location.pathname.startsWith("/market/"));
    return (
      <Link
        key={path}
        to={path}
        aria-current={active ? "page" : undefined}
        onClick={() => setExpanded(null)}
        className={`rounded-lg px-3 py-2 text-sm font-medium ${
          active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        }`}
      >
        {label}
      </Link>
    );
  });

  const languageButtons = (
    <div className="flex items-center gap-1">
      {(["ru", "en"] as const).map((option) => (
        <Button
          key={option}
          variant={language === option ? "secondary" : "ghost"}
          size="sm"
          className="min-h-10"
          aria-pressed={language === option}
          onClick={() => setLanguage(option)}
        >
          {t(`lang.${option}`)}
        </Button>
      ))}
    </div>
  );

  return (
    <header
      className="glass sticky top-0 z-40 border-b border-border/30 pt-[env(safe-area-inset-top)]"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !expanded) return;
        (expanded === "search" ? searchTrigger : menuTrigger).current?.focus();
        setExpanded(null);
      }}
    >
      <div className="container flex min-h-14 items-center justify-between gap-2">
        <Link to="/markets" className="flex min-h-11 shrink-0 items-center gap-2" aria-label="Wellex">
          <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">P</span>
          <span className="font-semibold">Wellex</span>
        </Link>

        <nav aria-label={ru ? "Основная навигация" : "Main navigation"} className="hidden items-center gap-1 lg:flex">
          {renderLinks()}
        </nav>

        <div className="flex min-w-0 items-center gap-1">
          <Button
            ref={searchTrigger}
            variant="ghost"
            size="icon"
            className={iconButton}
            aria-label={t("nav.searchMarkets")}
            aria-expanded={expanded === "search"}
            aria-controls={expanded === "search" ? `${id}-search` : undefined}
            onClick={() => setExpanded(expanded === "search" ? null : "search")}
          >
            <Search aria-hidden="true" />
          </Button>
          {user && <Notifications />}
          <div className="hidden xl:block">{languageButtons}</div>
          <Button asChild variant="ghost" className="hidden min-h-11 min-w-0 max-w-36 gap-2 lg:inline-flex">
            <Link to={user ? "/profile" : "/login"} aria-label={accountName}>
              <User aria-hidden="true" className="shrink-0" />
              <span className="truncate">{accountName}</span>
            </Link>
          </Button>
          <Button
            ref={menuTrigger}
            variant="ghost"
            size="icon"
            className={iconButton}
            aria-label={expanded === "menu" ? ru ? "Закрыть меню" : "Close menu" : ru ? "Открыть меню" : "Open menu"}
            aria-expanded={expanded === "menu"}
            aria-controls={expanded === "menu" ? `${id}-menu` : undefined}
            onClick={() => setExpanded(expanded === "menu" ? null : "menu")}
          >
            {expanded === "menu" ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {expanded === "search" && (
        <form id={`${id}-search`} role="search" className="container flex gap-2 pb-3" onSubmit={submitSearch}>
          <input
            type="search"
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t("nav.searchMarkets")}
            placeholder={t("nav.searchMarkets")}
            className="min-w-0 flex-1 rounded-lg bg-secondary px-3 text-base focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" className="min-h-11">{ru ? "Найти" : "Search"}</Button>
        </form>
      )}
      {expanded === "menu" && (
        <div id={`${id}-menu`} className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-border/30">
          <div className="container grid gap-2 py-3">
            <nav aria-label={ru ? "Разделы сайта" : "Site sections"} className="grid gap-1 lg:hidden">
              {renderLinks()}
            </nav>
            <div className="xl:hidden">{languageButtons}</div>
            <Link className="flex min-h-11 items-center px-3 text-sm lg:hidden" to={user ? "/profile" : "/login"} onClick={() => setExpanded(null)}>
              {user ? t("nav.profile") : t("nav.login")}
            </Link>
            {user && (
              <Button variant="ghost" className="w-fit min-h-11 gap-2" onClick={() => void logout()}>
                <LogOut aria-hidden="true" /> {t("nav.logout")}
              </Button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

function Notifications() {
  const navigate = useNavigate();
  const { user, request } = useAuth();
  const { language } = useI18n();
  const ru = language === "ru";
  const label = ru ? "Уведомления" : "Notifications";
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const queryKey = accountKey(user?.id, "notifications");
  const notifications = useQuery({
    queryKey,
    queryFn: () => listNotifications(request),
    enabled: !!user,
    refetchInterval: 20_000,
  });
  const read = useMutation({
    mutationFn: (id?: string) => id ? markNotificationRead(request, id) : markAllNotificationsRead(request),
    onSuccess: () => client.invalidateQueries({ queryKey }),
    onError: (error) => {
      if (error?.name !== "AbortError") toast.error(ru ? "Не удалось отметить уведомления." : "Could not mark notifications as read.");
    },
  });
  const unread = notifications.data?.unread ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative ${iconButton}`}
          aria-label={unread ? `${label} (${unread})` : label}
        >
          <Bell aria-hidden="true" />
          {!!unread && <span aria-hidden="true" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        aria-label={label}
        className="z-50 w-[min(22rem,calc(100vw-1.5rem))] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-1">
          <h2 className="text-sm font-semibold">{label}</h2>
          <Button variant="ghost" size="sm" className="min-h-10" disabled={!unread || read.isPending} onClick={() => read.mutate(undefined)}>
            {ru ? "Прочитать все" : "Mark all read"}
          </Button>
        </div>
        {notifications.isError && (
          <QueryError message={ru ? "Не удалось обновить уведомления." : "Could not update notifications."}
            retry={() => void notifications.refetch()} busy={notifications.isFetching} />
        )}
        {notifications.isLoading && <p role="status" className="py-3 text-sm text-muted-foreground">{ru ? "Загрузка…" : "Loading…"}</p>}
        {notifications.isSuccess && !notifications.data.items.length && (
          <p className="py-3 text-sm text-muted-foreground">{ru ? "Уведомлений пока нет." : "No notifications yet."}</p>
        )}
        <ul className="space-y-1">
          {notifications.data?.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`w-full rounded-lg p-2 text-left [overflow-wrap:anywhere] ${item.read ? "bg-muted/40" : "bg-accent"}`}
                onClick={() => {
                  if (!item.read) read.mutate(item.id);
                  const payload = item.payload as { marketId?: string } | null;
                  if (typeof payload?.marketId === "string" && payload.marketId) {
                    void navigate(`/market/${encodeURIComponent(payload.marketId)}`);
                    setOpen(false);
                  }
                }}
              >
                <span className="block text-sm font-medium">{item.title}</span>
                <span className="block text-xs text-muted-foreground">{item.body}</span>
                <span className="block text-xs text-muted-foreground">{formatRelativeTime(item.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
