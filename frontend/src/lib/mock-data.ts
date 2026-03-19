export interface Market {
  id: string;
  title: string;
  category: string;
  probability: number;
  volume: number;
  liquidity: number;
  participants: number;
  endDate: string;
  trending: boolean;
  isNew: boolean;
  image?: string;
  priceHistory: { time: string; yes: number; no: number }[];
  recentTrades: { user: string; side: "YES" | "NO"; amount: number; price: number; time: string }[];
}

export interface Position {
  marketId: string;
  marketTitle: string;
  side: "YES" | "NO";
  shares: number;
  avgPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}

const generatePriceHistory = (base: number): Market["priceHistory"] => {
  const history: Market["priceHistory"][] = [];
  let price = base - 15 + Math.random() * 10;
  const points: Market["priceHistory"] = [];
  for (let i = 30; i >= 0; i--) {
    price = Math.max(5, Math.min(95, price + (Math.random() - 0.48) * 4));
    const d = new Date();
    d.setDate(d.getDate() - i);
    points.push({
      time: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      yes: Math.round(price),
      no: Math.round(100 - price),
    });
  }
  return points;
};

const generateTrades = (): Market["recentTrades"] => {
  const names = ["0x7a2f...d1e3", "0xb9c4...8f2a", "0x3e1d...c7b5", "0xf582...a6d9", "0x1c8e...b4f7"];
  return Array.from({ length: 8 }, (_, i) => {
    const side = Math.random() > 0.5 ? "YES" as const : "NO" as const;
    return {
      user: names[Math.floor(Math.random() * names.length)],
      side,
      amount: Math.floor(Math.random() * 500 + 10),
      price: Math.floor(Math.random() * 40 + 30),
      time: `${Math.floor(Math.random() * 59 + 1)}m ago`,
    };
  });
};

export const markets: Market[] = [
  {
    id: "1",
    title: "Will Bitcoin exceed $150K by end of 2026?",
    category: "Crypto",
    probability: 62,
    volume: 2450000,
    liquidity: 890000,
    participants: 4521,
    endDate: "Dec 31, 2026",
    trending: true,
    isNew: false,
    priceHistory: generatePriceHistory(62),
    recentTrades: generateTrades(),
  },
  {
    id: "2",
    title: "Will SpaceX Starship reach orbit in Q2 2026?",
    category: "Science",
    probability: 78,
    volume: 1890000,
    liquidity: 650000,
    participants: 3890,
    endDate: "Jun 30, 2026",
    trending: true,
    isNew: false,
    priceHistory: generatePriceHistory(78),
    recentTrades: generateTrades(),
  },
  {
    id: "3",
    title: "Will the Fed cut rates below 3% in 2026?",
    category: "Economics",
    probability: 34,
    volume: 3200000,
    liquidity: 1200000,
    participants: 7654,
    endDate: "Dec 31, 2026",
    trending: false,
    isNew: false,
    priceHistory: generatePriceHistory(34),
    recentTrades: generateTrades(),
  },
  {
    id: "4",
    title: "Will GPT-5 be released before July 2026?",
    category: "Tech",
    probability: 45,
    volume: 980000,
    liquidity: 420000,
    participants: 2345,
    endDate: "Jul 1, 2026",
    trending: true,
    isNew: true,
    priceHistory: generatePriceHistory(45),
    recentTrades: generateTrades(),
  },
  {
    id: "5",
    title: "Will Ethereum flip Bitcoin in market cap?",
    category: "Crypto",
    probability: 12,
    volume: 5600000,
    liquidity: 2100000,
    participants: 12300,
    endDate: "Dec 31, 2026",
    trending: false,
    isNew: false,
    priceHistory: generatePriceHistory(12),
    recentTrades: generateTrades(),
  },
  {
    id: "6",
    title: "Will Russia-Ukraine ceasefire happen in 2026?",
    category: "Politics",
    probability: 28,
    volume: 4100000,
    liquidity: 1500000,
    participants: 9870,
    endDate: "Dec 31, 2026",
    trending: true,
    isNew: false,
    priceHistory: generatePriceHistory(28),
    recentTrades: generateTrades(),
  },
  {
    id: "7",
    title: "Will Apple release AR glasses in 2026?",
    category: "Tech",
    probability: 55,
    volume: 1200000,
    liquidity: 560000,
    participants: 3456,
    endDate: "Dec 31, 2026",
    trending: false,
    isNew: true,
    priceHistory: generatePriceHistory(55),
    recentTrades: generateTrades(),
  },
  {
    id: "8",
    title: "Will Champions League final be in the US?",
    category: "Sports",
    probability: 8,
    volume: 780000,
    liquidity: 340000,
    participants: 2100,
    endDate: "May 30, 2026",
    trending: false,
    isNew: true,
    priceHistory: generatePriceHistory(8),
    recentTrades: generateTrades(),
  },
];

export const positions: Position[] = [
  {
    marketId: "1",
    marketTitle: "Will Bitcoin exceed $150K by end of 2026?",
    side: "YES",
    shares: 150,
    avgPrice: 58,
    currentPrice: 62,
    pnl: 600,
    pnlPercent: 6.9,
  },
  {
    marketId: "3",
    marketTitle: "Will the Fed cut rates below 3% in 2026?",
    side: "NO",
    shares: 200,
    avgPrice: 60,
    currentPrice: 66,
    pnl: 1200,
    pnlPercent: 10.0,
  },
  {
    marketId: "4",
    marketTitle: "Will GPT-5 be released before July 2026?",
    side: "YES",
    shares: 80,
    avgPrice: 50,
    currentPrice: 45,
    pnl: -400,
    pnlPercent: -10.0,
  },
];

export const categories = ["All", "Crypto", "Tech", "Politics", "Economics", "Science", "Sports"];

export const formatVolume = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
};
