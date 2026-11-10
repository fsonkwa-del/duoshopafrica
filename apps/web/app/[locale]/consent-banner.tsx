import { type Locale, messages } from "@duoshop/i18n";
import { getMyPrivacy } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { apiUrl, sessionToken } from "../../lib/session";

// Conditions en vigueur non acceptées (lot 2) : toute modification est refusée par l'API (428)
// tant qu'elles ne le sont pas ; la bannière y mène depuis chaque page.
export async function ConsentBanner({ locale }: { locale: Locale }) {
  const token = await sessionToken();
  if (!token) return null;
  const result = await getMyPrivacy(apiUrl, token);
  if (!result.ok || result.data.pending.length === 0) return null;
  const p = messages[locale].privacy;
  return (
    <Notice>
      {p.banner} <Link href={`/${locale}/account/consent`}>{p.review}</Link>
    </Notice>
  );
}
