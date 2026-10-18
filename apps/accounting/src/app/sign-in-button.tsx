"use client";

import { signIn, signOut } from "next-auth/react";

export function GoogleSignInButton() {
  return (
    <button className="google-button" type="button" onClick={() => signIn("google", { callbackUrl: "/" })}>
      <GoogleMark />
      <span>Continue with Google</span>
    </button>
  );
}

export function SignOutButton() {
  return (
    <button className="sign-out-button" type="button" onClick={() => signOut({ callbackUrl: "/" })}>
      Sign out
    </button>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="google-mark">
      <path fill="#4285F4" d="M43.6 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11a9.4 9.4 0 0 1-4.1 6.2v5.2h6.7c3.9-3.6 6-9 6-15.6Z" />
      <path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.7-5.2c-1.8 1.2-4 1.9-6.8 1.9-5.2 0-9.6-3.5-11.2-8.2H5.9v5.3A20 20 0 0 0 24 44Z" />
      <path fill="#FBBC05" d="M12.8 27.6a12 12 0 0 1 0-7.2v-5.3H5.9a20 20 0 0 0 0 17.8l6.9-5.3Z" />
      <path fill="#EA4335" d="M24 12.2c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 6 29.5 4 24 4A20 20 0 0 0 5.9 15.1l6.9 5.3c1.6-4.7 6-8.2 11.2-8.2Z" />
    </svg>
  );
}
