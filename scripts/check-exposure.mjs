// Contrôle d'exposition (lot 8, ADR 0016) : lit la configuration Compose résolue
// (`docker compose ... config --format json`) sur l'entrée standard et échoue si :
// - un service autre que Caddy publie un port sur toutes les interfaces (0.0.0.0 ou vide) ;
// - Caddy publie autre chose que 80 et 443 ;
// - un service monte le socket Docker.
// Les machines « db » et « backup » publient seulement sur leur adresse WireGuard (host_ip).
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(0, "utf8"));
const problems = [];
for (const [name, service] of Object.entries(config.services ?? {})) {
  for (const port of service.ports ?? []) {
    const hostIp = port.host_ip ?? "";
    const published = String(port.published ?? "");
    const everywhere = hostIp === "" || hostIp === "0.0.0.0" || hostIp === "::";
    if (name === "caddy") {
      if (!["80", "443"].includes(published) || !everywhere)
        problems.push(`caddy publishes unexpected port ${hostIp}:${published}`);
    } else if (everywhere) {
      problems.push(`${name} publishes port ${published} on all interfaces`);
    }
  }
  for (const volume of service.volumes ?? []) {
    const source = typeof volume === "string" ? volume : (volume.source ?? "");
    if (source.includes("docker.sock"))
      problems.push(`${name} mounts the Docker socket`);
  }
}
if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(
  `exposure ok (${Object.keys(config.services ?? {}).length} services)`,
);
