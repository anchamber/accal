<script lang="ts">
  import type { User, Role, RoleConfig } from "@accal/shared";
  import { ROLES } from "@accal/shared";
  import {
    fetchUsers,
    updateUserRoles,
    updateRoleConfig,
    deleteUserPreview,
    deleteUser,
  } from "../lib/api.ts";
  import { getUser as getAuthUser } from "../lib/auth.svelte.ts";
  import { getRoleConfigs, getRoleConfig, refreshRoleConfig } from "../lib/roles.svelte.ts";
  import { toastSuccess, toastError } from "../lib/toast.svelte.ts";

  let users = $state<(User & { oauthProvider: string })[]>([]);
  let loading = $state(true);
  let openDropdown = $state<string | null>(null);
  let dropdownPos = $state({ top: 0, left: 0 });

  async function loadUsers() {
    loading = true;
    try {
      users = await fetchUsers();
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      loading = false;
    }
  }

  async function setRoles(userId: string, newRoles: Role[]) {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    try {
      await updateUserRoles(userId, newRoles);
      user.roles = newRoles;
      users = [...users];
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  async function removeRole(userId: string, role: Role) {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    await setRoles(userId, user.roles.filter((r) => r !== role));
  }

  async function addRole(userId: string, role: Role) {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    if (user.roles.includes(role)) return;
    await setRoles(userId, [...user.roles, role]);
    openDropdown = null;
  }

  function roleLabel(role: Role): string {
    if (role === "admin") return "Admin";
    return getRoleConfig(role).label;
  }

  function toggleDropdown(userId: string, e: MouseEvent) {
    if (openDropdown === userId) {
      openDropdown = null;
      return;
    }
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    dropdownPos = { top: rect.bottom + 4, left: rect.left };
    openDropdown = userId;
  }

  async function saveRoleConfig(role: RoleConfig["role"], field: string, value: unknown) {
    try {
      await updateRoleConfig(role, { [field]: value });
      await refreshRoleConfig();
      toastSuccess("Saved");
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  let deleteTarget = $state<(User & { oauthProvider: string }) | null>(null);
  let deletePreview = $state<{ date: string; role: string }[]>([]);
  let deleteLoading = $state(false);

  async function confirmDelete(user: User & { oauthProvider: string }) {
    deleteLoading = true;
    deleteTarget = user;
    try {
      const preview = await deleteUserPreview(user.id);
      deletePreview = preview.futureAssignments;
    } catch (e) {
      toastError((e as Error).message);
      deleteTarget = null;
    } finally {
      deleteLoading = false;
    }
  }

  async function executeDelete() {
    if (!deleteTarget) return;
    try {
      await deleteUser(deleteTarget.id);
      toastSuccess(`Deleted ${deleteTarget.name}`);
      users = users.filter((u) => u.id !== deleteTarget!.id);
      deleteTarget = null;
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  loadUsers();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="admin-page" onclick={() => { openDropdown = null }}>
  <h2>User Management</h2>

  {#if loading}
    <p>Loading users...</p>
  {:else}
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="col-name">Name</th>
            <th class="col-email">Email</th>
            <th>Roles</th>
            <th class="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {#each users as user}
            <tr>
              <td>
                <div class="user-cell">
                  {#if user.avatarUrl}
                    <img src={user.avatarUrl} alt="" class="avatar" />
                  {/if}
                  {user.name}
                </div>
              </td>
              <td>{user.email}</td>
              <td>
                <div class="roles-cell">
                  <div class="pills">
                    {#each user.roles as role}
                      <span class="pill">
                        {roleLabel(role)}
                        <button class="pill-x" onclick={() => removeRole(user.id, role)}>x</button>
                      </span>
                    {/each}
                  </div>
                  <button class="btn btn-sm add-role-btn" onclick={(e) => { e.stopPropagation(); toggleDropdown(user.id, e); }}>+</button>
                </div>
              </td>
              <td>
                {#if user.id !== getAuthUser()?.id}
                  <button class="btn btn-sm btn-danger" onclick={() => confirmDelete(user)}>Delete</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if openDropdown}
    {@const user = users.find((u) => u.id === openDropdown)}
    {#if user}
      {@const available = ROLES.filter((r) => !user.roles.includes(r))}
      {#if available.length > 0}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="role-dropdown" style="top: {dropdownPos.top}px; left: {dropdownPos.left}px;" onclick={(e) => e.stopPropagation()}>
          {#each available as role}
            <button class="role-dropdown-item" onclick={() => addRole(user.id, role)}>
              {roleLabel(role)}
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}

  {#if deleteTarget}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-backdrop" onclick={() => { deleteTarget = null; }}>
      <div class="modal" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>Delete {deleteTarget.name}?</h3>
        </div>
        <div class="modal-body">
          {#if deleteLoading}
            <p>Checking assignments...</p>
          {:else if deletePreview.length > 0}
            <p>This user is assigned to <strong>{deletePreview.length}</strong> upcoming jump day{deletePreview.length > 1 ? "s" : ""}. These slots will be freed:</p>
            <ul class="delete-preview-list">
              {#each deletePreview as a}
                <li>{a.date} &mdash; {roleLabel(a.role as Role)}</li>
              {/each}
            </ul>
          {:else}
            <p>This user has no upcoming assignments.</p>
          {/if}
          {#if !deleteLoading}
            <div class="modal-actions">
              <button class="btn" onclick={() => { deleteTarget = null; }}>Cancel</button>
              <button class="btn btn-danger" onclick={executeDelete}>Delete</button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <h2 style="margin-top: 2rem;">Role Configuration</h2>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Role</th>
          <th>Label</th>
          <th>Requirement</th>
          <th class="num-col">Min / day</th>
          <th class="num-col">Max / day</th>
        </tr>
      </thead>
      <tbody>
        {#each getRoleConfigs() as config (config.role)}
          <tr>
            <td><code>{config.role}</code></td>
            <td>
              <input
                type="text"
                value={config.label}
                class="inline-input"
                onchange={(e) => saveRoleConfig(config.role, "label", e.currentTarget.value)}
              />
            </td>
            <td>
              <select
                value={config.requirement}
                class="inline-select"
                onchange={(e) => saveRoleConfig(config.role, "requirement", e.currentTarget.value)}
              >
                <option value="required">Required</option>
                <option value="limiting">Limiting</option>
                <option value="optional">Optional</option>
              </select>
            </td>
            <td class="num-col">
              <input
                type="number"
                min="0"
                value={config.minPerDay}
                class="inline-input num-input"
                onchange={(e) => saveRoleConfig(config.role, "minPerDay", Number(e.currentTarget.value))}
              />
            </td>
            <td class="num-col">
              <input
                type="number"
                min="0"
                placeholder="unlimited"
                value={config.maxPerDay ?? ""}
                class="inline-input num-input"
                onchange={(e) => {
                  const val = e.currentTarget.value;
                  saveRoleConfig(config.role, "maxPerDay", val === "" ? null : Number(val));
                }}
              />
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
