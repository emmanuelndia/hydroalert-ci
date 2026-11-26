/**
 * Affiche la base visee par DATABASE_URL (hote et nom uniquement, jamais les identifiants)
 * et refuse d'ecrire sur une base distante sans l'option --remote explicite.
 */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function describeTargetDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL n'est pas definie.");
  const parsed = new URL(url);
  return {
    label: `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`,
    isLocal: LOCAL_HOSTS.has(parsed.hostname),
  };
}

export function assertWritableTarget(options: { remote: boolean }) {
  const target = describeTargetDatabase();
  console.log(`Base cible : ${target.label}${target.isLocal ? " (locale)" : " (DISTANTE)"}`);
  if (!target.isLocal && !options.remote) {
    console.error(
      "Refus : la base cible n'est pas locale. Relancer avec --remote pour confirmer l'ecriture sur cette base.",
    );
    process.exit(1);
  }
  return target;
}
