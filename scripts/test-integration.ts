/**
 * Lance les tests d'integration sur la base TEST_DATABASE_URL :
 * 1. applique les migrations (prisma migrate deploy),
 * 2. charge les donnees fictives (prisma db seed),
 * 3. execute tests/integration/*.test.ts.
 *
 * Refuse de s'executer si TEST_DATABASE_URL est absente ou identique a DATABASE_URL.
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error("TEST_DATABASE_URL n'est pas definie (voir .env.example).");
  process.exit(1);
}
if (testUrl === process.env.DATABASE_URL) {
  console.error("TEST_DATABASE_URL doit designer une base distincte de DATABASE_URL.");
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: testUrl };
const steps = [
  "pnpm exec prisma migrate deploy",
  "pnpm exec prisma db seed",
  // Un fichier a la fois : les tests partagent la meme base.
  'pnpm exec tsx --test --test-concurrency=1 "tests/integration/**/*.test.ts"',
];

for (const command of steps) {
  console.log(`\n> ${command}`);
  const result = spawnSync(command, { stdio: "inherit", shell: true, env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
