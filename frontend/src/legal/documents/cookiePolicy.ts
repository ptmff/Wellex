import { LEGAL_DOCS_VERSION, legalOperator } from "../config";
import type { LegalDocumentContent } from "./types";

export const cookiePolicyRu: LegalDocumentContent = {
  updatedAt: LEGAL_DOCS_VERSION,
  sections: [
    {
      title: "1. Назначение документа",
      paragraphs: [
        `Документ описывает использование файлов cookie и аналогичных технологий на платформе ${legalOperator.brandNameRu} в соответствии с 152-ФЗ и практикой Роскомнадзора по информированию пользователей.`,
        "Необходимые технологии работают без отдельного согласия; остальные — только после выбора в баннере или настройках cookie.",
      ],
    },
    {
      title: "2. Категории",
      paragraphs: ["Мы используем следующие категории:"],
      list: [
        "Необходимые — обеспечивают вход в аккаунт, безопасность сессии, работу API. Отключение делает сервис недоступным.",
        "Функциональные — сохраняют язык интерфейса и иные настройки отображения.",
        "Аналитические — помогают понимать использование сайта (подключаются только при вашем согласии; на момент публикации сторонняя аналитика может быть не активна).",
      ],
    },
    {
      title: "3. Конкретные ключи локального хранилища",
      paragraphs: ["Актуальный перечень на стороне клиента:"],
      list: [
        "wellex-cookie-consent — категории согласия и статус выбора (localStorage, до изменения или очистки браузера).",
        "wellex-language — выбранный язык RU/EN (localStorage; категория «функциональные», только после согласия).",
        "wellex.accessToken — токен доступа для API (localStorage; необходимые).",
        "wellex.refreshToken — токен обновления сессии (sessionStorage; необходимые).",
      ],
    },
    {
      title: "4. Управление",
      paragraphs: [
        "При первом визите отображается баннер: «Принять все», «Только необходимые» или «Настроить».",
        "Изменить выбор можно через ссылку «Настройки cookie» в подвале сайта или в профиле.",
        "Очистка данных браузера сбрасывает сохранённые предпочтения; баннер может быть показан снова.",
      ],
    },
    {
      title: "5. Связь с персональными данными",
      paragraphs: [
        "Идентификаторы сессии и технические cookie могут считаться персональными данными. Их обработка описана в Политике обработки персональных данных.",
        `Вопросы: ${legalOperator.privacyEmail}.`,
      ],
    },
  ],
};

export const cookiePolicyEn: LegalDocumentContent = {
  updatedAt: LEGAL_DOCS_VERSION,
  sections: [
    {
      title: "1. Overview",
      paragraphs: [
        "We use cookies and local storage. Non-essential categories require your consent via the cookie banner.",
      ],
    },
    {
      title: "2. Storage keys",
      paragraphs: ["Main keys: wellex-cookie-consent, wellex-language, wellex.accessToken, wellex.refreshToken."],
    },
    {
      title: "3. Control",
      paragraphs: ["Use the banner or footer link «Cookie settings» to change preferences."],
    },
  ],
};
