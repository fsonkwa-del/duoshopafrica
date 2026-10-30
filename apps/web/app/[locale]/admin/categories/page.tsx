import { isLocale, type Locale, messages } from "@duoshop/i18n";
import { getAdminCategories } from "@duoshop/sdk";
import type { AdminCategoryDTO } from "@duoshop/types";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { staffError } from "../../../../lib/staff";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";
import { createCategoryAction, updateCategoryAction } from "./actions";

function EditForm({
  locale,
  category,
}: {
  locale: Locale;
  category: AdminCategoryDTO;
}) {
  const c = messages[locale].categories;
  return (
    <form action={updateCategoryAction} className="inline-forms">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="categoryId" value={category.id} />
      <label>
        {c.nameFr}
        <input
          name="nameFr"
          defaultValue={category.nameFr}
          required
          maxLength={60}
        />
      </label>
      <label>
        {c.nameEn}
        <input
          name="nameEn"
          defaultValue={category.nameEn}
          required
          maxLength={60}
        />
      </label>
      <label>
        {c.position}
        <input
          name="position"
          type="number"
          min={0}
          max={10000}
          defaultValue={category.position}
        />
      </label>
      <label className="variant-choice">
        <input type="checkbox" name="active" defaultChecked={category.active} />
        <span>{c.active}</span>
      </label>
      <button type="submit" className="link-button">
        {c.save}
      </button>
    </form>
  );
}

export default async function AdminCategories({
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
  const c = t.categories;
  const path = "/admin/categories";
  const token = await sessionToken();
  const result = token ? await getAdminCategories(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{c.adminTitle}</h1>
        <Notice>
          {result.status === 404
            ? t.admin.notStaff
            : staffError(locale, result.error)}
        </Notice>
      </AccountShell>
    );
  const all = result.data.categories;
  const roots = all.filter((x) => !x.parentId);
  const errorText = (code: string) =>
    code in c.errors
      ? c.errors[code as keyof typeof c.errors]
      : c.errors.unknown;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} current={path} />
      <h1>{c.adminTitle}</h1>
      <p>{c.adminIntro}</p>
      {query.saved && <Notice>{c.saved}</Notice>}
      {query.error && <Notice>{errorText(query.error)}</Notice>}
      <ul className="queue">
        {roots.map((root) => (
          <li key={root.id} className="panel">
            <h2>
              {root.nameFr} <span className="meta">/{root.slug}</span>
            </h2>
            <EditForm locale={locale} category={root} />
            <ul className="queue">
              {all
                .filter((x) => x.parentId === root.id)
                .map((child) => (
                  <li key={child.id}>
                    <h3>
                      {child.nameFr} <span className="meta">/{child.slug}</span>
                    </h3>
                    <EditForm locale={locale} category={child} />
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
      <section className="panel" aria-labelledby="new-category">
        <h2 id="new-category">{c.create}</h2>
        <form action={createCategoryAction} className="stack">
          <input type="hidden" name="locale" value={locale} />
          <label>
            {c.slug}
            <input
              name="slug"
              required
              maxLength={60}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
            />
          </label>
          <label>
            {c.parent}
            <select name="parentId" defaultValue="">
              <option value="">{c.root}</option>
              {roots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nameFr}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.nameFr}
            <input name="nameFr" required minLength={2} maxLength={60} />
          </label>
          <label>
            {c.nameEn}
            <input name="nameEn" required minLength={2} maxLength={60} />
          </label>
          <label>
            {c.position}
            <input
              name="position"
              type="number"
              min={0}
              max={10000}
              defaultValue={100}
            />
          </label>
          <button type="submit" className="cta">
            {c.create}
          </button>
        </form>
      </section>
    </AccountShell>
  );
}
