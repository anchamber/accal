<script lang="ts">
  import { startRegistration } from "@simplewebauthn/browser";
  import type { PasskeyCredential } from "@accal/shared";
  import {
    listPasskeys,
    getPasskeyRegisterOptions,
    verifyPasskeyRegistration,
    deletePasskey,
  } from "../lib/api.ts";
  import { getUser } from "../lib/auth.svelte.ts";

  let passkeys = $state<PasskeyCredential[]>([]);
  let loading = $state(true);
  let registering = $state(false);
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);

  async function loadPasskeys() {
    loading = true;
    try {
      passkeys = await listPasskeys();
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to load passkeys";
    } finally {
      loading = false;
    }
  }

  async function registerPasskey() {
    registering = true;
    error = null;
    success = null;
    try {
      const options = await getPasskeyRegisterOptions();
      const credential = await startRegistration({ optionsJSON: options });
      await verifyPasskeyRegistration(credential);
      success = "Passkey registered successfully";
      await loadPasskeys();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        error = null; // User cancelled
      } else {
        error = err instanceof Error ? err.message : "Failed to register passkey";
      }
    } finally {
      registering = false;
    }
  }

  async function removePasskey(id: string) {
    error = null;
    success = null;
    try {
      await deletePasskey(id);
      await loadPasskeys();
      success = "Passkey removed";
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to remove passkey";
    }
  }

  loadPasskeys();

  const user = $derived(getUser());
</script>

<div class="account-page">
  <h2>Account</h2>

  <div class="account-section">
    <h3>Profile</h3>
    <div class="profile-info">
      <div class="profile-row">
        <span class="label">Name</span>
        <span>{user?.name}</span>
      </div>
      <div class="profile-row">
        <span class="label">Email</span>
        <span>{user?.email}</span>
      </div>
      {#if user?.oauthProvider}
        <div class="profile-row">
          <span class="label">OAuth</span>
          <span class="provider-badge">{user.oauthProvider}</span>
        </div>
      {/if}
    </div>
  </div>

  <div class="account-section">
    <h3>Passkeys</h3>
    <p class="section-desc">
      Passkeys let you sign in securely using your device's biometrics or PIN.
    </p>

    {#if error}
      <div class="error">{error}</div>
    {/if}
    {#if success}
      <div class="success">{success}</div>
    {/if}

    {#if loading}
      <p class="text-muted">Loading...</p>
    {:else}
      {#if passkeys.length > 0}
        <div class="passkey-list">
          {#each passkeys as pk (pk.id)}
            <div class="passkey-item">
              <div class="passkey-info">
                <span class="passkey-name">{pk.name}</span>
                <span class="passkey-date">Added {new Date(pk.createdAt).toLocaleDateString()}</span>
              </div>
              <button class="btn btn-sm btn-danger" onclick={() => removePasskey(pk.id)}>
                Remove
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-muted">No passkeys registered yet.</p>
      {/if}

      <button
        class="btn btn-primary"
        onclick={registerPasskey}
        disabled={registering}
        style="margin-top: 0.75rem;"
      >
        {registering ? "Registering..." : "Register new passkey"}
      </button>
    {/if}
  </div>
</div>
