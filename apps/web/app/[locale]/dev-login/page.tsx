import { isLocale, messages } from "@duoshop/i18n";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { AccountShell } from "../account/account-shell";
import { demoSignIn } from "./actions";

export default async function DemoSignIn({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale) || process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const d = messages[locale].devLogin;
  const profiles = [
    { key: "newBuyer", label: d.newBuyer, hint: d.newBuyerHint },
    { key: "buyer", label: d.buyer, hint: d.buyerHint },
    { key: "seller", label: d.seller, hint: d.sellerHint },
    { key: "admin", label: d.admin, hint: d.adminHint },
    { key: "finance", label: d.finance, hint: d.financeHint },
  ] as const;
  return (
    <AccountShell locale={locale} path="/dev-login" signedIn={false}>
      <h1>{d.title}</h1>
      <Notice>{d.notice}</Notice>
      {query.error && <Notice>{d.unavailable}</Notice>}
      <ul className="queue">
        {profiles.map((p) => (
          <li key={p.key} className="panel">
            <form action={demoSignIn} className="stack">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="profile" value={p.key} />
              <input
                type="hidden"
                name="returnTo"
                value={query.returnTo ?? ""}
              />
              <button type="submit" className="cta">
                {p.label}
              </button>
              <span className="hint">{p.hint}</span>
            </form>
          </li>
        ))}
      </ul>
    </AccountShell>
  );
}
