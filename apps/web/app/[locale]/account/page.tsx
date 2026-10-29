import { isLocale, messages } from "@duoshop/i18n";
import { getMe } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../lib/session";
import { AccountShell, SignIn } from "./account-shell";

export default async function Account({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  const { error } = await searchParams;
  if (!isLocale(locale)) notFound();
  const t = messages[locale];
  const token = await sessionToken();
  const me = token ? await getMe(apiUrl, token) : null;
  if (!me?.ok)
    return (
      <SignIn
        locale={locale}
        path="/account"
        failed={error === "login_failed"}
      />
    );
  return (
    <AccountShell locale={locale} path="/account" signedIn>
      <h1>{t.myStores}</h1>
      <p>
        {t.signedInAs} <strong>{me.data.email}</strong>
      </p>
      {me.data.stores.length === 0 ? (
        <Notice>{t.noStores}</Notice>
      ) : (
        <ul className="store-list">
          {me.data.stores.map((store) => (
            <li key={store.id}>
              <Link href={`/${locale}/account/stores/${store.id}`}>
                {store.name}
              </Link>
              <span>{t.roles[store.role]}</span>
            </li>
          ))}
        </ul>
      )}
    </AccountShell>
  );
}
