import { isLocale, messages } from "@duoshop/i18n";
import { listAddresses } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../account-shell";
import { archiveAddressAction, createAddressAction } from "./actions";
import { AddressFields } from "./address-fields";

export default async function Addresses({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const a = t.addresses;
  const path = "/account/addresses";
  const token = await sessionToken();
  const result = token ? await listAddresses(apiUrl, token) : null;
  if (!result?.ok) return <SignIn locale={locale} path={path} />;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <p>
        <Link href={`/${locale}/checkout`}>{t.checkout.title}</Link>
      </p>
      <h1>{a.title}</h1>
      {query.saved && <Notice>{a.saved}</Notice>}
      {query.error && <Notice>{a.invalid}</Notice>}
      <ul className="cart-lines">
        {result.data.addresses.map((address) => (
          <li key={address.id}>
            <div>
              <strong>{address.label}</strong> — {address.recipientName},{" "}
              {address.phone}
              <br />
              {address.district}, {address.city} · {address.landmark}
            </div>
            <form action={archiveAddressAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="addressId" value={address.id} />
              <button type="submit" className="secondary">
                {a.archive}
              </button>
            </form>
          </li>
        ))}
      </ul>
      <section className="panel" aria-labelledby="new-address">
        <h2 id="new-address">{a.add}</h2>
        <form action={createAddressAction} className="stack">
          <input type="hidden" name="locale" value={locale} />
          <AddressFields locale={locale} />
          <button type="submit" className="cta">
            {a.save}
          </button>
        </form>
      </section>
    </AccountShell>
  );
}
