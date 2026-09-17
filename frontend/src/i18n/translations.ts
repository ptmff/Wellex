export type Language = "ru" | "en";

type Dictionary = Record<string, string>;

export const dictionaries: Record<Language, Dictionary> = {
  ru: {
    "nav.markets": "Рынки",
    "nav.portfolio": "Портфель",
    "nav.create": "Создать",
    "nav.shop": "Магазин",
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

    // Cookie consent
    "cookie.banner.ariaLabel": "Уведомление об использовании файлов cookie",
    "cookie.banner.title": "Мы используем файлы cookie",
    "cookie.banner.description":
      "Мы используем файлы cookie для обеспечения работы сайта, улучшения вашего опыта и анализа трафика. Вы можете настроить предпочтения или принять все cookie.",
    "cookie.banner.acceptAll": "Принять все",
    "cookie.banner.rejectAll": "Только необходимые",
    "cookie.banner.customize": "Настроить",

    "cookie.settings.title": "Настройки cookie",
    "cookie.settings.description":
      "Выберите, какие категории файлов cookie вы хотите разрешить.",
    "cookie.settings.save": "Сохранить",
    "cookie.settings.cancel": "Отмена",

    "cookie.category.necessary": "Необходимые",
    "cookie.category.necessary.desc":
      "Требуются для работы сайта: авторизация, безопасность, языковые настройки. Отключить нельзя.",
    "cookie.category.functional": "Функциональные",
    "cookie.category.functional.desc":
      "Запоминают ваши предпочтения: тему, язык интерфейса и другие персональные настройки.",
    "cookie.category.analytics": "Аналитические",
    "cookie.category.analytics.desc":
      "Помогают нам понять, как пользователи взаимодействуют с сайтом, чтобы улучшать его.",
  },
  en: {
    "nav.markets": "Markets",
    "nav.portfolio": "Portfolio",
    "nav.create": "Create",
    "nav.shop": "Shop",
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

    // Cookie consent
    "cookie.banner.ariaLabel": "Cookie usage notification",
    "cookie.banner.title": "We use cookies",
    "cookie.banner.description":
      "We use cookies to keep the site running, improve your experience, and analyse traffic. You can customise your preferences or accept all cookies.",
    "cookie.banner.acceptAll": "Accept all",
    "cookie.banner.rejectAll": "Essential only",
    "cookie.banner.customize": "Customize",

    "cookie.settings.title": "Cookie settings",
    "cookie.settings.description": "Choose which categories of cookies you want to allow.",
    "cookie.settings.save": "Save preferences",
    "cookie.settings.cancel": "Cancel",

    "cookie.category.necessary": "Necessary",
    "cookie.category.necessary.desc":
      "Required for the site to function: authentication, security, and language preferences. Cannot be disabled.",
    "cookie.category.functional": "Functional",
    "cookie.category.functional.desc":
      "Remember your preferences such as theme, language, and other personal settings.",
    "cookie.category.analytics": "Analytics",
    "cookie.category.analytics.desc":
      "Help us understand how users interact with the site so we can improve it.",
  },
};
