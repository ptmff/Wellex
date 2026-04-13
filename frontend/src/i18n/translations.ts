export type Language = "ru" | "en";

type Dictionary = Record<string, string>;

export const dictionaries: Record<Language, Dictionary> = {
  ru: {
    "nav.markets": "Рынки",
    "nav.portfolio": "Портфель",
    "nav.create": "Создать",
    "nav.profile": "Профиль",
    "nav.searchMarkets": "Поиск рынков...",
    "nav.login": "Войти",
    "nav.logout": "Выйти",
    "lang.ru": "RU",
    "lang.en": "EN",

    "index.title": "Рынки",
    "index.subtitle": "Торгуйте исходами событий из реального мира",
    "index.filter.all": "Все",
    "index.filter.trending": "В тренде",
    "index.filter.new": "Новые",
    "index.filter.ending": "Скоро закрытие",
    "index.search": "Поиск...",
    "index.loading": "Загрузка...",
    "index.loadMore": "Показать еще",
    "index.noMarkets": "Рынки не найдены",
    "index.failedToLoad": "Не удалось загрузить рынки",
  },
  en: {
    "nav.markets": "Markets",
    "nav.portfolio": "Portfolio",
    "nav.create": "Create",
    "nav.profile": "Profile",
    "nav.searchMarkets": "Search markets...",
    "nav.login": "Log in",
    "nav.logout": "Log out",
    "lang.ru": "RU",
    "lang.en": "EN",

    "index.title": "Prediction Markets",
    "index.subtitle": "Trade on the outcome of real-world events",
    "index.filter.all": "All",
    "index.filter.trending": "Trending",
    "index.filter.new": "New",
    "index.filter.ending": "Ending Soon",
    "index.search": "Search...",
    "index.loading": "Loading...",
    "index.loadMore": "Load more",
    "index.noMarkets": "No markets found",
    "index.failedToLoad": "Failed to load markets",
  },
};
