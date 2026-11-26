-- Idempotence provisoire des mesures : une seule mesure par capteur et par date de mesure.
-- L'index unique remplace l'index simple sur les memes colonnes (historique par capteur).

-- DropIndex
DROP INDEX "measurements_sensor_id_measured_at_idx";

-- CreateIndex
CREATE UNIQUE INDEX "measurements_sensor_id_measured_at_key" ON "measurements"("sensor_id", "measured_at");

