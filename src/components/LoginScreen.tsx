import { useState } from "react";
import { useStore } from "../store";

export function LoginScreen() {
  const login = useStore((s) => s.login);
  const register = useStore((s) => s.register);
  const authError = useStore((s) => s.authError);
  const busy = useStore((s) => s.busy);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [clubMode, setClubMode] = useState<"new" | "join">("new");
  const [clubName, setClubName] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "login") {
      login(email, password);
    } else {
      register({
        email,
        password,
        displayName,
        clubName: clubMode === "new" ? clubName : undefined,
        inviteCode: clubMode === "join" ? inviteCode : undefined,
      });
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <span className="brand-dot" />
          <div className="brand-name">Kart Slalom Planner</div>
        </div>
        <p className="hint">Streckenplanung nach ADAC Kartslalom Reglement 2026 – für deinen Verein.</p>

        <div className="tool-group login-tabs">
          <button type="button" className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>
            Anmelden
          </button>
          <button type="button" className={mode === "register" ? "on" : ""} onClick={() => setMode("register")}>
            Registrieren
          </button>
        </div>

        {mode === "register" && (
          <label>
            Name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required autoFocus />
          </label>
        )}
        <label>
          E-Mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus={mode === "login"}
            autoComplete="email"
          />
        </label>
        <label>
          Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>

        {mode === "register" && (
          <>
            <div className="field-row">
              <label className="radio">
                <input type="radio" checked={clubMode === "new"} onChange={() => setClubMode("new")} />
                Neuen Verein gründen
              </label>
              <label className="radio">
                <input type="radio" checked={clubMode === "join"} onChange={() => setClubMode("join")} />
                Verein beitreten
              </label>
            </div>
            {clubMode === "new" ? (
              <label>
                Vereinsname
                <input value={clubName} onChange={(e) => setClubName(e.target.value)} required placeholder="z. B. MSC Musterstadt e.V." />
              </label>
            ) : (
              <label>
                Einladungscode
                <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required placeholder="vom Vereins-Admin" />
              </label>
            )}
          </>
        )}

        {authError && <p className="login-error">{authError}</p>}

        <button className="primary login-submit" type="submit" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Anmelden" : "Konto erstellen"}
        </button>
      </form>
    </div>
  );
}
