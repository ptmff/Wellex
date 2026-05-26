import { db } from '../connection';
import { logger } from '../../common/logger';
import bcrypt from 'bcryptjs';
import Decimal from 'decimal.js';

const SEED_DATE = new Date('2026-05-26T12:00:00.000Z');

function daysAgo(n: number): Date {
  const d = new Date(SEED_DATE);
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date(SEED_DATE);
  d.setDate(d.getDate() + n);
  return d;
}

function rnd(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function rndInt(min: number, max: number): number {
  return Math.floor(rnd(min, max + 1));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function generatePricePath(start: number, end: number, steps: number, vol = 0.04): number[] {
  const path: number[] = [];
  const drift = (end - start) / steps;
  let cur = start;
  for (let i = 0; i < steps; i++) {
    cur = clamp(cur + drift + (Math.random() - 0.5) * vol * 2, 0.02, 0.98);
    path.push(parseFloat(cur.toFixed(8)));
  }
  path[path.length - 1] = end;
  return path;
}

// Compute yes/no shares such that LMSR price ≈ target
function computeShares(b: number, price: number): { yes: number; no: number } {
  const base = b * 3;
  const logOdds = Math.log(price / (1 - price));
  return { yes: base + b * logOdds, no: base };
}

export async function runSeeds(): Promise<void> {
  logger.info('Running comprehensive seeds...');

  // ─── CATEGORIES ───────────────────────────────────────────────────
  const categoriesData = [
    { name: 'Politics', slug: 'politics', icon: '🏛️', description: 'Elections, policy, government, and political events worldwide.' },
    { name: 'Technology', slug: 'technology', icon: '💻', description: 'AI, startups, products, and tech industry milestones.' },
    { name: 'Sports', slug: 'sports', icon: '⚽', description: 'Championships, records, transfers, and athlete performance.' },
    { name: 'Finance', slug: 'finance', icon: '📈', description: 'Markets, economic indicators, central banks, and corporate finance.' },
    { name: 'Science', slug: 'science', icon: '🔬', description: 'Research breakthroughs, space exploration, and scientific milestones.' },
    { name: 'Entertainment', slug: 'entertainment', icon: '🎬', description: 'Movies, music, TV, gaming, and pop culture.' },
    { name: 'Crypto', slug: 'crypto', icon: '🪙', description: 'Cryptocurrency prices, regulation, adoption, and DeFi.' },
    { name: 'World Events', slug: 'world-events', icon: '🌍', description: 'Geopolitics, international relations, climate, and global news.' },
  ];
  await db('market_categories').insert(categoriesData).onConflict('slug').ignore();
  const cats = await db('market_categories').select('id', 'slug');
  const catMap: Record<string, string> = Object.fromEntries(cats.map((c: any) => [c.slug, c.id]));

  // ─── USERS ────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('Password123', 12);
  const usersRaw = [
    { username: 'admin',      email: 'admin@wellex.io',            role: 'admin',     display_name: 'Admin',           bio: null,                                                                                          balance: 0,        joined: 180 },
    { username: 'moderator',  email: 'moderator@wellex.io',        role: 'moderator', display_name: 'Moderator',       bio: 'Keeping markets fair and transparent.',                                                       balance: 5000,     joined: 175 },
    { username: 'exchange',   email: 'exchange@wellex.io',         role: 'admin',     display_name: 'Exchange',        bio: null,                                                                                          balance: 0,        joined: 180 },
    { username: 'marcus_t',   email: 'marcus.thornton@gmail.com',  role: 'user',      display_name: 'Marcus Thornton', bio: 'Quant trader. Bayesian priors on politics & macro. 3-year Brier score: 0.14.',               balance: 38420.5,  joined: 170 },
    { username: 'sarah_k',    email: 'sarah.kim@proton.me',        role: 'user',      display_name: 'Sarah Kim',       bio: 'Data scientist at a hedge fund. Calibrated forecasting. My Brier score beats the pundits.',   balance: 54890.25, joined: 168 },
    { username: 'devraj_p',   email: 'devraj.patel@gmail.com',     role: 'user',      display_name: 'Devraj Patel',    bio: 'Ex-FAANG SWE. Tech markets are my edge. First-believer in Starship and GPT-5.',               balance: 29340.75, joined: 162 },
    { username: 'zoe_chen',   email: 'zoe.chen@outlook.com',       role: 'user',      display_name: 'Zoe Chen',        bio: 'Economist turned crypto trader. I model everything. PhD dropout by choice.',                   balance: 71230.00, joined: 158 },
    { username: 'liam_w',     email: 'liam.walker@yahoo.com',      role: 'user',      display_name: 'Liam Walker',     bio: 'Sports analyst and die-hard Spurs fan. Decent at predicting upsets.',                         balance: 8920.50,  joined: 155 },
    { username: 'natasha_r',  email: 'natasha.romano@proton.me',   role: 'user',      display_name: 'Natasha Romano',  bio: 'International relations PhD. Geopolitics is my bread and butter.',                            balance: 23150.80, joined: 150 },
    { username: 'kai_y',      email: 'kai.yamamoto@gmail.com',     role: 'user',      display_name: 'Kai Yamamoto',    bio: 'Crypto OG since 2017. Survived three bear markets. Diamond hands.',                           balance: 112400.0, joined: 145 },
    { username: 'brooklyn_s', email: 'brooklyn.steele@gmail.com',  role: 'user',      display_name: 'Brooklyn Steele', bio: 'Entertainment industry. I know things before they hit the trades.',                           balance: 18760.30, joined: 140 },
    { username: 'felix_m',    email: 'felix.muller@gmail.com',     role: 'user',      display_name: 'Felix Müller',    bio: 'European politics & macro. Frankfurt-based. Long-time EUR skeptic.',                          balance: 31980.60, joined: 135 },
    { username: 'igor_v',     email: 'igor.volkov@proton.me',      role: 'user',      display_name: 'Igor Volkov',     bio: 'Geopolitics & energy. Long tail risk specialist. Former security analyst.',                   balance: 19450.20, joined: 128 },
    { username: 'priya_n',    email: 'priya.nair@gmail.com',       role: 'user',      display_name: 'Priya Nair',      bio: 'Climate researcher and evidence-based forecaster. Science meets policy.',                      balance: 14890.40, joined: 120 },
    { username: 'omar_h',     email: 'omar.hassan@gmail.com',      role: 'user',      display_name: 'Omar Hassan',     bio: 'Former Wall Street analyst, now trading full-time. Finance & macro.',                          balance: 42670.90, joined: 115 },
  ];

  const userMap: Record<string, string> = {};
  for (const u of usersRaw) {
    let [existing] = await db('users').where('email', u.email).select('id');
    if (!existing) {
      const [created] = await db('users').insert({
        email: u.email, username: u.username, password_hash: passwordHash,
        display_name: u.display_name, bio: u.bio, role: u.role,
        status: 'active', email_verified: true,
        email_verified_at: daysAgo(u.joined),
        last_login_at: daysAgo(rndInt(0, 3)),
        created_at: daysAgo(u.joined),
        updated_at: daysAgo(rndInt(0, 5)),
      }).returning('id');
      existing = created;

      await db('balances').insert({
        user_id: existing.id,
        available: u.balance.toFixed(8), reserved: '0.00000000',
        total: u.balance.toFixed(8),
        available_cash: u.balance.toFixed(8), reserved_cash: '0.00000000',
        currency: 'USD', version: 0,
      });

      if (u.balance > 0) {
        await db('balance_transactions').insert({
          user_id: existing.id, type: 'deposit',
          amount: u.balance.toFixed(8), balance_before: '0.00000000',
          balance_after: u.balance.toFixed(8),
          description: 'Initial deposit', metadata: '{}',
          created_at: daysAgo(u.joined),
        });
      }
    }
    userMap[u.username] = existing.id;
  }
  logger.info('Users seeded');

  // ─── MARKETS ──────────────────────────────────────────────────────
  type MarketSeed = {
    slug: string; title: string; description: string; resolution_criteria: string;
    category: string; status: string; outcome?: string;
    closes_at: Date; resolved_at?: Date;
    yes_price: number; initial_liquidity: number;
    volume_total: number; volume_24h: number; trade_count: number; unique_traders: number;
    is_featured: boolean; tags: string[]; created_at: Date;
  };

  const marketsData: MarketSeed[] = [
    // ── POLITICS ──
    {
      slug: 'dem-midterms-2026',
      title: 'Will Democrats win the House majority in the 2026 US Midterms?',
      description: 'With President Trump in his second term, historical patterns suggest midterm losses for the incumbent party. However, demographic shifts and economic conditions make this genuinely uncertain. This market resolves YES if Democrats win a majority (218+ seats) in the US House of Representatives in the November 2026 midterm elections.',
      resolution_criteria: 'Democrats hold 218+ seats in the US House after the November 2026 election per AP/major media calls.',
      category: 'politics', status: 'active',
      closes_at: daysFromNow(164), yes_price: 0.41,
      initial_liquidity: 2000, volume_total: 48320, volume_24h: 1240,
      trade_count: 1872, unique_traders: 234, is_featured: true,
      tags: ['US Politics', 'Midterms', '2026', 'Congress'], created_at: daysAgo(150),
    },
    {
      slug: 'trump-tiktok-ban-2026',
      title: 'Will TikTok be effectively banned in the US before July 2026?',
      description: 'The TikTok saga has gone through courts, legislation, and executive action. This market resolves YES if TikTok is removed from US app stores AND inaccessible without a VPN before July 1, 2026.',
      resolution_criteria: 'TikTok removed from Apple App Store and Google Play in the US AND inaccessible without VPN before July 1, 2026.',
      category: 'politics', status: 'active',
      closes_at: daysFromNow(35), yes_price: 0.19,
      initial_liquidity: 1500, volume_total: 31500, volume_24h: 890,
      trade_count: 1231, unique_traders: 189, is_featured: true,
      tags: ['TikTok', 'Regulation', 'Social Media', 'US Policy'], created_at: daysAgo(120),
    },
    {
      slug: 'macron-resign-2026',
      title: 'Will Emmanuel Macron resign as French President before 2027?',
      description: 'Macron faces intense domestic pressure with approval ratings below 25% and repeated legislative defeats. Resolves YES if he formally announces resignation before January 1, 2027.',
      resolution_criteria: 'Official announcement of Macron\'s resignation from the French Presidency before Jan 1, 2027.',
      category: 'politics', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.22,
      initial_liquidity: 1000, volume_total: 18600, volume_24h: 420,
      trade_count: 743, unique_traders: 112, is_featured: false,
      tags: ['France', 'EU', 'Macron', 'European Politics'], created_at: daysAgo(110),
    },
    {
      slug: 'fed-cut-march-2026',
      title: 'Will the Fed cut interest rates at the March 2026 FOMC meeting?',
      description: 'With inflation moderating toward 2% and the labor market softening, markets priced in a cut. Resolved based on the FOMC decision on March 19, 2026.',
      resolution_criteria: 'Federal Reserve cuts the federal funds rate target at the March 18–19, 2026 FOMC meeting.',
      category: 'politics', status: 'resolved', outcome: 'yes',
      closes_at: new Date('2026-03-19'), resolved_at: new Date('2026-03-19T18:00:00Z'),
      yes_price: 0.97, initial_liquidity: 3000, volume_total: 124500, volume_24h: 0,
      trade_count: 4821, unique_traders: 567, is_featured: false,
      tags: ['Federal Reserve', 'Interest Rates', 'Monetary Policy'], created_at: daysAgo(155),
    },
    {
      slug: 'uk-snap-election-2026',
      title: 'Will the UK hold a snap general election before end of 2026?',
      description: 'The Labour government under Keir Starmer faces challenges from both left and right. A snap election requires a no-confidence vote or voluntary dissolution. Resolves YES if a UK general election takes place before Dec 31, 2026.',
      resolution_criteria: 'A UK general election takes place before December 31, 2026.',
      category: 'politics', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.14,
      initial_liquidity: 800, volume_total: 12400, volume_24h: 280,
      trade_count: 521, unique_traders: 89, is_featured: false,
      tags: ['UK', 'Elections', 'Labour', 'Parliament'], created_at: daysAgo(100),
    },
    {
      slug: 'iran-nuclear-deal-2026',
      title: 'Will the US and Iran reach a new nuclear agreement in 2026?',
      description: 'Diplomatic backchannel talks have been reported between US and Iranian officials. Resolves YES if a formal agreement or framework on nuclear limitations is publicly signed by both parties before Dec 31, 2026.',
      resolution_criteria: 'A formal US-Iran nuclear agreement or interim framework is publicly signed by both parties before Dec 31, 2026.',
      category: 'politics', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.28,
      initial_liquidity: 800, volume_total: 9800, volume_24h: 310,
      trade_count: 389, unique_traders: 76, is_featured: false,
      tags: ['Iran', 'Nuclear', 'Diplomacy', 'US Foreign Policy'], created_at: daysAgo(85),
    },

    // ── TECHNOLOGY ──
    {
      slug: 'gpt5-launch-2026',
      title: 'Will OpenAI release GPT-5 to the public in 2026?',
      description: 'OpenAI has been hinting at GPT-5 development for over a year. Multiple leaks and job postings suggest significant architectural changes. Resolves YES if OpenAI releases a model explicitly named "GPT-5" to the general public (not just limited preview) before December 31, 2026.',
      resolution_criteria: 'OpenAI officially releases GPT-5 for general public access before Dec 31, 2026.',
      category: 'technology', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.74,
      initial_liquidity: 5000, volume_total: 215000, volume_24h: 4800,
      trade_count: 8923, unique_traders: 1204, is_featured: true,
      tags: ['OpenAI', 'GPT-5', 'AI', 'LLM'], created_at: daysAgo(165),
    },
    {
      slug: 'apple-ar-glasses-2026',
      title: 'Will Apple release consumer AR glasses in 2026?',
      description: 'Following Vision Pro, Apple is reportedly working on a lighter AR glasses form factor. Multiple supply chain reports suggest 2026 or 2027. Resolves YES if Apple ships a distinct AR glasses product (not Vision Pro) in 2026.',
      resolution_criteria: 'Apple ships a product marketed as AR glasses (distinct from Vision Pro) to consumers before Dec 31, 2026.',
      category: 'technology', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.31,
      initial_liquidity: 2000, volume_total: 67400, volume_24h: 1340,
      trade_count: 2654, unique_traders: 412, is_featured: true,
      tags: ['Apple', 'AR', 'Augmented Reality', 'Hardware'], created_at: daysAgo(140),
    },
    {
      slug: 'openai-ipo-2026',
      title: 'Will OpenAI complete an IPO before end of 2026?',
      description: 'OpenAI has been restructuring to allow profit distribution, last valued at $157B. Resolves YES if OpenAI shares begin trading on a US stock exchange before December 31, 2026.',
      resolution_criteria: 'OpenAI shares begin trading on NYSE or NASDAQ before December 31, 2026.',
      category: 'technology', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.27,
      initial_liquidity: 3000, volume_total: 89200, volume_24h: 2100,
      trade_count: 3421, unique_traders: 543, is_featured: true,
      tags: ['OpenAI', 'IPO', 'Startup', 'Finance'], created_at: daysAgo(130),
    },
    {
      slug: 'spacex-starship-orbit-2025',
      title: 'Did SpaceX Starship successfully complete an orbital mission in 2025?',
      description: 'Starship made significant progress through Flight 4 and beyond. Resolved based on whether Starship completed a full orbital mission in 2025.',
      resolution_criteria: 'SpaceX Starship completes at least one full orbit of Earth before December 31, 2025.',
      category: 'technology', status: 'resolved', outcome: 'yes',
      closes_at: new Date('2025-12-31'), resolved_at: new Date('2025-10-14T09:30:00Z'),
      yes_price: 0.98, initial_liquidity: 2000, volume_total: 87300, volume_24h: 0,
      trade_count: 3421, unique_traders: 487, is_featured: false,
      tags: ['SpaceX', 'Starship', 'Space', 'Elon Musk'], created_at: daysAgo(175),
    },
    {
      slug: 'musk-leaves-tesla-2026',
      title: 'Will Elon Musk step down as Tesla CEO before end of 2026?',
      description: 'Musk\'s attention is divided between Tesla, SpaceX, X, xAI, and his government role. Institutional investors have been vocal. Resolves YES if Musk formally vacates the Tesla CEO role before Dec 31, 2026.',
      resolution_criteria: 'Elon Musk officially steps down or is removed as Tesla CEO before December 31, 2026.',
      category: 'technology', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.23,
      initial_liquidity: 2500, volume_total: 54200, volume_24h: 1120,
      trade_count: 2134, unique_traders: 334, is_featured: false,
      tags: ['Tesla', 'Elon Musk', 'CEO', 'Corporate'], created_at: daysAgo(120),
    },
    {
      slug: 'gemini-surpass-gpt4-q3-2026',
      title: 'Will Google Gemini outperform GPT-4o on all major benchmarks by Q3 2026?',
      description: 'Google has been rapidly iterating on Gemini. Resolves YES if Gemini Ultra achieves higher scores than GPT-4o on MMLU, HumanEval, and MATH per 2+ independent evaluations before October 1, 2026.',
      resolution_criteria: 'Gemini Ultra outperforms GPT-4o on MMLU, HumanEval, and MATH per 2+ independent evaluations before Oct 1, 2026.',
      category: 'technology', status: 'active',
      closes_at: daysFromNow(128), yes_price: 0.61,
      initial_liquidity: 1500, volume_total: 41800, volume_24h: 980,
      trade_count: 1654, unique_traders: 267, is_featured: false,
      tags: ['Google', 'Gemini', 'AI', 'Benchmarks'], created_at: daysAgo(100),
    },

    // ── SPORTS ──
    {
      slug: 'real-madrid-ucl-2026',
      title: 'Will Real Madrid win the UEFA Champions League 2025–26?',
      description: 'Real Madrid, the record 15-time champions, are again among the favorites. They face strong competition from Manchester City, Inter Milan, and Bayern Munich. Resolves YES if Real Madrid wins the 2025–26 UCL final.',
      resolution_criteria: 'Real Madrid wins the UEFA Champions League 2025–26 final on June 3, 2026.',
      category: 'sports', status: 'active',
      closes_at: daysFromNow(8), yes_price: 0.38,
      initial_liquidity: 3000, volume_total: 142000, volume_24h: 8400,
      trade_count: 5621, unique_traders: 892, is_featured: true,
      tags: ['Real Madrid', 'Champions League', 'Football', 'UEFA'], created_at: daysAgo(165),
    },
    {
      slug: 'djokovic-french-open-2026',
      title: 'Will Novak Djokovic win the 2026 French Open?',
      description: 'Djokovic seeks to extend his Grand Slam record. At 38, questions remain about clay-court physicality. Alcaraz and Sinner are the primary threats. Resolves YES if Djokovic wins the men\'s singles title at Roland Garros 2026.',
      resolution_criteria: 'Novak Djokovic wins the Men\'s Singles title at Roland Garros 2026.',
      category: 'sports', status: 'active',
      closes_at: daysFromNow(11), yes_price: 0.29,
      initial_liquidity: 2000, volume_total: 78900, volume_24h: 5200,
      trade_count: 3124, unique_traders: 498, is_featured: true,
      tags: ['Djokovic', 'French Open', 'Tennis', 'Grand Slam'], created_at: daysAgo(130),
    },
    {
      slug: 'warriors-playoffs-2026',
      title: 'Did the Golden State Warriors make the 2026 NBA Playoffs?',
      description: 'The Warriors dynasty has shown decline with an aging core. Steph Curry remained elite but the supporting cast was inconsistent. Resolved after the NBA regular season.',
      resolution_criteria: 'Golden State Warriors finish top 8 or win play-in in the Western Conference for the 2025–26 NBA season.',
      category: 'sports', status: 'resolved', outcome: 'no',
      closes_at: new Date('2026-04-15'), resolved_at: new Date('2026-04-15T23:59:00Z'),
      yes_price: 0.04, initial_liquidity: 1500, volume_total: 54200, volume_24h: 0,
      trade_count: 2134, unique_traders: 312, is_featured: false,
      tags: ['Warriors', 'NBA', 'Basketball', 'Playoffs'], created_at: daysAgo(165),
    },
    {
      slug: 'verstappen-f1-2026',
      title: 'Will Max Verstappen win the 2026 F1 World Championship?',
      description: 'Verstappen has dominated F1 for three consecutive seasons. The 2026 regulation change creates genuine uncertainty — Ferrari and Mercedes should be more competitive. Resolves YES if Verstappen wins the Drivers\' Championship.',
      resolution_criteria: 'Max Verstappen is crowned FIA Formula 1 World Drivers\' Champion for the 2026 season.',
      category: 'sports', status: 'active',
      closes_at: daysFromNow(175), yes_price: 0.44,
      initial_liquidity: 2500, volume_total: 98400, volume_24h: 2100,
      trade_count: 3876, unique_traders: 612, is_featured: true,
      tags: ['F1', 'Verstappen', 'Formula 1', 'Racing'], created_at: daysAgo(145),
    },
    {
      slug: 'alcaraz-wimbledon-2026',
      title: 'Will Carlos Alcaraz defend his Wimbledon title in 2026?',
      description: 'Alcaraz is the reigning Wimbledon champion and widely considered the future of men\'s tennis. At 23, he enters as top favorite. Resolves YES if Alcaraz wins the 2026 Wimbledon men\'s singles.',
      resolution_criteria: 'Carlos Alcaraz wins the Men\'s Singles title at Wimbledon 2026.',
      category: 'sports', status: 'active',
      closes_at: daysFromNow(51), yes_price: 0.42,
      initial_liquidity: 2000, volume_total: 61200, volume_24h: 1800,
      trade_count: 2412, unique_traders: 387, is_featured: false,
      tags: ['Alcaraz', 'Wimbledon', 'Tennis', 'Grand Slam'], created_at: daysAgo(90),
    },

    // ── FINANCE ──
    {
      slug: 'sp500-6500-2026',
      title: 'Will the S&P 500 reach 6,500 before end of 2026?',
      description: 'The S&P 500 has been on a strong bull run driven by AI enthusiasm and resilient earnings. The index closed around 5,800 in late 2025. Resolves YES if the S&P 500 closes above 6,500 on any trading day before Dec 31, 2026.',
      resolution_criteria: 'S&P 500 index closes at or above 6,500 on any trading day before December 31, 2026.',
      category: 'finance', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.67,
      initial_liquidity: 5000, volume_total: 198000, volume_24h: 4200,
      trade_count: 7823, unique_traders: 987, is_featured: true,
      tags: ['S&P 500', 'Stocks', 'Equities', 'Bull Market'], created_at: daysAgo(155),
    },
    {
      slug: 'nvidia-1t-market-cap-2026',
      title: 'Will Nvidia maintain a $1T+ market cap through all of 2026?',
      description: 'Nvidia has become one of the world\'s most valuable companies on AI chip demand. Resolves YES if Nvidia\'s market cap never closes below $1 trillion on any trading day for the remainder of 2026.',
      resolution_criteria: 'Nvidia market cap never closes below $1T on any US trading day for the remainder of calendar year 2026.',
      category: 'finance', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.71,
      initial_liquidity: 4000, volume_total: 167000, volume_24h: 3400,
      trade_count: 6543, unique_traders: 834, is_featured: true,
      tags: ['Nvidia', 'AI', 'Stocks', 'Market Cap'], created_at: daysAgo(145),
    },
    {
      slug: 'fed-3-cuts-2026',
      title: 'Will the Federal Reserve cut rates 3 or more times in 2026?',
      description: 'After the March 2026 cut, markets debate how many more will follow. Sticky inflation and a tight labor market complicate the picture. Resolves YES if the Fed cuts at 3+ separate FOMC meetings in 2026 (including cuts already made).',
      resolution_criteria: 'Federal Reserve cuts the federal funds rate at 3 or more FOMC meetings during calendar year 2026.',
      category: 'finance', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.38,
      initial_liquidity: 3000, volume_total: 112000, volume_24h: 2800,
      trade_count: 4312, unique_traders: 612, is_featured: false,
      tags: ['Federal Reserve', 'Interest Rates', 'Monetary Policy', 'Economy'], created_at: daysAgo(120),
    },
    {
      slug: 'us-recession-2026',
      title: 'Will the US economy enter recession in 2026?',
      description: 'Despite Fed tightening, the US economy has remained resilient. Leading indicators show mixed signals. Resolves YES if NBER officially declares a 2026 recession, or if two consecutive quarters of negative GDP are recorded.',
      resolution_criteria: 'NBER declares a US recession beginning in 2026, or US GDP shows two consecutive negative quarters in 2026.',
      category: 'finance', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.24,
      initial_liquidity: 3000, volume_total: 87600, volume_24h: 1900,
      trade_count: 3421, unique_traders: 498, is_featured: false,
      tags: ['Recession', 'US Economy', 'GDP', 'NBER'], created_at: daysAgo(140),
    },
    {
      slug: 'eur-usd-parity-2026',
      title: 'Will EUR/USD reach parity (1.00) in 2026?',
      description: 'The Euro faces pressure from European economic weakness and diverging monetary policy. EUR/USD currently trades around 1.07. Resolves YES if EUR/USD trades at or below 1.00 on any day before December 31, 2026.',
      resolution_criteria: 'EUR/USD spot rate reaches 1.0000 or below on any trading day per Bloomberg/Reuters before Dec 31, 2026.',
      category: 'finance', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.19,
      initial_liquidity: 2000, volume_total: 43200, volume_24h: 980,
      trade_count: 1765, unique_traders: 278, is_featured: false,
      tags: ['EUR/USD', 'Forex', 'Euro', 'Dollar'], created_at: daysAgo(100),
    },

    // ── SCIENCE ──
    {
      slug: 'agi-benchmark-2026',
      title: 'Will any AI model pass widely-accepted AGI benchmarks in 2026?',
      description: 'As AI capabilities advance rapidly, AGI-level performance is hotly debated. Resolves YES if any AI system exceeds human performance across ARC-AGI, GPQA, and FrontierMath simultaneously.',
      resolution_criteria: 'Any single AI system exceeds human performance on ARC-AGI (>85%), GPQA (>65%), and FrontierMath (>20%) per published evaluation.',
      category: 'science', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.31,
      initial_liquidity: 3000, volume_total: 98400, volume_24h: 2100,
      trade_count: 3876, unique_traders: 567, is_featured: true,
      tags: ['AGI', 'AI', 'Benchmarks', 'Machine Learning'], created_at: daysAgo(130),
    },
    {
      slug: 'nasa-artemis-3-2027',
      title: 'Will NASA\'s Artemis III mission land on the Moon before 2028?',
      description: 'Artemis III would be the first crewed lunar landing since Apollo 17 in 1972. The mission has faced multiple delays. Resolves YES if NASA Artemis III successfully lands astronauts on the Moon before January 1, 2028.',
      resolution_criteria: 'NASA Artemis III mission successfully lands crew on the lunar surface before January 1, 2028.',
      category: 'science', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.34,
      initial_liquidity: 1500, volume_total: 34500, volume_24h: 780,
      trade_count: 1345, unique_traders: 198, is_featured: false,
      tags: ['NASA', 'Artemis', 'Moon', 'Space'], created_at: daysAgo(120),
    },
    {
      slug: 'antibiotic-resistance-2026',
      title: 'Will a new antibiotic effective against drug-resistant bacteria get FDA approval in 2026?',
      description: 'AMR is a global crisis. Several novel compounds are in late-stage trials. Resolves YES if the FDA approves at least one new antibiotic for drug-resistant (ESKAPE) pathogens before Dec 31, 2026.',
      resolution_criteria: 'FDA grants full approval to a novel antibiotic effective against at least one ESKAPE pathogen before Dec 31, 2026.',
      category: 'science', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.26,
      initial_liquidity: 800, volume_total: 14200, volume_24h: 320,
      trade_count: 567, unique_traders: 89, is_featured: false,
      tags: ['Antibiotics', 'FDA', 'Medicine', 'AMR'], created_at: daysAgo(90),
    },
    {
      slug: 'fusion-q1-2027',
      title: 'Will any fusion reactor achieve sustained net energy gain (Q>1) by end of 2027?',
      description: 'The NIF demonstrated Q>1 in 2022 but sustained commercial fusion remains elusive. CFS, TAE, and others are racing ahead. Resolves YES if any fusion system achieves Q>1 for >1 hour before January 1, 2028.',
      resolution_criteria: 'Any fusion energy system achieves Q>1 for >1 hour sustained, verified by independent scientific review, before Jan 1, 2028.',
      category: 'science', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.12,
      initial_liquidity: 1000, volume_total: 18900, volume_24h: 420,
      trade_count: 765, unique_traders: 123, is_featured: false,
      tags: ['Fusion Energy', 'Clean Energy', 'Physics', 'Technology'], created_at: daysAgo(110),
    },

    // ── ENTERTAINMENT ──
    {
      slug: 'avengers-doomsday-1b',
      title: 'Will Avengers: Doomsday gross $1 billion worldwide at the box office?',
      description: 'Avengers: Doomsday brings together the multiverse storylines. Marvel has been rebuilding audience trust after a mixed Phase 5. Resolves YES if worldwide box office gross reaches $1,000,000,000.',
      resolution_criteria: 'Avengers: Doomsday reaches $1B cumulative worldwide gross as reported by Box Office Mojo.',
      category: 'entertainment', status: 'active',
      closes_at: daysFromNow(100), yes_price: 0.76,
      initial_liquidity: 3000, volume_total: 112000, volume_24h: 5400,
      trade_count: 4321, unique_traders: 734, is_featured: true,
      tags: ['Marvel', 'Avengers', 'Box Office', 'Movies'], created_at: daysAgo(90),
    },
    {
      slug: 'gta-vi-2026',
      title: 'Will GTA VI release in 2026?',
      description: 'Rockstar delayed GTA VI from Fall 2025 to 2026. The gaming community is watching every update closely. Resolves YES if GTA VI is released on any platform before December 31, 2026.',
      resolution_criteria: 'GTA VI is officially released for purchase and play on any gaming platform before December 31, 2026.',
      category: 'entertainment', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.82,
      initial_liquidity: 4000, volume_total: 178000, volume_24h: 3200,
      trade_count: 6983, unique_traders: 1123, is_featured: true,
      tags: ['GTA VI', 'Rockstar', 'Gaming', 'Video Games'], created_at: daysAgo(150),
    },
    {
      slug: 'last-of-us-s3',
      title: 'Will HBO renew The Last of Us for Season 3 before end of 2026?',
      description: 'The Last of Us Season 2 premiered in 2025 to strong ratings. HBO has been very supportive of the franchise. Resolves YES if HBO/Max officially announces a Season 3 renewal before December 31, 2026.',
      resolution_criteria: 'HBO/Max publicly announces renewal of The Last of Us for a third season before December 31, 2026.',
      category: 'entertainment', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.88,
      initial_liquidity: 1500, volume_total: 54300, volume_24h: 1200,
      trade_count: 2134, unique_traders: 378, is_featured: false,
      tags: ['HBO', 'The Last of Us', 'TV Shows', 'Streaming'], created_at: daysAgo(100),
    },
    {
      slug: 'taylor-swift-album-2026',
      title: 'Will Taylor Swift release a new studio album in 2026?',
      description: 'Following the re-recording project and The Eras Tour, fans have been speculating about new original material. Swift dropped hints in late 2025 interviews. Resolves YES if she releases a new studio album of original material before Dec 31, 2026.',
      resolution_criteria: 'Taylor Swift releases a studio album of original (non-re-recorded) material before December 31, 2026.',
      category: 'entertainment', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.58,
      initial_liquidity: 2000, volume_total: 87600, volume_24h: 2100,
      trade_count: 3421, unique_traders: 612, is_featured: true,
      tags: ['Taylor Swift', 'Music', 'Album', 'Pop'], created_at: daysAgo(120),
    },

    // ── CRYPTO ──
    {
      slug: 'bitcoin-100k-2025',
      title: 'Will Bitcoin price exceed $100,000 in 2025?',
      description: 'Bitcoin has been on a strong bull run following the halving and ETF approvals. $100k has been a long-standing target for Bitcoin bulls. Resolved based on Bitcoin price in 2025.',
      resolution_criteria: 'Bitcoin (BTC) price exceeds $100,000 USD on any major exchange before December 31, 2025.',
      category: 'crypto', status: 'resolved', outcome: 'yes',
      closes_at: new Date('2025-12-31'), resolved_at: new Date('2025-12-05T14:00:00Z'),
      yes_price: 0.99, initial_liquidity: 10000, volume_total: 487000, volume_24h: 0,
      trade_count: 18234, unique_traders: 2341, is_featured: false,
      tags: ['Bitcoin', 'BTC', 'Crypto', 'Price'], created_at: daysAgo(175),
    },
    {
      slug: 'bitcoin-200k-2026',
      title: 'Will Bitcoin reach $200,000 in 2026?',
      description: 'After breaching $100k in late 2025, many analysts target $200k as the next major milestone. Institutional demand, ETF inflows, and post-halving supply constraints support the bull case. Resolves YES if BTC trades at or above $200k on any major exchange before Dec 31, 2026.',
      resolution_criteria: 'Bitcoin (BTC) price reaches $200,000 or above on Binance, Coinbase, or Kraken before December 31, 2026.',
      category: 'crypto', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.46,
      initial_liquidity: 8000, volume_total: 342000, volume_24h: 8900,
      trade_count: 13421, unique_traders: 1876, is_featured: true,
      tags: ['Bitcoin', 'BTC', 'Crypto', 'Price'], created_at: daysAgo(165),
    },
    {
      slug: 'eth-etf-10b-2026',
      title: 'Will Ethereum spot ETFs see $10B+ in net inflows in 2026?',
      description: 'Following Bitcoin ETF success, Ethereum spot ETFs launched in 2024. Institutional interest continues to grow. Resolves YES if cumulative net inflows to US Ethereum spot ETFs exceed $10 billion in calendar year 2026.',
      resolution_criteria: 'Total net inflows to US-listed Ethereum spot ETFs in 2026 exceed $10B per Bloomberg ETF data.',
      category: 'crypto', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.53,
      initial_liquidity: 5000, volume_total: 198000, volume_24h: 4100,
      trade_count: 7654, unique_traders: 1123, is_featured: false,
      tags: ['Ethereum', 'ETH', 'ETF', 'Institutional'], created_at: daysAgo(140),
    },
    {
      slug: 'country-btc-legal-tender-2026',
      title: 'Will any country (besides El Salvador) adopt Bitcoin as legal tender in 2026?',
      description: 'El Salvador pioneered Bitcoin legal tender in 2021. Several developing nations have been exploring similar policies. Resolves YES if any sovereign nation formally adopts Bitcoin as legal tender before December 31, 2026.',
      resolution_criteria: 'A sovereign nation (not El Salvador) makes Bitcoin legal tender before December 31, 2026.',
      category: 'crypto', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.18,
      initial_liquidity: 2000, volume_total: 34500, volume_24h: 780,
      trade_count: 1345, unique_traders: 234, is_featured: false,
      tags: ['Bitcoin', 'Legal Tender', 'Adoption', 'Government'], created_at: daysAgo(120),
    },
    {
      slug: 'sol-flip-eth-2026',
      title: 'Will Solana flip Ethereum by market cap in 2026?',
      description: 'Solana has gained traction as a high-performance alternative to Ethereum, with strong DeFi and NFT adoption. Resolves YES if SOL market cap exceeds ETH on CoinMarketCap for any full 24-hour period before Dec 31, 2026.',
      resolution_criteria: 'Solana (SOL) market cap exceeds Ethereum (ETH) market cap on CoinMarketCap for a full 24-hour period before December 31, 2026.',
      category: 'crypto', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.17,
      initial_liquidity: 3000, volume_total: 67800, volume_24h: 1600,
      trade_count: 2654, unique_traders: 412, is_featured: false,
      tags: ['Solana', 'SOL', 'Ethereum', 'Flippening'], created_at: daysAgo(130),
    },

    // ── WORLD EVENTS ──
    {
      slug: 'ukraine-war-end-2026',
      title: 'Will the Russia-Ukraine war formally end (ceasefire or peace treaty) in 2026?',
      description: 'The conflict has entered its fourth year. US-led peace negotiations have been ongoing with mixed signals. Resolves YES if a formal ceasefire or peace treaty is publicly signed by both Russia and Ukraine before December 31, 2026.',
      resolution_criteria: 'A formal ceasefire or peace treaty is publicly signed by authorized representatives of Russia and Ukraine before December 31, 2026.',
      category: 'world-events', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.34,
      initial_liquidity: 5000, volume_total: 187000, volume_24h: 4200,
      trade_count: 7234, unique_traders: 1023, is_featured: true,
      tags: ['Russia', 'Ukraine', 'War', 'Geopolitics', 'Peace'], created_at: daysAgo(165),
    },
    {
      slug: 'co2-peak-2027',
      title: 'Will global CO2 emissions peak before 2028?',
      description: 'The IEA and climate scientists project global emissions could peak this decade — critical for limiting 1.5°C warming. Resolves YES if IEA or IPCC data shows 2026 or 2027 emissions are lower than 2025 levels.',
      resolution_criteria: 'IEA or IPCC data shows global CO2 emissions in 2026 or 2027 are lower than 2025, per official annual reports before Jan 1, 2028.',
      category: 'world-events', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.36,
      initial_liquidity: 2000, volume_total: 43200, volume_24h: 980,
      trade_count: 1765, unique_traders: 278, is_featured: false,
      tags: ['Climate Change', 'CO2', 'Emissions', 'Environment'], created_at: daysAgo(130),
    },
    {
      slug: 'g7-constitutional-crisis-2026',
      title: 'Will any G7 country face a constitutional crisis in 2026?',
      description: 'G7 nations have been experiencing significant political turbulence. Resolves YES if any G7 nation\'s head of state, parliament, or supreme court officially acknowledges a constitutional crisis before December 31, 2026.',
      resolution_criteria: 'A G7 nation\'s head of state, parliament, or supreme/constitutional court officially declares or acknowledges a constitutional crisis before December 31, 2026.',
      category: 'world-events', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.29,
      initial_liquidity: 1500, volume_total: 32400, volume_24h: 720,
      trade_count: 1287, unique_traders: 198, is_featured: false,
      tags: ['G7', 'Politics', 'Constitutional Crisis', 'Democracy'], created_at: daysAgo(90),
    },
    {
      slug: 'who-pandemic-2026',
      title: 'Will WHO declare a new pandemic (not COVID) before end of 2026?',
      description: 'Several outbreaks are monitored including H5N1 avian flu and mpox variants. Resolves YES if WHO declares a PHEIC for a new, non-COVID-19 pathogen before December 31, 2026.',
      resolution_criteria: 'WHO declares a Public Health Emergency of International Concern (PHEIC) for a new, non-COVID-19 pathogen before December 31, 2026.',
      category: 'world-events', status: 'active',
      closes_at: daysFromNow(220), yes_price: 0.31,
      initial_liquidity: 2000, volume_total: 56700, volume_24h: 1200,
      trade_count: 2134, unique_traders: 334, is_featured: false,
      tags: ['WHO', 'Pandemic', 'H5N1', 'Public Health'], created_at: daysAgo(100),
    },
  ];

  const marketIds: Record<string, string> = {};
  const adminId = userMap['admin'];

  for (const m of marketsData) {
    const existing = await db('markets').where('title', m.title).first();
    if (existing) { marketIds[m.slug] = existing.id; continue; }

    const b = new Decimal(m.initial_liquidity).div(Math.LN2);
    const bVal = b.toNumber();
    const { yes: yShares, no: nShares } = computeShares(bVal, m.yes_price);

    const [created] = await db('markets').insert({
      creator_id: adminId,
      category_id: catMap[m.category],
      title: m.title,
      description: m.description,
      resolution_criteria: m.resolution_criteria,
      status: m.status,
      outcome: m.outcome || null,
      initial_liquidity: m.initial_liquidity.toFixed(8),
      liquidity_b: b.toFixed(8),
      yes_shares: yShares.toFixed(8),
      no_shares: nShares.toFixed(8),
      current_yes_price: m.yes_price.toFixed(8),
      current_no_price: (1 - m.yes_price).toFixed(8),
      volume_24h: m.volume_24h.toFixed(8),
      volume_total: m.volume_total.toFixed(8),
      trade_count: m.trade_count,
      unique_traders: m.unique_traders,
      closes_at: m.closes_at,
      resolved_at: m.resolved_at || null,
      resolved_by: m.resolved_at ? adminId : null,
      resolution_note: m.outcome === 'yes' ? 'Market resolved YES per resolution criteria.' : m.outcome === 'no' ? 'Market resolved NO per resolution criteria.' : null,
      is_featured: m.is_featured,
      tags: JSON.stringify(m.tags),
      metadata: '{}',
      liquidity_total: m.initial_liquidity.toFixed(8),
      created_at: m.created_at,
      updated_at: m.created_at,
    }).returning('id');
    marketIds[m.slug] = created.id;

    await db('liquidity_events').insert({
      market_id: created.id, user_id: adminId, type: 'initial',
      amount: m.initial_liquidity.toFixed(8),
      total_liquidity_before: '0.00000000',
      total_liquidity_after: m.initial_liquidity.toFixed(8),
      created_at: m.created_at,
    });

    await db('activity_feed').insert({
      user_id: adminId, market_id: created.id, type: 'market_created',
      data: JSON.stringify({ title: m.title, initial_liquidity: m.initial_liquidity }),
      is_public: true, created_at: m.created_at,
    });
  }
  logger.info('Markets seeded');

  // ─── PRICE HISTORY & DAILY CANDLES ────────────────────────────────
  for (const m of marketsData) {
    const marketId = marketIds[m.slug];
    if (!marketId) continue;
    const existing = await db('price_history').where('market_id', marketId).count('* as cnt').first();
    if (parseInt((existing?.cnt as string) || '0') > 0) continue;

    const daysOld = Math.floor((SEED_DATE.getTime() - m.created_at.getTime()) / 86400000);
    const prices = generatePricePath(0.5, m.yes_price, daysOld, 0.04);

    const histRows: any[] = [];
    const candleRows: any[] = [];

    for (let i = 0; i < prices.length; i++) {
      const date = daysAgo(daysOld - i);
      const yp = prices[i];
      const vol = rnd(50, 2000);
      const tc = rndInt(3, 60);
      const prevYp = i > 0 ? prices[i - 1] : yp;
      const hi = Math.min(0.98, Math.max(yp, prevYp) + rnd(0, 0.025));
      const lo = Math.max(0.02, Math.min(yp, prevYp) - rnd(0, 0.025));

      histRows.push({
        market_id: marketId,
        yes_price: yp.toFixed(8),
        no_price: (1 - yp).toFixed(8),
        volume: vol.toFixed(8),
        trade_count: tc,
        recorded_at: date,
      });
      candleRows.push({
        market_id: marketId, resolution: '1d',
        open_time: date,
        close_time: new Date(date.getTime() + 86399999),
        open: prevYp.toFixed(8),
        high: hi.toFixed(8),
        low: lo.toFixed(8),
        close: yp.toFixed(8),
        volume: vol.toFixed(8),
        trade_count: tc,
      });
    }

    if (histRows.length > 0) await db('price_history').insert(histRows);
    if (candleRows.length > 0) {
      await db('price_candles').insert(candleRows).onConflict(['market_id', 'resolution', 'open_time']).ignore();
    }
  }
  logger.info('Price history seeded');

  // ─── TRADES ───────────────────────────────────────────────────────
  const featuredSlugs = [
    'gpt5-launch-2026', 'bitcoin-200k-2026', 'bitcoin-100k-2025',
    'sp500-6500-2026', 'real-madrid-ucl-2026', 'ukraine-war-end-2026',
    'dem-midterms-2026', 'openai-ipo-2026', 'fed-cut-march-2026',
    'avengers-doomsday-1b', 'gta-vi-2026', 'nvidia-1t-market-cap-2026',
    'verstappen-f1-2026', 'eth-etf-10b-2026', 'fed-3-cuts-2026',
  ];
  const traders = ['marcus_t', 'sarah_k', 'devraj_p', 'zoe_chen', 'liam_w', 'natasha_r', 'kai_y', 'brooklyn_s', 'felix_m', 'igor_v', 'priya_n', 'omar_h'];
  const exchangeId = userMap['exchange'];

  for (const slug of featuredSlugs) {
    const marketId = marketIds[slug];
    if (!marketId) continue;
    const ec = await db('trades').where('market_id', marketId).count('* as cnt').first();
    if (parseInt((ec?.cnt as string) || '0') > 0) continue;

    const m = marketsData.find(x => x.slug === slug)!;
    const daysOld = Math.floor((SEED_DATE.getTime() - m.created_at.getTime()) / 86400000);
    const tradeCount = Math.min(150, m.trade_count);
    const prices = generatePricePath(0.5, m.yes_price, tradeCount, 0.05);

    const tradeRows: any[] = [];
    const actRows: any[] = [];

    for (let i = 0; i < tradeCount; i++) {
      const buyerUsername = traders[i % traders.length];
      const buyerId = userMap[buyerUsername];
      const daysBack = rndInt(0, daysOld);
      const price = prices[i];
      const qty = rnd(5, 150);
      const totalValue = price * qty;
      const fee = totalValue * 0.02;
      const prevPrice = i > 0 ? prices[i - 1] : 0.5;

      const trade: any = {
        market_id: marketId,
        buyer_id: buyerId,
        seller_id: exchangeId,
        side: price >= 0.5 ? 'yes' : 'no',
        trade_type: 'order_book',
        price: price.toFixed(8),
        quantity: qty.toFixed(8),
        total_value: totalValue.toFixed(8),
        fee: fee.toFixed(8),
        yes_price_before: prevPrice.toFixed(8),
        yes_price_after: price.toFixed(8),
        price_impact: Math.abs(price - prevPrice).toFixed(8),
        executed_at: daysAgo(daysBack),
        metadata: '{}',
      };
      tradeRows.push(trade);

      if (i < 30) {
        actRows.push({
          user_id: buyerId, market_id: marketId, type: 'trade',
          data: JSON.stringify({ side: trade.side, price: trade.price, quantity: trade.quantity }),
          is_public: true, created_at: trade.executed_at,
        });
      }
    }

    if (tradeRows.length > 0) await db('trades').insert(tradeRows);
    if (actRows.length > 0) await db('activity_feed').insert(actRows);
  }
  logger.info('Trades seeded');

  // ─── POSITIONS ─────────────────────────────────────────────────────
  const positionDefs: [string, string, string, number, number, number, number][] = [
    ['marcus_t',   'dem-midterms-2026',        'yes', 450,  0.38, 171.0,   240],
    ['marcus_t',   'sp500-6500-2026',           'yes', 680,  0.61, 414.8,   120],
    ['marcus_t',   'fed-cut-march-2026',        'yes', 1200, 0.82, 984.0,   180],
    ['marcus_t',   'fed-3-cuts-2026',           'no',  340,  0.64, 217.6,    45],
    ['sarah_k',    'gpt5-launch-2026',          'yes', 320,  0.65, 208.0,    89],
    ['sarah_k',    'ukraine-war-end-2026',      'no',  540,  0.68, 367.2,    45],
    ['sarah_k',    'bitcoin-200k-2026',         'yes', 210,  0.39,  81.9,     0],
    ['sarah_k',    'agi-benchmark-2026',        'no',  280,  0.71, 198.8,    35],
    ['devraj_p',   'gpt5-launch-2026',          'yes', 890,  0.58, 516.2,   320],
    ['devraj_p',   'openai-ipo-2026',           'yes', 430,  0.22,  94.6,     0],
    ['devraj_p',   'spacex-starship-orbit-2025','yes', 760,  0.55, 418.0,   342],
    ['devraj_p',   'gemini-surpass-gpt4-q3-2026','yes',310, 0.52, 161.2,     0],
    ['zoe_chen',   'bitcoin-100k-2025',         'yes', 2100, 0.61, 1281.0, 1890],
    ['zoe_chen',   'bitcoin-200k-2026',         'yes', 1540, 0.37,  569.8,    0],
    ['zoe_chen',   'eth-etf-10b-2026',          'yes', 680,  0.45,  306.0,   55],
    ['zoe_chen',   'sol-flip-eth-2026',         'yes', 420,  0.14,   58.8,    0],
    ['liam_w',     'real-madrid-ucl-2026',      'yes', 320,  0.31,   99.2,    0],
    ['liam_w',     'djokovic-french-open-2026', 'yes', 240,  0.24,   57.6,    0],
    ['liam_w',     'warriors-playoffs-2026',    'yes', 180,  0.67,  120.6,  -60.6],
    ['liam_w',     'alcaraz-wimbledon-2026',    'yes', 280,  0.38,  106.4,    0],
    ['natasha_r',  'ukraine-war-end-2026',      'yes', 870,  0.28,  243.6,    0],
    ['natasha_r',  'iran-nuclear-deal-2026',    'yes', 320,  0.24,   76.8,    0],
    ['natasha_r',  'uk-snap-election-2026',     'no',  450,  0.87,  391.5,    0],
    ['natasha_r',  'g7-constitutional-crisis-2026','yes',290,0.26,  75.4,     0],
    ['kai_y',      'bitcoin-100k-2025',         'yes', 3400, 0.45, 1530.0, 3230],
    ['kai_y',      'bitcoin-200k-2026',         'yes', 2800, 0.32,  896.0,    0],
    ['kai_y',      'sol-flip-eth-2026',         'yes', 560,  0.14,   78.4,    0],
    ['kai_y',      'eth-etf-10b-2026',          'yes', 1100, 0.41,  451.0,    0],
    ['kai_y',      'country-btc-legal-tender-2026','yes',340,0.15,  51.0,     0],
    ['brooklyn_s', 'avengers-doomsday-1b',      'yes', 430,  0.68,  292.4,    0],
    ['brooklyn_s', 'gta-vi-2026',               'yes', 560,  0.74,  414.4,    0],
    ['brooklyn_s', 'last-of-us-s3',             'yes', 280,  0.81,  226.8,    0],
    ['brooklyn_s', 'taylor-swift-album-2026',   'yes', 340,  0.51,  173.4,    0],
    ['felix_m',    'macron-resign-2026',         'yes', 340,  0.18,   61.2,    0],
    ['felix_m',    'eur-usd-parity-2026',        'yes', 520,  0.16,   83.2,    0],
    ['felix_m',    'fed-3-cuts-2026',            'no',  480,  0.64,  307.2,    0],
    ['felix_m',    'uk-snap-election-2026',      'no',  380,  0.87,  330.6,    0],
    ['igor_v',     'ukraine-war-end-2026',       'yes', 1240, 0.25,  310.0,    0],
    ['igor_v',     'g7-constitutional-crisis-2026','yes',380,0.26,   98.8,    0],
    ['igor_v',     'who-pandemic-2026',          'yes', 290,  0.28,   81.2,    0],
    ['igor_v',     'iran-nuclear-deal-2026',     'no',  420,  0.74,  310.8,    0],
    ['priya_n',    'co2-peak-2027',              'yes', 460,  0.33,  151.8,    0],
    ['priya_n',    'fusion-q1-2027',             'yes', 320,  0.10,   32.0,    0],
    ['priya_n',    'antibiotic-resistance-2026', 'yes', 240,  0.23,   55.2,    0],
    ['priya_n',    'nasa-artemis-3-2027',        'yes', 310,  0.30,   93.0,    0],
    ['omar_h',     'sp500-6500-2026',            'yes', 1200, 0.55,  660.0,   120],
    ['omar_h',     'nvidia-1t-market-cap-2026',  'yes', 980,  0.64,  627.2,    85],
    ['omar_h',     'us-recession-2026',          'no',  760,  0.77,  585.2,     0],
    ['omar_h',     'fed-3-cuts-2026',            'no',  540,  0.62,  334.8,    45],
    ['omar_h',     'bitcoin-200k-2026',          'yes', 420,  0.40,  168.0,     0],
  ];

  for (const [username, marketSlug, side, qty, avgPrice, totalInvested, realizedPnl] of positionDefs) {
    const userId = userMap[username];
    const marketId = marketIds[marketSlug];
    if (!userId || !marketId) continue;
    const ex = await db('positions').where({ user_id: userId, market_id: marketId, side }).first();
    if (ex) continue;

    const m = marketsData.find(x => x.slug === marketSlug)!;
    const currentPrice = side === 'yes' ? m.yes_price : 1 - m.yes_price;
    const unrealizedPnl = (currentPrice - avgPrice) * qty;

    await db('positions').insert({
      user_id: userId, market_id: marketId, side,
      quantity: qty.toFixed(8), reserved_quantity: '0.00000000',
      average_price: avgPrice.toFixed(8),
      total_invested: totalInvested.toFixed(8),
      realized_pnl: realizedPnl.toFixed(8),
      unrealized_pnl: unrealizedPnl.toFixed(8),
      trade_count: rndInt(3, 25),
      last_trade_at: daysAgo(rndInt(1, 30)),
      version: 0,
      created_at: daysAgo(rndInt(30, 150)),
      updated_at: daysAgo(rndInt(0, 10)),
    });
  }
  logger.info('Positions seeded');

  // ─── OPEN LIMIT ORDERS ────────────────────────────────────────────
  const openOrderDefs: [string, string, string, string, number, number][] = [
    ['marcus_t',   'dem-midterms-2026',       'yes', 'buy',  0.35, 200],
    ['marcus_t',   'sp500-6500-2026',          'yes', 'buy',  0.60, 150],
    ['marcus_t',   'us-recession-2026',        'yes', 'buy',  0.20, 300],
    ['sarah_k',    'gpt5-launch-2026',         'no',  'buy',  0.28, 100],
    ['sarah_k',    'bitcoin-200k-2026',        'yes', 'buy',  0.43, 250],
    ['devraj_p',   'openai-ipo-2026',          'yes', 'buy',  0.25, 300],
    ['devraj_p',   'apple-ar-glasses-2026',    'yes', 'buy',  0.28, 200],
    ['zoe_chen',   'bitcoin-200k-2026',        'yes', 'buy',  0.42, 500],
    ['zoe_chen',   'eth-etf-10b-2026',         'yes', 'buy',  0.50, 400],
    ['kai_y',      'bitcoin-200k-2026',        'yes', 'buy',  0.40, 800],
    ['kai_y',      'sol-flip-eth-2026',        'yes', 'buy',  0.14, 600],
    ['liam_w',     'real-madrid-ucl-2026',     'yes', 'buy',  0.35, 100],
    ['liam_w',     'verstappen-f1-2026',       'yes', 'buy',  0.42, 150],
    ['natasha_r',  'ukraine-war-end-2026',     'yes', 'buy',  0.30, 300],
    ['natasha_r',  'iran-nuclear-deal-2026',   'yes', 'buy',  0.25, 200],
    ['omar_h',     'nvidia-1t-market-cap-2026','yes', 'buy',  0.68, 250],
    ['omar_h',     'sp500-6500-2026',          'yes', 'buy',  0.63, 400],
    ['felix_m',    'eur-usd-parity-2026',      'yes', 'buy',  0.17, 200],
    ['felix_m',    'macron-resign-2026',       'yes', 'buy',  0.19, 150],
    ['priya_n',    'co2-peak-2027',            'yes', 'buy',  0.30, 180],
    ['igor_v',     'ukraine-war-end-2026',     'yes', 'buy',  0.30, 400],
    ['brooklyn_s', 'avengers-doomsday-1b',    'yes', 'buy',  0.72, 200],
    ['brooklyn_s', 'gta-vi-2026',             'yes', 'buy',  0.79, 300],
  ];

  for (const [username, marketSlug, side, action, price, quantity] of openOrderDefs) {
    const userId = userMap[username];
    const marketId = marketIds[marketSlug];
    if (!userId || !marketId) continue;
    const ex = await db('orders').where({ user_id: userId, market_id: marketId, side, status: 'open' }).first();
    if (ex) continue;

    await db('orders').insert({
      user_id: userId, market_id: marketId,
      side, type: 'limit', action, status: 'open',
      price: price.toFixed(8),
      quantity: quantity.toFixed(8),
      filled_quantity: '0.00000000',
      remaining_quantity: quantity.toFixed(8),
      total_cost: (quantity * price).toFixed(8),
      fee_amount: '0.00000000',
      metadata: '{}',
      created_at: daysAgo(rndInt(0, 5)),
      updated_at: daysAgo(rndInt(0, 2)),
    });
  }
  logger.info('Orders seeded');

  // ─── RESOLUTION ACTIVITIES ────────────────────────────────────────
  for (const m of marketsData.filter(x => x.status === 'resolved')) {
    const marketId = marketIds[m.slug];
    if (!marketId) continue;
    const ex = await db('activity_feed').where({ market_id: marketId, type: 'market_resolved' }).first();
    if (ex) continue;
    await db('activity_feed').insert({
      user_id: adminId, market_id: marketId, type: 'market_resolved',
      data: JSON.stringify({ outcome: m.outcome, resolution_note: `Market resolved ${m.outcome?.toUpperCase()} per resolution criteria.` }),
      is_public: true, created_at: m.resolved_at,
    });
  }

  logger.info('✅ Comprehensive seeds completed');
}

runSeeds()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Seeds failed', { error: err.message, stack: err.stack });
    process.exit(1);
  });
