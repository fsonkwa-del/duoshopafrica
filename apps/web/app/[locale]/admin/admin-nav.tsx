import { type Locale, messages } from "@duoshop/i18n";
import Link from "next/link";

export function AdminNav({ locale }: { locale: Locale }) {
  const a = messages[locale].admin;
  return (
    <nav aria-label={a.nav} className="filters">
      <Link href={`/${locale}/admin/verifications`}>{a.title}</Link>
      <Link href={`/${locale}/admin/payment-methods`}>{a.methods.title}</Link>
      <Link href={`/${locale}/admin/payments`}>{a.payments.title}</Link>
      <Link href={`/${locale}/admin/commissions`}>
        {messages[locale].commissions.nav}
      </Link>
      <Link href={`/${locale}/admin/finance`}>
        {messages[locale].finance.nav}
      </Link>
    </nav>
  );
}
