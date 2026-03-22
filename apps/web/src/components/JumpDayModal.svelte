<script lang="ts">
  import type { JumpDay } from "@accal/shared";
  import { signup, withdraw, updateJumpDay } from "../lib/api.ts";
  import { getUser, hasRole } from "../lib/auth.svelte.ts";

  interface Props {
    jumpDay: JumpDay;
    onclose: () => void;
    ondelete: (id: string) => void;
  }

  let { jumpDay, onclose, ondelete }: Props = $props();

  let error = $state<string | null>(null);
  let editingNotes = $state(false);
  let notesValue = $state(jumpDay.notes ?? "");

  const sdlAssignment = $derived(
    jumpDay.assignments.find((a) => a.role === "sdl"),
  );
  const manifestAssignment = $derived(
    jumpDay.assignments.find((a) => a.role === "manifest"),
  );
  const user = $derived(getUser());

  const canSignupSDL = $derived(
    hasRole("sdl") && !sdlAssignment,
  );
  const canSignupManifest = $derived(
    hasRole("manifest") && !manifestAssignment,
  );
  const isMySDL = $derived(
    sdlAssignment?.user.id === user?.id,
  );
  const isMyManifest = $derived(
    manifestAssignment?.user.id === user?.id,
  );

  async function handleSignup(role: "sdl" | "manifest") {
    error = null;
    try {
      await signup(jumpDay.id, role);
      onclose();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function handleWithdraw(role: "sdl" | "manifest") {
    error = null;
    try {
      await withdraw(jumpDay.id, role);
      onclose();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function saveNotes() {
    try {
      await updateJumpDay(jumpDay.id, { notes: notesValue || null });
      editingNotes = false;
      onclose();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("default", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onclose}>
  <div class="modal" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h3>{formatDate(jumpDay.date)}</h3>
      <button class="btn btn-sm" onclick={onclose}>X</button>
    </div>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    <div class="modal-body">
      <!-- Notes -->
      <div class="section">
        <h4>Notes</h4>
        {#if editingNotes && hasRole("admin")}
          <div class="notes-edit">
            <textarea bind:value={notesValue} rows="3"></textarea>
            <div class="btn-group">
              <button class="btn btn-primary btn-sm" onclick={saveNotes}>Save</button>
              <button class="btn btn-sm" onclick={() => { editingNotes = false }}>Cancel</button>
            </div>
          </div>
        {:else}
          <p class="notes-text">{jumpDay.notes || "No notes"}</p>
          {#if hasRole("admin")}
            <button class="btn btn-sm" onclick={() => { editingNotes = true }}>Edit</button>
          {/if}
        {/if}
      </div>

      <!-- SDL -->
      <div class="section">
        <h4>Sprungdienstleiter (SDL)</h4>
        {#if sdlAssignment}
          <div class="assignment">
            <span class="assigned-user">
              {#if sdlAssignment.user.avatarUrl}
                <img src={sdlAssignment.user.avatarUrl} alt="" class="avatar" />
              {/if}
              {sdlAssignment.user.name}
            </span>
            {#if isMySDL}
              <button class="btn btn-sm btn-danger" onclick={() => handleWithdraw("sdl")}>
                Withdraw
              </button>
            {/if}
          </div>
        {:else}
          <p class="unassigned">Not assigned</p>
          {#if canSignupSDL}
            <button class="btn btn-primary btn-sm" onclick={() => handleSignup("sdl")}>
              Sign Up
            </button>
          {/if}
        {/if}
      </div>

      <!-- Manifest -->
      <div class="section">
        <h4>Manifest</h4>
        {#if manifestAssignment}
          <div class="assignment">
            <span class="assigned-user">
              {#if manifestAssignment.user.avatarUrl}
                <img src={manifestAssignment.user.avatarUrl} alt="" class="avatar" />
              {/if}
              {manifestAssignment.user.name}
            </span>
            {#if isMyManifest}
              <button class="btn btn-sm btn-danger" onclick={() => handleWithdraw("manifest")}>
                Withdraw
              </button>
            {/if}
          </div>
        {:else}
          <p class="unassigned">Not assigned</p>
          {#if canSignupManifest}
            <button class="btn btn-primary btn-sm" onclick={() => handleSignup("manifest")}>
              Sign Up
            </button>
          {/if}
        {/if}
      </div>

      {#if hasRole("admin")}
        <div class="section danger-zone">
          <button class="btn btn-danger" onclick={() => ondelete(jumpDay.id)}>
            Delete Jump Day
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>
