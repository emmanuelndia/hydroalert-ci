import assert from "node:assert/strict";
import { test } from "node:test";
import { extractZoneGeometry, ZoneGeometryError } from "./geo.js";

const square = (x: number, y: number) => [
  [
    [x, y],
    [x + 0.01, y],
    [x + 0.01, y + 0.01],
    [x, y + 0.01],
    [x, y],
  ],
];

test("extractZoneGeometry accepts a geometry, a Feature or a FeatureCollection", () => {
  const polygon = { type: "Polygon", coordinates: square(-4, 5.3) };
  assert.deepEqual(extractZoneGeometry(polygon), polygon);
  assert.deepEqual(extractZoneGeometry({ type: "Feature", properties: {}, geometry: polygon }), polygon);
  assert.deepEqual(
    extractZoneGeometry({ type: "FeatureCollection", features: [{ type: "Feature", geometry: polygon }] }),
    polygon,
  );
});

test("several polygons are merged into a MultiPolygon", () => {
  const result = extractZoneGeometry({
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "Polygon", coordinates: square(-4, 5.3) } },
      { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [square(-3.9, 5.3), square(-3.8, 5.3)] } },
    ],
  });
  assert.equal(result.type, "MultiPolygon");
  assert.equal(result.coordinates.length, 3);
});

test("non-surface geometries and malformed documents are refused", () => {
  const cases: [unknown, string][] = [
    [{ type: "Point", coordinates: [-3.95, 5.36] }, "INVALID_TYPE"],
    [{ type: "LineString", coordinates: [[-3.95, 5.36], [-3.9, 5.3]] }, "INVALID_TYPE"],
    [{ type: "FeatureCollection", features: [] }, "INVALID_GEOJSON"],
    [{ type: "Feature", geometry: null }, "INVALID_GEOJSON"],
    [{ coordinates: [] }, "INVALID_GEOJSON"],
    ["texte", "INVALID_GEOJSON"],
  ];
  for (const [input, code] of cases) {
    assert.throws(
      () => extractZoneGeometry(input),
      (error: unknown) => error instanceof ZoneGeometryError && error.code === code,
      JSON.stringify(input),
    );
  }
});
