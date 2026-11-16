import { useState } from "react";
import { createPortal } from "react-dom";
import {
  MAX_PASSWORD,
  MAX_REPORT_NOTE,
  REPORT_REASONS,
  type ReportReason,
} from "@arcane/protocol";
import { useClient, useClientState, useT } from "./context";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** "⋯" next to a logged-in player's name: block/unblock or report them. Hidden for guests and for myself. */
export function PlayerMenu({ username }: { username: string }) {
  const client = useClient();
  const t = useT();
  const { account, blocked, reported, socialError } = useClientState();
  const [open, setOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReportReason>("cheating");
  const [note, setNote] = useState("");
  if (!account || same(username, account)) return null;
  const isBlocked = !!blocked?.some((b) => same(b, username));
  const label = t("playerOptions", { name: username });
  const close = () => {
    setOpen(false);
    setReporting(false);
    setNote("");
    client.clearReported();
  };

  return (
    <>
      <button
        type="button"
        className="link pm-btn"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          client.clearReported();
          client.clearSocialError();
          setOpen(true);
        }}
      >
        ⋯
      </button>
      {open &&
        // On <body>: a seat card's backdrop-filter would otherwise trap the fixed sheet inside the card.
        createPortal(
          <div className="sheet-backdrop" onClick={close}>
            <section
              className="sheet pm-sheet"
              role="dialog"
              aria-label={label}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="sheet-head">
                <h3>
                  {reporting ? t("reportTitle", { name: username }) : username}
                </h3>
                {isBlocked && <span className="tag">{t("blockedTag")}</span>}
              </header>
              {reported && same(reported, username) ? (
                <p role="status">{t("reportSent", { name: username })}</p>
              ) : reporting ? (
                <form
                  className="pm-report"
                  onSubmit={(e) => {
                    e.preventDefault();
                    client.report(username, reason, note.trim());
                  }}
                >
                  <label className="field">
                    <span>{t("reportReason")}</span>
                    <select
                      aria-label={t("reportReason")}
                      value={reason}
                      onChange={(e) =>
                        setReason(e.target.value as ReportReason)
                      }
                    >
                      {REPORT_REASONS.map((r) => (
                        <option key={r} value={r}>
                          {t(`reason_${r}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>{t("reportNote")}</span>
                    <textarea
                      aria-label={t("reportNote")}
                      value={note}
                      maxLength={MAX_REPORT_NOTE}
                      rows={3}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <span className="small muted">{`${note.length}/${MAX_REPORT_NOTE}`}</span>
                  </label>
                  <button className="primary" type="submit">
                    {t("reportSend")}
                  </button>
                </form>
              ) : (
                <>
                  <p className="muted small">{t("blockExplain")}</p>
                  <div className="row stretch">
                    <button
                      className={isBlocked ? "" : "danger"}
                      onClick={() =>
                        isBlocked
                          ? client.unblock(username)
                          : client.block(username)
                      }
                    >
                      {isBlocked ? t("unblock") : t("block")}
                    </button>
                    <button onClick={() => setReporting(true)}>
                      {t("report")}
                    </button>
                  </div>
                </>
              )}
              {socialError && (
                <div className="banner banner-error" role="alert">
                  <span>{t(`error_${socialError.code}`)}</span>
                </div>
              )}
              <button className="link" onClick={close}>
                {t("close")}
              </button>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Accounts I blocked, each with Unblock. */
export function BlockedList() {
  const client = useClient();
  const t = useT();
  const { blocked } = useClientState();
  return (
    <section className="panel">
      <h3>{t("blockedPlayers")}</h3>
      {!blocked?.length ? (
        <p className="muted small">{t("noBlocked")}</p>
      ) : (
        <ul className="seats" aria-label={t("blockedPlayers")}>
          {blocked.map((u) => (
            <li key={u} className="seat">
              <div className="seat-top">
                <span className="name">{u}</span>
                <button onClick={() => client.unblock(u)}>
                  {t("unblock")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Make a new recovery code (needs the current password). */
export function RecoverySection() {
  const client = useClient();
  const t = useT();
  const { accountPending } = useClientState();
  const [password, setPassword] = useState("");
  return (
    <form
      className="subpanel"
      onSubmit={(e) => {
        e.preventDefault();
        if (!password || accountPending) return;
        client.createRecoveryCode(password);
        setPassword("");
      }}
    >
      <h4>{t("recoveryCode")}</h4>
      <p className="small muted">{t("recoveryCreateHint")}</p>
      {/* Not a <label>: the change-password form above already has a "Current password" label. */}
      <div className="field">
        <span aria-hidden="true">{t("currentPassword")}</span>
        <input
          aria-label={`${t("recoveryCode")}: ${t("currentPassword")}`}
          type="password"
          value={password}
          maxLength={MAX_PASSWORD}
          autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <button type="submit" disabled={!password || accountPending}>
        {t("createRecovery")}
      </button>
    </form>
  );
}

/** A new recovery code, over every screen until the player says it is saved. */
export function RecoveryCodeDialog() {
  const client = useClient();
  const t = useT();
  const { recoveryCode } = useClientState();
  const [copied, setCopied] = useState(false);
  if (!recoveryCode) return null;
  return (
    <div className="sheet-backdrop">
      <section
        className="sheet recovery-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("recoveryTitle")}
      >
        <header className="sheet-head">
          <h3>{t("recoveryTitle")}</h3>
        </header>
        <p className="small">{t("recoveryExplain")}</p>
        <code className="recovery-code" aria-label={t("recoveryCode")}>
          {recoveryCode}
        </code>
        <div className="row stretch">
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(recoveryCode);
                setCopied(true);
              } catch {
                // No clipboard (old browser or no permission): the code is on screen to write down.
              }
            }}
          >
            {copied ? t("copied") : t("copy")}
          </button>
          <button
            className="primary"
            onClick={() => {
              setCopied(false);
              client.clearRecoveryCode();
            }}
          >
            {t("savedIt")}
          </button>
        </div>
      </section>
    </div>
  );
}
