"use client";

import { useActionState, useState } from "react";
import type { LinkInfo } from "@/server/modules/portal/client";
import { requestCodeAction, verifyCodeAction, type PortalFormState } from "./actions";

/* eslint-disable @next/next/no-img-element */
export function SignIn({ token, info }: { token: string; info: LinkInfo | null }) {
  const [sendState, send, sending] = useActionState<PortalFormState>(requestCodeAction.bind(null, token), null);
  const [verifyState, verify, verifying] = useActionState<PortalFormState, FormData>(verifyCodeAction.bind(null, token), null);
  const [restart, setRestart] = useState(false);
  const step = !restart && (sendState?.step === "code" || verifyState?.step === "code") ? "code" : "start";
  const note = step === "code" ? (verifyState && !verifyState.ok ? verifyState : sendState) : sendState;

  return (
    <div className="gp">
      <div className="gp-signin">
        <section className="art">
          <img src="/brand/gih-logo-horizontal-white.svg" alt="Global Immigration Hub" />
          <div>
            <p className="gp-kicker">Your application portal</p>
            <h1 className="disp">{info ? <>Welcome, {info.firstName}.</> : "This link isn't active"}</h1>
            <p>{info ? `Follow your application with ${info.firm}, see what we still need, and message your team.` : "It may have been replaced with a newer link. Please contact your team for a current one."}</p>
          </div>
        </section>
        <section className="form">
          {info ? (
            <div className="box">
              {step === "start" ? (
                <form action={send} className="box" onSubmit={() => setRestart(false)}>
                  <h2>Sign in with a code</h2>
                  <p className="gp-lede">We&apos;ll email a six-digit code to <b>{info.emailHint}</b>. There is no password.</p>
                  <button className="gp-btn red" disabled={sending}>{sending ? "Sending…" : "Email me a code"}</button>
                </form>
              ) : (
                <form action={verify} className="box">
                  <h2>Enter your code</h2>
                  <p className="gp-lede">Check your email at {info.emailHint}. The code expires in 15 minutes.</p>
                  <label htmlFor="portal-code" className="gp-eyebrow">Six-digit code</label>
                  <input id="portal-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
                  <button className="gp-btn red" disabled={verifying}>{verifying ? "Checking…" : "Open my portal"}</button>
                  <button type="button" className="gp-link" onClick={() => setRestart(true)}>Send a new code</button>
                </form>
              )}
              {note?.message ? <p className={`gp-note ${note.ok ? "ok" : "err"}`} role="status">{note.message}</p> : null}
              <p className="gp-hint">This portal is private to you. Never share your code; our team will never ask for it.</p>
            </div>
          ) : (
            <div className="box">
              <h2>Need help?</h2>
              <p className="gp-lede">Email hello@thegih.com or message us on WhatsApp at +61 490 836 628 and we&apos;ll send you a new link.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
