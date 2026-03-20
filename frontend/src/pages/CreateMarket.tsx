import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Eye, Calendar, Tag, HelpCircle } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/auth/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { listMarkets, type BackendMarket, type CreateMarketInput, createMarket } from "@/api/markets";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function CreateMarket() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resolutionCriteria, setResolutionCriteria] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [endDate, setEndDate] = useState("");
  const [preview, setPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { request } = useAuth();
  const navigate = useNavigate();

  const categoriesQuery = useQuery({
    queryKey: ["markets-create-categories"],
    queryFn: () =>
      listMarkets(request, {
        page: 1,
        limit: 50,
        status: "active",
        sortBy: "created_at",
        sortOrder: "desc",
      }),
    enabled: !!request,
    staleTime: 60_000,
  });

  const categories = useMemo(() => {
    const items = categoriesQuery.data?.data ?? [];
    const map = new Map<string, { id: string; name: string }>();
    for (const m of items as BackendMarket[]) {
      if (!m.category) continue;
      // Backend list() может возвращать категорию без id, если поле не выбрано в SELECT.
      // Но backend сейчас исправлен — id должен приходить, а здесь делаем защиту.
      if (!m.category.id) continue;
      if (!map.has(m.category.id)) map.set(m.category.id, { id: m.category.id, name: m.category.name });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [categoriesQuery.data]);

  const selectedCategoryName = useMemo(() => categories.find((c) => c.id === categoryId)?.name ?? "", [categories, categoryId]);

  const submit = async () => {
    const t = title.trim();
    const d = description.trim();
    const r = resolutionCriteria.trim();
    const end = endDate;
    if (!t || !d || !r || !end) return;

    // Constraints mirror backend DTO:
    // title: min 10, max 500
    // description: min 20, max 5000
    // resolutionCriteria: min 20, max 2000

    // Convert `YYYY-MM-DD` from `<input type="date">` into a datetime string.
    // We set time to the end of the day in the local timezone to reduce accidental "past" values.
    const closesAtDate = new Date(`${end}T23:59:59`);
    if (Number.isNaN(closesAtDate.getTime())) {
      toast.error("Invalid end date");
      return;
    }

    // backend requires closesAt > now + 1 hour
    if (closesAtDate.getTime() <= Date.now() + 60 * 60 * 1000) {
      toast.error("Market must close at least 1 hour from now");
      return;
    }
    const closesAt = closesAtDate.toISOString();

    if (t.length < 10 || t.length > 500) {
      toast.error("Question must be between 10 and 500 characters");
      return;
    }
    if (d.length < 20 || d.length > 5000) {
      toast.error("Description must be between 20 and 5000 characters");
      return;
    }
    if (r.length < 20 || r.length > 2000) {
      toast.error("Resolution criteria must be between 20 and 2000 characters");
      return;
    }

    const payload: CreateMarketInput = {
      title: t,
      description: d,
      resolutionCriteria: r,
      categoryId: categoryId || undefined,
      closesAt,
    };

    try {
      setSubmitting(true);
      const created = await createMarket(request, payload);
      navigate(`/market/${created.id}`);
    } catch (err) {
      const message = typeof (err as any)?.message === "string" ? (err as any).message : "Failed to create market";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-1">Create Market</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Create a new prediction market for the community to trade on
        </p>

        {!preview ? (
          <div className="space-y-5">
            {/* Title */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                <HelpCircle className="h-3 w-3 inline mr-1" />
                Question
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Will [event] happen by [date]?"
                className="w-full bg-card border border-border/50 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all"
              />
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Provide details about resolution criteria..."
                rows={4}
                className="w-full bg-card border border-border/50 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all resize-none"
              />
            </div>

            {/* Category + End Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Tag className="h-3 w-3" /> Category
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full bg-card border border-border/50 rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all appearance-none"
                >
                  <option value="">Select category (optional)</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-card border border-border/50 rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all"
                />
              </div>
            </div>

            {/* Resolution Criteria */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Resolution Criteria</label>
              <textarea
                value={resolutionCriteria}
                onChange={(e) => setResolutionCriteria(e.target.value)}
                placeholder="What exact rule resolves YES?"
                rows={3}
                className="w-full bg-card border border-border/50 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => title && setPreview(true)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-foreground text-sm font-medium hover:bg-accent/80 transition-colors"
              >
                <Eye className="h-4 w-4" /> Preview
              </button>
              <motion.button
                whileTap={{ scale: 0.98 }}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all"
                disabled={!title || !description || !resolutionCriteria || !endDate || submitting}
                onClick={() => {
                  // Keep the current flow: open preview first.
                  // The actual submit is in the preview step.
                  if (title && description && resolutionCriteria && endDate) setPreview(true);
                }}
              >
                Create Market
              </motion.button>
            </div>
          </div>
        ) : (
          /* Preview */
          <div className="space-y-4">
            <div className="rounded-xl bg-card border border-border/50 p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-md">
                  {selectedCategoryName || "Uncategorized"}
                </span>
              </div>
              <h2 className="text-xl font-bold mb-2">{title || "Untitled Market"}</h2>
              {description && (
                <p className="text-sm text-muted-foreground mb-3">{description}</p>
              )}
              {resolutionCriteria && (
                <p className="text-sm text-muted-foreground mb-3">
                  <span className="font-medium text-foreground">Resolution:</span> {resolutionCriteria}
                </p>
              )}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Ends: {endDate || "TBD"}</span>
                <span>Market starts empty</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setPreview(false)}
                className="px-5 py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
              >
                Edit
              </button>
              <motion.button
                whileTap={{ scale: 0.98 }}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? "Creating..." : "Submit Market"}
              </motion.button>
            </div>
          </div>
        )}
      </motion.div>
    </AppLayout>
  );
}
