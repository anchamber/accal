<script lang="ts">
  import type { JumpDay, AssignmentRole, Assignment } from "@accal/shared";
  import { signup, withdraw, updateJumpDay } from "../lib/api.ts";
  import { getUser, hasRole } from "../lib/auth.svelte.ts";
  import { toastError } from "../lib/toast.svelte.ts";
  import { getRoleConfigs, getRoleConfig } from "../lib/roles.svelte.ts";

  interface Props {
    jumpDay: JumpDay;
    onclose: () => void;
    ondelete: (id: string) => void;
    onrefresh: () => Promise<void>;
  }

  let { jumpDay, onclose, ondelete, onrefresh }: Props = $props();

  let editingNotes = $state(false);
  let notesValue = $state(jumpDay.notes ?? "");

  const user = $derived(getUser());

  function assignmentsForRole(role: AssignmentRole): Assignment[] {
    return jumpDay.assignments.filter((a) => a.role === role);
  }

  function isSignedUp(role: AssignmentRole): boolean {
    return jumpDay.assignments.some((a) => a.role === role && a.user.id === user?.id);
  }

  function canSignup(role: AssignmentRole): boolean {
    if (!hasRole(role) || isSignedUp(role)) return false;
    const config = getRoleConfig(role);
    if (config.maxPerDay !== null) {
      const current = assignmentsForRole(role).length;
      if (current >= config.maxPerDay) return false;
    }
    return true;
  }

  async function handleSignup(role: AssignmentRole) {
    try {
      await signup(jumpDay.id, role);
      await onrefresh();
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  async function handleWithdraw(role: AssignmentRole) {
    try {
      await withdraw(jumpDay.id, role);
      await onrefresh();
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  async function saveNotes() {
    try {
      await updateJumpDay(jumpDay.id, { notes: notesValue || null });
      editingNotes = false;
      onclose();
    } catch (e) {
      toastError((e as Error).message);
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

      <!-- Role Sections -->
      {#each getRoleConfigs() as config}
        {@const role = config.role}
        {@const roleAssignments = assignmentsForRole(role)}
        <div class="section">
          <h4>
            {config.label}
            {#if config.requirement === "required"}
              <span class="req-badge req-required" title="Required for jumping">required</span>
            {:else if config.requirement === "limiting"}
              <span class="req-badge req-limiting" title="Limits possibilities when missing">limiting</span>
            {/if}
          </h4>
          {#if roleAssignments.length > 0}
            {#each roleAssignments as assignment}
              <div class="assignment">
                <span class="assigned-user">
                  {#if assignment.user.avatarUrl}
                    <img src={assignment.user.avatarUrl} alt="" class="avatar" />
                  {/if}
                  {assignment.user.name}
                </span>
                {#if assignment.user.id === user?.id}
                  <button class="btn btn-sm btn-danger" onclick={() => handleWithdraw(role)}>
                    Withdraw
                  </button>
                {/if}
              </div>
            {/each}
          {:else}
            <p class="unassigned">Not assigned</p>
          {/if}
          {#if canSignup(role)}
            <button class="btn btn-primary btn-sm" style="margin-top: 0.25rem;" onclick={() => handleSignup(role)}>
              Sign Up
            </button>
          {/if}
        </div>
      {/each}

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
