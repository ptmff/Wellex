import { useState } from "react";
import { motion } from "framer-motion";

interface TradePanelProps {
  probability: number;
}

export function TradePanel({ probability }: TradePanelProps) {
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("");
  const [action, setAction] = useState<"buy" | "sell">("buy");

  const price = side === "YES" ? probability : 100 - probability;
  const shares = amount ? Math.floor((parseFloat(amount) / price) * 100) : 0;
  const potentialReturn = amount ? (shares * (100 - price) / 100).toFixed(2) : "0.00";

  return (
    <div className="rounded-xl bg-card border border-border/50 p-4">
      <h3 className="text-sm font-semibold mb-3">Trade</h3>

      {/* Buy/Sell toggle */}
      <div className="flex gap-1 p-0.5 bg-secondary rounded-lg mb-3">
        {(["buy", "sell"] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAction(a)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md capitalize transition-all duration-200 ${
              action === a
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {/* YES/NO toggle */}
      <div className="flex gap-2 mb-4">
        {(["YES", "NO"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
              side === s
                ? s === "YES"
                  ? "bg-success/15 text-success border border-success/30"
                  : "bg-danger/15 text-danger border border-danger/30"
                : "bg-secondary text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            {s} {s === "YES" ? `${probability}¢` : `${100 - probability}¢`}
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <label className="text-xs text-muted-foreground mb-1.5 block">Amount ($)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all"
        />
        <div className="flex gap-2 mt-2">
          {[10, 25, 50, 100].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              className="flex-1 py-1 text-xs font-medium bg-secondary rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              ${v}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="space-y-2 mb-4 text-xs">
        <div className="flex justify-between text-muted-foreground">
          <span>Avg price</span>
          <span className="text-foreground font-medium">{price}¢</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Est. shares</span>
          <span className="text-foreground font-medium">{shares}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Potential return</span>
          <span className="text-success font-medium">${potentialReturn}</span>
        </div>
      </div>

      {/* Submit */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        className={`w-full py-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
          side === "YES"
            ? "bg-success text-success-foreground hover:brightness-110"
            : "bg-danger text-danger-foreground hover:brightness-110"
        }`}
      >
        {action === "buy" ? "Buy" : "Sell"} {side}
      </motion.button>
    </div>
  );
}
