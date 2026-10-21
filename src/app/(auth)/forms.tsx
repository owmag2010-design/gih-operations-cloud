"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ActionFeedback, fieldError, SubmitButton } from "@/components/ui/forms";
import { Button, Field, Input, Notice } from "@/components/ui/primitives";
import type { ActionResult } from "@/server/errors";
import {
  acceptInvitationAction,
  changePasswordAction,
  confirmMfaAction,
  disableMfaAction,
  mfaChallengeAction,
  requestResetAction,
  resetPasswordAction,
  signInAction,
  startMfaAction,
} from "./actions";

export function SignInForm() {
  const [state, action] = useActionState(signInAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <ActionFeedback state={state} />
      <Field label="Email" name="email">
        <Input type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password" name="password">
        <Input type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton pendingText="Signing in…" className="w-full">Sign in</SubmitButton>
      <Link href="/reset-password" className="text-[13px] text-accent hover:underline">Forgotten your password?</Link>
    </form>
  );
}

export function MfaChallengeForm() {
  const [state, action] = useActionState(mfaChallengeAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <ActionFeedback state={state} />
      <Field label="Code" name="code" hint="The 6-digit code from your authenticator app, or one of your recovery codes.">
        <Input inputMode="text" autoComplete="one-time-code" required autoFocus maxLength={20} className="num tracking-widest" />
      </Field>
      <SubmitButton pendingText="Checking…" className="w-full">Continue</SubmitButton>
    </form>
  );
}

export function AcceptInvitationForm({ token, name, existingAccount, email }: { token: string; name: string; existingAccount: boolean; email: string }) {
  const [state, action] = useActionState(acceptInvitationAction.bind(null, token), null);
  if (existingAccount) {
    return (
      <form action={action} className="flex flex-col gap-4">
        <ActionFeedback state={state} />
        <Notice>You already have an account as {email}. Sign in with it first, then open this link again to accept.</Notice>
        <SubmitButton pendingText="Accepting…">Accept invitation</SubmitButton>
        <Link href="/login" className="text-[13px] text-accent hover:underline">Sign in</Link>
      </form>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <ActionFeedback state={state} />
      <Field label="Your name" name="name" error={fieldError(state, "name")}>
        <Input defaultValue={name} required autoComplete="name" />
      </Field>
      <Field label="Choose a password" name="password" hint="At least 12 characters. A short phrase is easiest to remember." error={fieldError(state, "password")}>
        <Input type="password" autoComplete="new-password" required minLength={12} />
      </Field>
      <SubmitButton pendingText="Creating your account…" className="w-full">Create account</SubmitButton>
    </form>
  );
}

export function RequestResetForm() {
  const [state, action] = useActionState(requestResetAction, null);
  if (state?.ok) return <Notice tone="ok">{state.message}</Notice>;
  return (
    <form action={action} className="flex flex-col gap-4">
      <ActionFeedback state={state} />
      <Field label="Email" name="email">
        <Input type="email" autoComplete="username" required autoFocus />
      </Field>
      <SubmitButton pendingText="Sending…" className="w-full">Send reset link</SubmitButton>
      <Link href="/login" className="text-[13px] text-accent hover:underline">Back to sign in</Link>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction.bind(null, token), null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <ActionFeedback state={state} />
      <Field label="New password" name="password" hint="At least 12 characters." error={fieldError(state, "password")}>
        <Input type="password" autoComplete="new-password" required minLength={12} autoFocus />
      </Field>
      <Field label="Confirm new password" name="confirm" error={fieldError(state, "confirm")}>
        <Input type="password" autoComplete="new-password" required />
      </Field>
      <SubmitButton pendingText="Saving…" className="w-full">Set password</SubmitButton>
    </form>
  );
}

/* ───────── Account security ───────── */

export function MfaSetup({ enabled, mandatory }: { enabled: boolean; mandatory: boolean }) {
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, action] = useActionState(confirmMfaAction, null);
  const [disableState, disable] = useActionState(disableMfaAction, null);

  if (state?.ok && state.data?.codes) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="ok">Two-step sign-in is on. Save these recovery codes somewhere safe. Each works once if you lose your phone. They won&apos;t be shown again.</Notice>
        <ul className="num grid grid-cols-2 gap-1.5 rounded-md border border-hairline bg-sunken p-3 font-medium tracking-wider text-ink">
          {state.data.codes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <div><Button asChild variant="primary"><a href="/">Continue</a></Button></div>
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">Two-step sign-in is on for your account.</p>
        {mandatory ? (
          <p className="text-[13px] text-muted">Your role requires it, so it stays on.</p>
        ) : (
          <form action={disable} className="flex max-w-sm flex-col gap-3">
            <ActionFeedback state={disableState} />
            <Field label="Confirm with your password to turn it off" name="password">
              <Input type="password" autoComplete="current-password" required />
            </Field>
            <div><SubmitButton variant="danger" pendingText="Turning off…">Turn off two-step sign-in</SubmitButton></div>
          </form>
        )}
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-ink-2">Use an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password) to add a 6-digit code to every sign-in.</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button
          variant="primary"
          onClick={async () => {
            const r = await startMfaAction();
            if (r.ok && r.data) setSetup(r.data);
            else if (!r.ok) setError(r.error);
          }}
        >
          Set up two-step sign-in
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qr} alt="QR code to add this account to your authenticator app" width={176} height={176} className="rounded-md border border-hairline" />
      <form action={action} className="flex max-w-sm flex-1 flex-col gap-3">
        <p className="text-[13px] text-ink-2">Scan the code with your app. If you can&apos;t scan, enter this key: <span className="num font-medium break-all text-ink">{setup.secret}</span></p>
        <ActionFeedback state={state} />
        <Field label="Code from the app" name="code">
          <Input inputMode="numeric" autoComplete="one-time-code" required maxLength={7} className="num tracking-widest" autoFocus />
        </Field>
        <div><SubmitButton pendingText="Checking…">Turn on</SubmitButton></div>
      </form>
    </div>
  );
}

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, null as ActionResult | null);
  return (
    <form action={action} className="flex max-w-sm flex-col gap-3">
      <ActionFeedback state={state} />
      <Field label="Current password" name="current" error={fieldError(state, "current")}>
        <Input type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" name="password" hint="At least 12 characters." error={fieldError(state, "password")}>
        <Input type="password" autoComplete="new-password" required minLength={12} />
      </Field>
      <Field label="Confirm new password" name="confirm" error={fieldError(state, "confirm")}>
        <Input type="password" autoComplete="new-password" required />
      </Field>
      <div><SubmitButton>Change password</SubmitButton></div>
    </form>
  );
}
