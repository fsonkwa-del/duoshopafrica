import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isLocale, messages } from "@duoshop/i18n";
import { notFound } from "next/navigation";
import { ShopShell } from "../shop-shell";

interface Credit {
  product: string;
  title: string;
  artist: string;
  license: string;
  licenseUrl: string;
  source: string;
}

// Attribution des photos libres du catalogue de démonstration (obligatoire pour CC BY/BY-SA).
export default async function Credits({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const h = messages[locale].header;
  const credits = await readFile(
    join(process.cwd(), "public", "demo-media", "credits.json"),
    "utf8",
  )
    .then((text) => JSON.parse(text) as Credit[])
    .catch(() => [] as Credit[]);
  const safe = (url: string) => (url.startsWith("https://") ? url : undefined);
  return (
    <ShopShell locale={locale} path="/credits">
      <h1>{h.creditsTitle}</h1>
      <p>{h.creditsIntro}</p>
      {credits.length === 0 ? (
        <p>{h.creditsEmpty}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{messages[locale].pdp.photo}</th>
                <th>{h.creditsAuthor}</th>
                <th>{h.creditsLicense}</th>
                <th>{h.creditsSource}</th>
              </tr>
            </thead>
            <tbody>
              {credits.map((c) => (
                <tr key={c.source}>
                  <td>
                    {c.product}
                    <br />
                    <span className="meta">{c.title}</span>
                  </td>
                  <td>{c.artist}</td>
                  <td>
                    {safe(c.licenseUrl) ? (
                      <a href={safe(c.licenseUrl)} rel="noopener noreferrer">
                        {c.license}
                      </a>
                    ) : (
                      c.license
                    )}
                  </td>
                  <td>
                    {safe(c.source) && (
                      <a href={safe(c.source)} rel="noopener noreferrer">
                        Wikimedia Commons
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ShopShell>
  );
}
