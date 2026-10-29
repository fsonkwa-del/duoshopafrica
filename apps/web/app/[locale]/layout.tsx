import { brand } from "@duoshop/config";
import { isLocale, locales } from "@duoshop/i18n";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import "../globals.css";
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return {
    title: brand.name,
    description: brand.metadata[locale],
    robots: { index: false, follow: false },
  };
}
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const style = Object.fromEntries(
    Object.entries(brand.colors).map(([key, value]) => [`--${key}`, value]),
  ) as CSSProperties;
  return (
    <html lang={locale} dir="ltr">
      <body style={style}>{children}</body>
    </html>
  );
}
