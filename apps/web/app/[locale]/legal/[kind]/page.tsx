import { isLocale, messages } from "@duoshop/i18n";
import { getLegalTexts, type LegalKind } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl } from "../../../../lib/session";
import { ShopShell } from "../../shop-shell";

const slugs: Record<string, LegalKind> = {
  cgu: "CGU",
  cgv: "CGV",
  privacy: "PRIVACY",
  marketing: "MARKETING",
};

// Textes en vigueur, publiés par la conformité (lot 2) ; jamais rédigés par la plateforme.
export default async function LegalText({
  params,
}: {
  params: Promise<{ locale: string; kind: string }>;
}) {
  const { locale, kind } = await params;
  const docKind = slugs[kind];
  if (!isLocale(locale) || !docKind) notFound();
  const p = messages[locale].privacy;
  const text = (await getLegalTexts(apiUrl, locale)).find(
    (d) => d.kind === docKind,
  );
  return (
    <ShopShell locale={locale} path={`/legal/${kind}`}>
      <h1>{text?.title ?? p.kinds[docKind]}</h1>
      {text ? (
        <>
          <p className="meta">
            {p.version} {text.version}
          </p>
          <div className="legal-text">{text.body}</div>
        </>
      ) : (
        <Notice>{p.notPublished}</Notice>
      )}
    </ShopShell>
  );
}
