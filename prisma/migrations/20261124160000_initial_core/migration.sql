-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Enable PostGIS before creating spatial columns.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "sensor_type" AS ENUM ('NIVEAU_EAU', 'PLUIE', 'DEBIT', 'AUTRE');

-- CreateEnum
CREATE TYPE "sensor_status" AS ENUM ('ACTIF', 'HORS_LIGNE', 'EN_MAINTENANCE', 'DESACTIVE');

-- CreateEnum
CREATE TYPE "risk_level" AS ENUM ('NORMAL', 'VIGILANCE', 'DANGER', 'EVACUATION');

-- CreateEnum
CREATE TYPE "prediction_origin" AS ENUM ('REGLE', 'IA', 'SIMULATION');

-- CreateEnum
CREATE TYPE "alert_level" AS ENUM ('VIGILANCE', 'DANGER', 'EVACUATION');

-- CreateEnum
CREATE TYPE "alert_status" AS ENUM ('EN_ATTENTE_VALIDATION', 'ACTIVE', 'RESOLUE', 'ANNULEE');

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "geometry" geometry(MultiPolygon,4326) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensors" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(150),
    "zone_id" UUID NOT NULL,
    "position" geometry(Point,4326) NOT NULL,
    "type" "sensor_type" NOT NULL,
    "access_key_hash" VARCHAR(255),
    "status" "sensor_status" NOT NULL DEFAULT 'ACTIF',
    "battery_pct" SMALLINT,
    "last_communication" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sensors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurements" (
    "id" UUID NOT NULL,
    "sensor_id" UUID NOT NULL,
    "measured_at" TIMESTAMPTZ(3) NOT NULL,
    "water_level_cm" DECIMAL(12,3),
    "rain_mm" DECIMAL(12,3),
    "flow_rate" DECIMAL(16,6),
    "battery_pct" SMALLINT,
    "raw_payload" JSONB,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictions" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "risk_score" SMALLINT NOT NULL,
    "risk_level" "risk_level" NOT NULL,
    "probability" DECIMAL(5,4),
    "horizon_hours" DECIMAL(8,2),
    "origin" "prediction_origin" NOT NULL,
    "model_version" VARCHAR(100),
    "input_summary" JSONB,
    "predicted_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "number" VARCHAR(64),
    "zone_id" UUID NOT NULL,
    "prediction_id" UUID,
    "created_by_user_id" UUID,
    "level" "alert_level" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" TEXT NOT NULL,
    "status" "alert_status" NOT NULL DEFAULT 'ACTIVE',
    "requires_validation" BOOLEAN NOT NULL DEFAULT false,
    "validated_by_user_id" UUID,
    "validated_at" TIMESTAMPTZ(3),
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sensors_code_key" ON "sensors"("code");

-- CreateIndex
CREATE INDEX "sensors_zone_id_idx" ON "sensors"("zone_id");

-- CreateIndex
CREATE INDEX "sensors_status_idx" ON "sensors"("status");

-- CreateIndex
CREATE INDEX "measurements_sensor_id_measured_at_idx" ON "measurements"("sensor_id", "measured_at");

-- CreateIndex
CREATE INDEX "measurements_received_at_idx" ON "measurements"("received_at");

-- CreateIndex
CREATE INDEX "predictions_zone_id_predicted_at_idx" ON "predictions"("zone_id", "predicted_at");

-- CreateIndex
CREATE INDEX "predictions_risk_level_predicted_at_idx" ON "predictions"("risk_level", "predicted_at");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_number_key" ON "alerts"("number");

-- CreateIndex
CREATE INDEX "alerts_zone_id_status_starts_at_idx" ON "alerts"("zone_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "alerts_level_status_idx" ON "alerts"("level", "status");

-- Add geospatial indexes and domain constraints not represented in Prisma schema.
CREATE INDEX "zones_geometry_gist_idx" ON "zones" USING GIST ("geometry");
CREATE INDEX "sensors_position_gist_idx" ON "sensors" USING GIST ("position");

ALTER TABLE "sensors"
ADD CONSTRAINT "sensors_battery_pct_range"
CHECK ("battery_pct" IS NULL OR "battery_pct" BETWEEN 0 AND 100);

ALTER TABLE "measurements"
ADD CONSTRAINT "measurements_have_value"
CHECK ("water_level_cm" IS NOT NULL OR "rain_mm" IS NOT NULL OR "flow_rate" IS NOT NULL);

ALTER TABLE "measurements"
ADD CONSTRAINT "measurements_values_non_negative"
CHECK (
    ("water_level_cm" IS NULL OR "water_level_cm" >= 0)
    AND ("rain_mm" IS NULL OR "rain_mm" >= 0)
    AND ("flow_rate" IS NULL OR "flow_rate" >= 0)
    AND ("battery_pct" IS NULL OR "battery_pct" BETWEEN 0 AND 100)
);

ALTER TABLE "predictions"
ADD CONSTRAINT "predictions_risk_score_range"
CHECK ("risk_score" BETWEEN 0 AND 100);

ALTER TABLE "predictions"
ADD CONSTRAINT "predictions_probability_range"
CHECK ("probability" IS NULL OR "probability" BETWEEN 0 AND 1);

ALTER TABLE "predictions"
ADD CONSTRAINT "predictions_horizon_positive"
CHECK ("horizon_hours" IS NULL OR "horizon_hours" > 0);

ALTER TABLE "alerts"
ADD CONSTRAINT "alerts_dates_valid"
CHECK ("ends_at" IS NULL OR "ends_at" >= "starts_at");

-- AddForeignKey
ALTER TABLE "sensors" ADD CONSTRAINT "sensors_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

