import { Logo } from "@/components/Logo";
import { safeNextPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ fout?: string; next?: string }>;
}) {
  const params = await searchParams;
  const configured = Boolean(process.env.DASHBOARD_PASSWORD);
  const nextPath = safeNextPath(params.next ?? "/");

  return (
    <main className="auth">
      <form className="auth-card" action="/api/login" method="post">
        <Logo />
        <p className="eyebrow">Brandhouse Partners</p>
        <h1>Go Gember voorraad</h1>
        <p>Alleen voor Luuk. Vul het wachtwoord in om de voorraad te zien.</p>
        {!configured ? (
          <p className="fault">DASHBOARD_PASSWORD is nog niet ingesteld op de server.</p>
        ) : null}
        {params.fout && configured ? <p className="fault">Onjuist wachtwoord.</p> : null}
        <input type="hidden" name="next" value={nextPath} />
        <label htmlFor="password">Wachtwoord</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required disabled={!configured} />
        <button className="submit" type="submit" disabled={!configured}>
          Open de voorraad
        </button>
      </form>
    </main>
  );
}
