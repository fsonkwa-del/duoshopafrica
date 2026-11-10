// Garde des flux sortants (ADR 0008, lot 1) : tout hôte externe présent dans le code ou la
// configuration suivis par Git doit être déclaré dans docs/compliance/flux-sortants.md.
// Sans dépendance : exécutable en CI avant l'installation.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REGISTER = "docs/compliance/flux-sortants.md";
// Fichiers qui ne déclenchent aucun flux : documentation, tests, verrous, déclarations générées.
const skipped =
  /(^docs\/|^e2e\/|\.md$|\.test\.tsx?$|\.d\.ts$|pnpm-lock\.yaml$|(^|\/)package\.json$|\.(png|jpe?g|webp|svg|ico|woff2?)$)/;
// Noms réservés aux tests et à la documentation (RFC 2606), boucle locale, services internes du Compose.
const internal =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|.*\.(example|invalid|test|localhost)|example\.(com|org|net))$/;

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !skipped.test(f));
const found = new Map();
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  // Une référence de schéma JSON ($schema) ne déclenche aucune requête à l'exécution.
  text = text.replace(/"\$schema"\s*:\s*"[^"]*"/g, "");
  for (const match of text.matchAll(
    /\b(?:https?|wss?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi,
  )) {
    const host = match[1].toLowerCase();
    if (internal.test(host)) continue;
    if (!found.has(host)) found.set(host, new Set());
    found.get(host).add(file);
  }
}

// Hôtes déclarés : chaque `hôte` entre accents graves dans la première colonne du tableau.
const declared = new Set(
  readFileSync(REGISTER, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .flatMap((line) =>
      [...(line.split("|")[1] ?? "").matchAll(/`([a-z0-9.*-]+)`/gi)].map((m) =>
        m[1].toLowerCase(),
      ),
    ),
);
const isDeclared = (host) =>
  declared.has(host) ||
  [...declared].some((d) => d.startsWith("*.") && host.endsWith(d.slice(1)));

const missing = [...found].filter(([host]) => !isDeclared(host));
if (missing.length) {
  for (const [host, where] of missing)
    console.error(
      `undeclared outbound host ${host} (${[...where].join(", ")})`,
    );
  console.error(`Declare each host in ${REGISTER} before merging.`);
  process.exit(1);
}
console.log(`outbound hosts ok (${found.size} declared hosts in use)`);
