import { Link, Navigate, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { useI18n } from "@/i18n/I18nContext";
import { legalRoutes, type LegalSlug } from "@/legal/config";
import { getLegalDocument, legalSlugs } from "@/legal/documents";

function isLegalSlug(value: string | undefined): value is LegalSlug {
  return legalSlugs.includes(value as LegalSlug);
}

export default function LegalDocumentPage() {
  const { slug } = useParams<{ slug: string }>();
  const { language } = useI18n();

  if (!isLegalSlug(slug)) {
    return <Navigate to="/" replace />;
  }

  const meta = legalRoutes[slug];
  const doc = getLegalDocument(slug, language);
  if (!doc) {
    return <Navigate to="/" replace />;
  }

  const title = language === "ru" ? meta.titleRu : meta.titleEn;
  const updatedLabel =
    language === "ru" ? `Версия от ${doc.updatedAt}` : `Version dated ${doc.updatedAt}`;

  return (
    <AppLayout>
      <article className="max-w-3xl mx-auto prose prose-sm dark:prose-invert">
        <p className="text-xs text-muted-foreground not-prose mb-2">
          <Link to="/" className="text-primary hover:underline">
            {language === "ru" ? "← На главную" : "← Home"}
          </Link>
        </p>
        <h1 className="text-2xl font-bold mb-1 not-prose">{title}</h1>
        <p className="text-sm text-muted-foreground mb-8 not-prose">{updatedLabel}</p>

        <div className="space-y-8 not-prose">
          {doc.sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold mb-3">{section.title}</h2>
              {section.paragraphs.map((p) => (
                <p key={p.slice(0, 48)} className="text-sm text-muted-foreground leading-relaxed mb-3">
                  {p}
                </p>
              ))}
              {section.list ? (
                <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
                  {section.list.map((item) => (
                    <li key={item.slice(0, 48)}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <nav className="mt-12 pt-6 border-t border-border not-prose">
          <p className="text-xs font-medium text-foreground mb-2">
            {language === "ru" ? "Другие документы" : "Other documents"}
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {legalSlugs
              .filter((s) => s !== slug)
              .map((s) => {
                const m = legalRoutes[s];
                return (
                  <li key={s}>
                    <Link to={m.path} className="text-primary hover:underline">
                      {language === "ru" ? m.titleRu : m.titleEn}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </nav>
      </article>
    </AppLayout>
  );
}
