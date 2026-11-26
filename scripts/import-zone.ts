/**
 * Importe (ou remplace) la geometrie d'une zone a partir d'un fichier GeoJSON,
 * puis rattache chaque capteur a la zone qui contient sa position.
 *
 * Usage :
 *   pnpm zone:import --file docs/zones/riviera-9-kilos.geojson --name "Riviera 9 Kilos"
 *
 * Options :
 *   --file           fichier GeoJSON : Polygon, MultiPolygon, Feature ou FeatureCollection
 *   --name           nom de la zone ; une zone existante du meme nom voit sa geometrie remplacee
 *   --description    description (facultatif)
 *   --allow-outside  accepte une zone hors de l'emprise de la Cote d'Ivoire
 *   --dry-run        verifie la geometrie sans rien enregistrer
 *   --remote         confirme l'ecriture sur une base qui n'est pas locale (ex. Neon)
 *
 * Coordonnees attendues : WGS 84, ordre GeoJSON [longitude, latitude].
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import {
  extractZoneGeometry,
  reassignSensorZones,
  upsertZone,
  validateZoneGeometry,
  ZoneGeometryError,
} from "../src/services/geo.js";
import { assertWritableTarget } from "./lib/target-database.js";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    "allow-outside": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
  },
});

if (!values.file || !values.name) {
  console.error('Usage : pnpm zone:import --file <fichier.geojson> --name "<nom de la zone>" [--dry-run]');
  process.exit(1);
}

assertWritableTarget({ remote: values.remote || values["dry-run"] });
const prisma = new PrismaClient();

try {
  const document: unknown = JSON.parse(readFileSync(values.file, "utf8"));
  const geometry = extractZoneGeometry(document);
  const allowOutsideCountry = values["allow-outside"];

  if (values["dry-run"]) {
    const { areaM2 } = await validateZoneGeometry(prisma, geometry, { allowOutsideCountry });
    console.log(`Geometrie valide (${geometry.type}), surface ${(areaM2 / 1_000_000).toFixed(3)} km2. Rien n'a ete enregistre.`);
  } else {
    const result = await upsertZone(prisma, {
      name: values.name,
      ...(values.description && { description: values.description }),
      geometry,
      allowOutsideCountry,
    });
    console.log(
      `Zone ${result.action === "created" ? "creee" : "mise a jour"} : ${values.name} (${result.zoneId}), ` +
        `surface ${(result.areaM2 / 1_000_000).toFixed(3)} km2`,
    );

    const { moved, outside } = await reassignSensorZones(prisma);
    for (const sensor of moved) console.log(`Capteur ${sensor.code} rattache a ${sensor.zoneName}`);
    if (moved.length === 0) console.log("Aucun capteur n'a change de zone.");
    if (outside.length > 0) {
      console.log(`Attention : capteurs hors de toute zone active (rattachement inchange) : ${outside.join(", ")}`);
    }
  }
} catch (error) {
  if (error instanceof ZoneGeometryError) {
    console.error(`Zone refusee (${error.code}) : ${error.message}`);
    process.exitCode = 1;
  } else if (error instanceof SyntaxError) {
    console.error(`Fichier illisible : ce n'est pas du JSON valide (${error.message})`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  await prisma.$disconnect();
}
