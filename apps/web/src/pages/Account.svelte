<script lang="ts">
  import { startRegistration } from "@simplewebauthn/browser";
  import type { PasskeyCredential } from "@accal/shared";
  import {
    listPasskeys,
    getPasskeyRegisterOptions,
    verifyPasskeyRegistration,
    deletePasskey,
    updateMyName,
  } from "../lib/api.ts";
  import { getUser, setUserName } from "../lib/auth.svelte.ts";
  import { toastSuccess, toastError } from "../lib/toast.svelte.ts";

  let passkeys = $state<PasskeyCredential[]>([]);
  let loading = $state(true);
  let registering = $state(false);
  let editingName = $state(false);
  let nameInput = $state("");
  let savingName = $state(false);

  function startEditName() {
    nameInput = getUser()?.name ?? "";
    editingName = true;
  }

  async function saveName() {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === getUser()?.name) {
      editingName = false;
      return;
    }
    savingName = true;
    try {
      await updateMyName(trimmed);
      setUserName(trimmed);
      toastSuccess("Name updated");
      editingName = false;
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to update name");
    } finally {
      savingName = false;
    }
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") saveName();
    else if (e.key === "Escape") editingName = false;
  }

  async function loadPasskeys() {
    loading = true;
    try {
      passkeys = await listPasskeys();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to load passkeys");
    } finally {
      loading = false;
    }
  }

  async function registerPasskey() {
    registering = true;
    try {
      const options = await getPasskeyRegisterOptions();
      const credential = await startRegistration({ optionsJSON: options });
      await verifyPasskeyRegistration(credential);
      toastSuccess("Passkey registered successfully");
      await loadPasskeys();
    } catch (err) {
      if (!(err instanceof Error && err.name === "NotAllowedError")) {
        toastError(err instanceof Error ? err.message : "Failed to register passkey");
      }
    } finally {
      registering = false;
    }
  }

  async function removePasskey(id: string) {
    try {
      await deletePasskey(id);
      await loadPasskeys();
      toastSuccess("Passkey removed");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to remove passkey");
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
        {#if editingName}
          <input
            class="name-input"
            type="text"
            bind:value={nameInput}
            onkeydown={handleNameKeydown}
            disabled={savingName}
          />
          <button class="btn btn-sm btn-primary" onclick={saveName} disabled={savingName}>
            {savingName ? "..." : "Save"}
          </button>
          <button class="btn btn-sm" onclick={() => (editingName = false)} disabled={savingName}>
            Cancel
          </button>
        {:else}
          <span>{user?.name}</span>
          <button class="btn-icon" onclick={startEditName} title="Edit name">&#9998;</button>
        {/if}
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
