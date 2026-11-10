import { isLocale, messages } from "@duoshop/i18n";
import { getAdminZones } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";
import { createZoneAction, toggleZoneAction } from "./actions";

export default async function Zones({
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
  const z = t.zones;
  const path = "/admin/zones";
  const token = await sessionToken();
  const result = token ? await getAdminZones(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const errorText = (code: string | undefined) =>
    code && code in z.errors
      ? z.errors[code as keyof typeof z.errors]
      : z.errors.unknown;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{z.adminTitle}</h1>
        <Notice>
          {result.status === 404 ? t.admin.notStaff : errorText(result.error)}
        </Notice>
      </AccountShell>
    );
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} current={path} />
      <h1>{z.adminTitle}</h1>
      <p>{z.adminIntro}</p>
      {query.saved && <Notice>{z.saved}</Notice>}
      {query.error && <Notice>{errorText(query.error)}</Notice>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{z.name}</th>
              <th>{z.city}</th>
              <th>{z.active}</th>
            </tr>
          </thead>
          <tbody>
            {result.data.zones.map((zone) => (
              <tr key={zone.id}>
                <td>
                  {zone.name}
                  <br />
                  <span className="meta">{zone.slug}</span>
                </td>
                <td>{zone.city}</td>
                <td>
                  <form action={toggleZoneAction}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="zoneId" value={zone.id} />
                    <input
                      type="hidden"
                      name="active"
                      value={zone.active ? "false" : "true"}
                    />
                    {zone.active ? z.active : z.inactive}{" "}
                    <button type="submit" className="link-button">
                      {zone.active ? z.deactivate : z.activate}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="panel" aria-labelledby="new-zone">
        <h2 id="new-zone">{z.add}</h2>
        <form action={createZoneAction} className="stack">
          <input type="hidden" name="locale" value={locale} />
          <label>
            {z.name}
            <input name="name" minLength={2} maxLength={80} required />
          </label>
          <label>
            {z.city}
            <input
              name="city"
              minLength={2}
              maxLength={80}
              defaultValue="Douala"
              required
            />
          </label>
          <label>
            {z.slug}
            <input
              name="slug"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={60}
              required
            />
          </label>
          <label>
            {z.position}
            <input name="position" type="number" min={0} max={10000} />
          </label>
          <button type="submit" className="cta">
            {z.add}
          </button>
        </form>
      </section>
    </AccountShell>
  );
}
