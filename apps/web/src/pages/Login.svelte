<script lang="ts">
  import { startAuthentication } from "@simplewebauthn/browser";
  import { sendMagicLink, getPasskeyLoginOptions, verifyPasskeyLogin } from "../lib/api.ts";
  import { checkAuth } from "../lib/auth.svelte.ts";
  import { toastError } from "../lib/toast.svelte.ts";

  const googleEnabled = true;
  const githubEnabled = true;

  let email = $state("");
  let magicLinkSent = $state(false);
  let magicLinkLoading = $state(false);
  let passkeyLoading = $state(false);

  async function handleMagicLink(e: Event) {
    e.preventDefault();
    if (!email.trim()) return;

    magicLinkLoading = true;
    try {
      await sendMagicLink(email.trim());
      magicLinkSent = true;
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to send magic link");
    } finally {
      magicLinkLoading = false;
    }
  }

  async function handlePasskeyLogin() {
    passkeyLoading = true;
    try {
      const options = await getPasskeyLoginOptions();
      const credential = await startAuthentication({ optionsJSON: options });
      await verifyPasskeyLogin(credential);
      await checkAuth();
    } catch (err) {
      if (!(err instanceof Error && err.name === "NotAllowedError")) {
        toastError(err instanceof Error ? err.message : "Passkey authentication failed");
      }
    } finally {
      passkeyLoading = false;
    }
  }
</script>

<div class="login-page">
  <div class="login-card">
    <h1>accal</h1>
    <p class="subtitle">Dropzone Calendar</p>

    {#if magicLinkSent}
      <div class="magic-link-sent">
        <p>Check your email!</p>
        <p class="sent-detail">We sent a sign-in link to <strong>{email}</strong></p>
        <button class="btn" onclick={() => { magicLinkSent = false; error = null; }}>
          Back to login
        </button>
      </div>
    {:else}
      <!-- Magic Link -->
      <form class="magic-link-form" onsubmit={handleMagicLink}>
        <input
          type="email"
          placeholder="your@email.com"
          bind:value={email}
          required
        />
        <button class="btn btn-primary" type="submit" disabled={magicLinkLoading}>
          {magicLinkLoading ? "Sending..." : "Sign in with Email"}
        </button>
      </form>

      <div class="divider">
        <span>or</span>
      </div>

      <!-- Passkey -->
      <button
        class="btn btn-oauth btn-passkey"
        onclick={handlePasskeyLogin}
        disabled={passkeyLoading}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M12 2C9.24 2 7 4.24 7 7s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 2c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm-1 10c-3.33 0-10 1.67-10 5v2h12v-2.76c1.09-.52 2.11-1.15 2.97-1.88l1.12 1.12L18.5 19l-1.41-1.41-1.12-1.12c-.57.46-1.18.86-1.83 1.18L14 17.76V19H3v-1c0-1.1 2.69-3 8-3h1z"/>
          <path d="M20.71 14.29l-2.12-2.12a1 1 0 00-1.42 0l-.7.71 2.12 2.12.71-.7a1 1 0 000-1.42l.7-.71z"/>
        </svg>
        {passkeyLoading ? "Waiting..." : "Sign in with Passkey"}
      </button>

      <div class="divider">
        <span>or</span>
      </div>

      <!-- OAuth -->
      <div class="login-buttons">
        {#if googleEnabled}
          <a href="/api/auth/login/google" class="btn btn-oauth btn-google">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </a>
        {/if}
        {#if githubEnabled}
          <a href="/api/auth/login/github" class="btn btn-oauth btn-github">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
            </svg>
            Sign in with GitHub
          </a>
        {/if}
      </div>
    {/if}
  </div>
</div>
