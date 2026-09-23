import { LEGAL_DOCS_VERSION } from "../config";
import type { LegalDocumentContent } from "./types";

export const marketRulesRu: LegalDocumentContent = {
  updatedAt: LEGAL_DOCS_VERSION,
  sections: [
    {
      title: "1. Общие правила",
      paragraphs: [
        "Рынки отражают вопросы о наступлении или ненаступлении событий (исход YES/NO). Создание рынков может быть ограничено ролью пользователя (модераторы/администраторы).",
        "Торговля ведётся через книгу заявок (order book) за игровую валюту WX.",
      ],
    },
    {
      title: "2. Создание рынков",
      paragraphs: [
        "Заголовок и описание должны быть понятными и не нарушать законодательство РФ. Запрещены рынки, призывающие к насилию, дискриминации, незаконной деятельности.",
        "Оператор и модераторы вправе отклонить, закрыть или разрешить рынок досрочно с указанием исхода.",
      ],
    },
    {
      title: "3. Торговля",
      paragraphs: [
        "Ордера исполняются по правилам matching-сервиса. Частичное исполнение и отмена — согласно интерфейсу и статусу рынка.",
        "Запрещены wash-trading, сговор, использование уязвимостей и автоматизация без разрешения.",
      ],
    },
    {
      title: "4. Разрешение рынков",
      paragraphs: [
        "После наступления события или по решению модератора рынок переводится в статус resolved с исходом YES или NO. Выплаты по позициям производятся в WX по правилам платформы.",
      ],
    },
    {
      title: "5. Импортированные рынки",
      paragraphs: [
        "Часть рынков может импортироваться из внешних источников (например, Polymarket) в ознакомительных целях; условия торговли на платформе Wellex определяются настоящими Правилами.",
      ],
    },
  ],
};

export const marketRulesEn: LegalDocumentContent = {
  updatedAt: LEGAL_DOCS_VERSION,
  sections: [
    {
      title: "1. Markets",
      paragraphs: ["Binary YES/NO markets traded in WX via an order book."],
    },
    {
      title: "2. Conduct",
      paragraphs: ["No manipulation, bots without permission, or illegal content."],
    },
    {
      title: "3. Resolution",
      paragraphs: ["Markets resolve to YES or NO; payouts are in WX per platform rules."],
    },
  ],
};
