import { useState } from "react";
import { motion } from "framer-motion";
import { Eye, Calendar, Tag, DollarSign, HelpCircle } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { categories } from "@/lib/mock-data";

export default function CreateMarket() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [endDate, setEndDate] = useState("");
  const [liquidity, setLiquidity] = useState("");
  const [preview, setPreview] = useState(false);

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
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-card border border-border/50 rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all appearance-none"
                >
                  <option value="">Select category</option>
                  {categories.filter((c) => c !== "All").map((c) => (
                    <option key={c} value={c}>{c}</option>
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

            {/* Initial Liquidity */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                <DollarSign className="h-3 w-3" /> Initial Liquidity
              </label>
              <input
                type="number"
                value={liquidity}
                onChange={(e) => setLiquidity(e.target.value)}
                placeholder="500"
                className="w-full bg-card border border-border/50 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all"
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
                  {category || "Uncategorized"}
                </span>
              </div>
              <h2 className="text-xl font-bold mb-2">{title || "Untitled Market"}</h2>
              {description && (
                <p className="text-sm text-muted-foreground mb-3">{description}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Ends: {endDate || "TBD"}</span>
                <span>Liquidity: ${liquidity || "0"}</span>
                <span>Starting: 50% / 50%</span>
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
              >
                Submit Market
              </motion.button>
            </div>
          </div>
        )}
      </motion.div>
    </AppLayout>
  );
}
