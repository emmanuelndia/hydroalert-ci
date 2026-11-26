/**
 * Genere la documentation API au format Word a partir de la specification OpenAPI
 * produite par l'application (meme source que Swagger sur /docs).
 *
 * Sortie : docs/API_HydrOAlerte_CI_v<version>.docx
 * Usage  : pnpm docs:api
 *
 * A chaque changement d'API : incrementer info.version dans src/plugins/swagger.ts
 * et ajouter une ligne a VERSION_HISTORY ci-dessous, puis regenerer.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { buildApp } from "../src/app.js";

const VERSION_HISTORY = [
  {
    version: "0.1.0",
    date: "25/11/2026",
    changes:
      "Premiere version : sante de l'API, consultation des zones, capteurs, mesures et alertes (lecture seule, sans authentification).",
  },
  {
    version: "0.1.1",
    date: "25/11/2026",
    changes:
      "Adresse publique configurable (API_PUBLIC_URL) et autorisation CORS pour les applications web. Schemas de reponse des routes de sante. Aucun changement de format sur les autres routes.",
  },
  {
    version: "0.2.0",
    date: "26/11/2026",
    changes:
      "Nouvelle route GET /predictions (historique des evaluations du risque, avec couleur d'affichage). Les alertes peuvent desormais etre creees et escaladees automatiquement par le backend a partir des mesures (regle provisoire). Aucun changement de format sur les routes existantes.",
  },
  {
    version: "0.3.0",
    date: "26/11/2026",
    changes:
      "Cartographie : GET /zones/geojson et GET /sensors/geojson (FeatureCollection GeoJSON pour la carte), GET /zones/locate (zones contenant un point) et GET /sensors/nearby (capteurs dans un rayon en metres). Aucun changement de format sur les routes existantes.",
  },
];

/** Adresse de l'API, lue dans servers[0].url de la specification (variable API_PUBLIC_URL). */
let BASE_URL = "";

/** Descriptions des champs et parametres, utilisees si le schema n'en fournit pas. */
const FIELD_DESCRIPTIONS: Record<string, string> = {
  id: "Identifiant unique (UUID)",
  page: "Numero de page, a partir de 1",
  pageSize: "Nombre d'elements par page (100 au maximum)",
  isActive: "Filtrer selon l'etat actif ou inactif",
  name: "Nom",
  description: "Description",
  createdAt: "Date de creation",
  updatedAt: "Date de derniere modification",
  geometry: "Geometrie GeoJSON (MultiPolygon, WGS 84 / SRID 4326)",
  "geometry.type": "Type de geometrie GeoJSON",
  "geometry.coordinates": "Coordonnees GeoJSON [longitude, latitude]",
  sensorCount: "Nombre de capteurs rattaches a la zone",
  code: "Code lisible et unique du capteur (ex. CAP-COC-01)",
  zoneId: "Identifiant de la zone",
  type: "Type",
  status: "Statut",
  batteryPct: "Batterie en pourcentage (0 a 100)",
  lastCommunication: "Date de la derniere communication du capteur",
  latitude: "Latitude WGS 84 (degres decimaux)",
  longitude: "Longitude WGS 84 (degres decimaux)",
  sensorId: "Identifiant du capteur",
  measuredAt: "Date de la mesure fournie par le capteur",
  receivedAt: "Date de reception par le backend",
  waterLevelCm: "Niveau d'eau en centimetres",
  rainMm: "Pluie en millimetres",
  flowRate: "Debit (unite a confirmer avec le responsable IoT)",
  from: "Debut de periode inclus (date ISO 8601 avec fuseau, ex. 2026-11-24T00:00:00Z)",
  to: "Fin de periode incluse (date ISO 8601 avec fuseau)",
  number: "Numero lisible de l'alerte",
  predictionId: "Prediction a l'origine de l'alerte",
  level: "Niveau d'alerte",
  title: "Titre de l'alerte",
  message: "Message destine aux utilisateurs",
  requiresValidation: "L'alerte doit etre validee avant diffusion",
  validatedAt: "Date de validation",
  startsAt: "Date de debut",
  endsAt: "Date de fin",
  data: "Liste des elements de la page",
  riskScore: "Score de risque de 0 a 100",
  riskLevel: "Niveau de risque (seuils : NORMAL 0-39, VIGILANCE 40-64, DANGER 65-84, EVACUATION 85-100)",
  displayColor: "Couleur d'affichage proposee pour le niveau",
  probability: "Probabilite fournie par le modele IA (0 a 1), sinon null",
  horizonHours: "Horizon de la prediction en heures, sinon null",
  origin: "Origine du calcul : REGLE, IA ou SIMULATION",
  modelVersion: "Version du modele ou de la regle utilisee",
  predictedAt: "Date du calcul",
  features: "Liste des entites GeoJSON (une par zone ou par capteur)",
  "features[].type": "Toujours Feature",
  "features[].id": "Identifiant de la zone ou du capteur",
  "features[].geometry": "Geometrie GeoJSON : MultiPolygon pour une zone, Point pour un capteur",
  "features[].geometry.type": "Type de geometrie GeoJSON",
  "features[].geometry.coordinates": "Coordonnees GeoJSON, ordre [longitude, latitude]",
  "features[].properties": "Attributs de l'entite, a afficher sur la carte",
  "features[].properties.type": "Type de capteur",
  "features[].properties.status": "Statut du capteur",
  activeAlert: "Alerte publiee (ACTIVE) de la zone, sinon null",
  "activeAlert.level": "Niveau de l'alerte publiee",
  lastMeasurement: "Derniere mesure du capteur, sinon null",
  zones: "Zones actives qui contiennent le point",
  sensors: "Capteurs trouves, du plus proche au plus eloigne",
  radiusM: "Rayon de recherche en metres (1 a 10 000, defaut 500)",
  distanceM: "Distance au point en metres",
  "sensors[].type": "Type de capteur",
  "sensors[].status": "Statut du capteur",
  "pagination.page": "Page renvoyee",
  "pagination.pageSize": "Taille de page appliquee",
  "pagination.total": "Nombre total d'elements correspondant aux filtres",
};

const ERROR_LABELS: Record<string, string> = {
  "400": "VALIDATION_ERROR : parametre ou corps de requete invalide",
  "404": "NOT_FOUND : ressource introuvable",
  "503": "service indisponible (base de donnees injoignable)",
  "500": "INTERNAL_ERROR : erreur interne du serveur",
};

type JsonSchema = {
  type?: string;
  format?: string;
  enum?: unknown[];
  nullable?: boolean;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};
type Parameter = { name: string; in: string; required?: boolean; schema: JsonSchema; description?: string };
type Operation = {
  summary?: string;
  tags?: string[];
  parameters?: Parameter[];
  responses?: Record<string, { content?: { "application/json"?: { schema?: JsonSchema } } }>;
};
type Spec = {
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, Operation>>;
};

/* ---------- Description des types ---------- */

function describeType(schema: JsonSchema): string {
  let label: string;
  if (schema.enum) label = `valeur parmi : ${schema.enum.join(" | ")}`;
  else if (schema.format === "uuid") label = "UUID";
  else if (schema.format === "date-time") label = "date ISO 8601";
  else if (schema.type === "array") {
    label = schema.items?.type === "object" ? "tableau d'objets" : "tableau";
  } else if (schema.type === "integer") label = "entier";
  else if (schema.type === "number") label = "nombre";
  else if (schema.type === "boolean") label = "booleen";
  else if (schema.type === "string") label = "texte";
  else if (schema.type === "object") label = "objet";
  else label = "libre";
  return schema.nullable ? `${label} ou null` : label;
}

function describeConstraints(schema: JsonSchema): string {
  const parts: string[] = [];
  if (schema.minimum !== undefined) parts.push(`min ${schema.minimum}`);
  if (schema.maximum !== undefined && schema.maximum < Number.MAX_SAFE_INTEGER) {
    parts.push(`max ${schema.maximum}`);
  }
  if (schema.default !== undefined) parts.push(`defaut ${JSON.stringify(schema.default)}`);
  return parts.join(", ") || "-";
}

function fieldDescription(path: string, schema: JsonSchema) {
  const leaf = path.replace(/\[\]/g, "").split(".").pop() ?? path;
  return schema.description ?? FIELD_DESCRIPTIONS[path] ?? FIELD_DESCRIPTIONS[leaf] ?? "";
}

/** Aplati un schema de reponse en lignes (champ, type, obligatoire, description). */
function flattenSchema(schema: JsonSchema, prefix = "", depth = 0): string[][] {
  const rows: string[][] = [];
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    const required = schema.required?.includes(key) ? "oui" : "non";
    rows.push([path, describeType(child), required, fieldDescription(path, child)]);
    if (depth < 3) {
      if (child.type === "object" && child.properties) {
        rows.push(...flattenSchema(child, path, depth + 1));
      } else if (child.type === "array" && child.items?.properties) {
        rows.push(...flattenSchema(child.items, `${path}[]`, depth + 1));
      }
    }
  }
  return rows;
}

/** Recense toutes les enumerations de la specification (parametres et reponses). */
function collectEnums(spec: Spec) {
  // Cle "champ (tag)" : un meme nom (ex. status) peut avoir des valeurs differentes selon la ressource.
  const enums = new Map<string, string[]>();
  const visit = (name: string, tag: string, schema: JsonSchema | undefined) => {
    if (!schema) return;
    if (schema.enum && !["true", "false"].includes(String(schema.enum[0]))) {
      enums.set(`${name} (${tag})`, schema.enum.map(String));
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) visit(key, tag, child);
    if (schema.items) visit(name, tag, schema.items);
  };
  for (const methods of Object.values(spec.paths)) {
    for (const op of Object.values(methods)) {
      const tag = op.tags?.[0] ?? "-";
      for (const p of op.parameters ?? []) visit(p.name, tag, p.schema);
      for (const r of Object.values(op.responses ?? {})) {
        visit("", tag, r.content?.["application/json"]?.schema);
      }
    }
  }
  return new Map([...enums.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/* ---------- Mise en forme Word ---------- */

const HEADER_FILL = "1F4E79";
const border = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const cellBorders = { top: border, bottom: border, left: border, right: border };

function cell(text: string, header = false) {
  return new TableCell({
    borders: cellBorders,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    ...(header && { shading: { type: ShadingType.CLEAR, color: "auto", fill: HEADER_FILL } }),
    children: [
      new Paragraph({
        children: [new TextRun({ text, size: 18, bold: header, color: header ? "FFFFFF" : "000000" })],
      }),
    ],
  });
}

function table(headers: string[], rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h) => cell(h, true)) }),
      ...rows.map((row) => new TableRow({ children: row.map((value) => cell(value)) })),
    ],
  });
}

const heading = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) =>
  new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });

const para = (text: string) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 100 } });

const bullet = (text: string) => new Paragraph({ text, bullet: { level: 0 } });

const code = (text: string) =>
  new Paragraph({
    shading: { type: ShadingType.CLEAR, color: "auto", fill: "F2F2F2" },
    spacing: { after: 120 },
    children: [new TextRun({ text, font: "Consolas", size: 18 })],
  });

const label = (text: string) =>
  new Paragraph({ spacing: { before: 120, after: 60 }, children: [new TextRun({ text, bold: true })] });

function exampleUrl(path: string, op: Operation) {
  const url = path.replace(/\{(\w+)\}/g, "<$1>");
  const query = (op.parameters ?? [])
    .filter((p) => p.in === "query" && p.name === "pageSize")
    .map(() => "pageSize=10");
  return `GET ${BASE_URL}${url}${query.length ? `?${query.join("&")}` : ""}`;
}

function operationSection(method: string, path: string, op: Operation) {
  const children: (Paragraph | Table)[] = [heading(`${method.toUpperCase()} ${path}`, HeadingLevel.HEADING_3)];
  if (op.summary) children.push(para(op.summary));

  const params = op.parameters ?? [];
  if (params.length > 0) {
    children.push(label("Parametres"));
    children.push(
      table(
        ["Nom", "Emplacement", "Type", "Obligatoire", "Contraintes", "Description"],
        params.map((p) => [
          p.name,
          p.in === "path" ? "chemin" : p.in === "query" ? "query string" : p.in,
          describeType(p.schema),
          p.required ? "oui" : "non",
          describeConstraints(p.schema),
          p.description ?? fieldDescription(p.name, p.schema),
        ]),
      ),
    );
  } else {
    children.push(label("Parametres"), para("Aucun."));
  }

  const success = op.responses?.["200"]?.content?.["application/json"]?.schema;
  children.push(label("Reponse 200"));
  if (success?.properties) {
    children.push(table(["Champ", "Type", "Obligatoire", "Description"], flattenSchema(success)));
  } else {
    children.push(para("Objet JSON simple, voir l'exemple."));
  }

  const errorCodes = Object.keys(op.responses ?? {}).filter((status) => status !== "200");
  if (!errorCodes.includes("500")) errorCodes.push("500");
  children.push(label("Erreurs possibles"));
  for (const status of errorCodes) children.push(bullet(`${status} - ${ERROR_LABELS[status] ?? "erreur"}`));

  children.push(label("Exemple"), code(exampleUrl(path, op)));
  return children;
}

/* ---------- Construction du document ---------- */

async function main() {
  const app = buildApp({ logger: false, databaseCheck: async () => {} });
  await app.ready();
  const spec = app.swagger() as unknown as Spec;
  await app.close();

  BASE_URL = spec.servers?.[0]?.url ?? "http://127.0.0.1:3000";
  const version = spec.info.version;
  const generatedAt = new Date().toLocaleDateString("fr-FR", { timeZone: "UTC" });
  const enums = collectEnums(spec);

  const titlePage = [
    new Paragraph({ spacing: { before: 2400 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "HydrO'Alerte CI", bold: true, size: 56, color: HEADER_FILL })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: "Documentation de l'API backend", size: 36 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `Version ${version} - generee le ${generatedAt}`, size: 24 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600 },
      children: [
        new TextRun({
          text: "Document genere automatiquement a partir du code (pnpm docs:api). Ne pas modifier a la main.",
          italics: true,
          size: 20,
        }),
      ],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const general = [
    heading("1. Generalites", HeadingLevel.HEADING_1),
    para(spec.info.description ?? ""),
    heading("Acces", HeadingLevel.HEADING_2),
    bullet(`URL de base : ${BASE_URL}`),
    bullet(`Documentation interactive (Swagger) : ${BASE_URL}/docs`),
    bullet(`Specification OpenAPI JSON : ${BASE_URL}/docs/json`),
    bullet(
      "L'URL de base depend de l'environnement : une adresse locale (127.0.0.1) ne fonctionne que sur la machine qui execute l'API. Utiliser l'adresse communiquee par le responsable backend (reseau local ou hebergement).",
    ),
    bullet("Emulateur Android : pour joindre une API lancee sur le PC hote, remplacer 127.0.0.1 par 10.0.2.2."),
    bullet(
      "Applications web : l'origine du site (ex. http://localhost:5173) doit etre autorisee cote backend (CORS) ; la communiquer au responsable backend.",
    ),
    bullet("Authentification : aucune pour cette version ; elle sera ajoutee au lot 4."),
    bullet("Les donnees actuellement servies sont fictives (polygone et capteurs de demonstration)."),
    heading("Formats", HeadingLevel.HEADING_2),
    bullet("Requetes et reponses en JSON (UTF-8)."),
    bullet("Dates au format ISO 8601, en UTC dans les reponses (ex. 2026-11-24T23:00:00.000Z)."),
    bullet("Coordonnees en WGS 84 (SRID 4326) ; les geometries suivent GeoJSON (ordre longitude, latitude)."),
    heading("Pagination", HeadingLevel.HEADING_2),
    para("Les listes acceptent page (defaut 1) et pageSize (defaut 20, maximum 100) et renvoient :"),
    code('{ "data": [ ... ], "pagination": { "page": 1, "pageSize": 20, "total": 42 } }'),
    heading("Erreurs", HeadingLevel.HEADING_2),
    para("Toutes les erreurs ont le meme format :"),
    code('{ "error": { "code": "NOT_FOUND", "message": "Capteur introuvable", "details": [ ... ] } }'),
    table(
      ["Statut HTTP", "Code", "Signification"],
      [
        ["400", "VALIDATION_ERROR", "Parametre invalide ; details liste les champs en cause"],
        ["404", "NOT_FOUND", "Ressource ou route introuvable"],
        ["500", "INTERNAL_ERROR", "Erreur interne ; aucun detail technique n'est expose"],
      ],
    ),
    heading("Valeurs enumerees", HeadingLevel.HEADING_2),
    table(
      ["Champ", "Valeurs possibles"],
      [...enums.entries()].map(([name, values]) => [name, values.join(", ")]),
    ),
    para("Correspondance d'affichage proposee : NORMAL vert, VIGILANCE orange, DANGER rouge, EVACUATION rouge."),
  ];

  const endpoints: (Paragraph | Table)[] = [heading("2. Endpoints", HeadingLevel.HEADING_1)];
  const tags = spec.tags ?? [];
  tags.forEach((tag, index) => {
    const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.entries(methods)
        .filter(([, op]) => op.tags?.includes(tag.name))
        .map(([method, op]) => ({ path, method, op })),
    );
    if (operations.length === 0) return;
    endpoints.push(heading(`2.${index + 1} ${tag.name}`, HeadingLevel.HEADING_2));
    if (tag.description) endpoints.push(para(tag.description));
    for (const { path, method, op } of operations) endpoints.push(...operationSection(method, path, op));
  });

  const history = [
    heading("3. Historique des versions", HeadingLevel.HEADING_1),
    table(
      ["Version", "Date", "Changements"],
      VERSION_HISTORY.map((entry) => [entry.version, entry.date, entry.changes]),
    ),
  ];

  if (!VERSION_HISTORY.some((entry) => entry.version === version)) {
    throw new Error(`La version ${version} n'a pas d'entree dans VERSION_HISTORY.`);
  }

  const doc = new Document({
    creator: "HydrO'Alerte CI - backend",
    title: `${spec.info.title} v${version}`,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children: [...titlePage, ...general, ...endpoints, ...history] }],
  });

  const output = resolve("docs", `API_HydrOAlerte_CI_v${version}.docx`);
  writeFileSync(output, await Packer.toBuffer(doc));
  console.log(`Documentation generee : ${output}`);
}

await main();
