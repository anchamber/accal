<script lang="ts">
  import type { User, Role, RoleConfig, RequirementLevel } from "@accal/shared";
  import { ROLES } from "@accal/shared";
  import { fetchUsers, updateUserRoles, updateRoleConfig } from "../lib/api.ts";
  import { getRoleConfigs, getRoleConfig, refreshRoleConfig } from "../lib/roles.svelte.ts";

  let users = $state<(User & { oauthProvider: string })[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let roleError = $state<string | null>(null);
  let roleSuccess = $state<string | null>(null);

  async function loadUsers() {
    loading = true;
    try {
      users = await fetchUsers();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  async function toggleRole(userId: string, role: Role) {
    const user = users.find((u) => u.id === userId);
    if (!user) return;

    const hasIt = user.roles.includes(role);
    const newRoles = hasIt
      ? user.roles.filter((r) => r !== role)
      : [...user.roles, role];

    try {
      await updateUserRoles(userId, newRoles);
      user.roles = newRoles;
      users = [...users]; // trigger reactivity
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function roleLabel(role: Role): string {
    if (role === "admin") return "Admin";
    return getRoleConfig(role).label;
  }

  async function saveRoleConfig(role: RoleConfig["role"], field: string, value: unknown) {
    roleError = null;
    roleSuccess = null;
    try {
      await updateRoleConfig(role, { [field]: value });
      await refreshRoleConfig();
      roleSuccess = "Saved";
      setTimeout(() => { roleSuccess = null }, 1500);
    } catch (e) {
      roleError = (e as Error).message;
    }
  }

  loadUsers();
</script>

<div class="admin-page">
  <h2>User Management</h2>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <p>Loading users...</p>
  {:else}
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Provider</th>
            {#each ROLES as role}
              <th class="role-col">{roleLabel(role)}</th>
            {/each}
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
              <td>{user.oauthProvider}</td>
              {#each ROLES as role}
                <td class="role-col">
                  <label class="checkbox-label">
                    <input
                      type="checkbox"
                      checked={user.roles.includes(role)}
                      onchange={() => toggleRole(user.id, role)}
                    />
                  </label>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <h2 style="margin-top: 2rem;">Role Configuration</h2>

  {#if roleError}
    <div class="error">{roleError}</div>
  {/if}
  {#if roleSuccess}
    <div class="success">{roleSuccess}</div>
  {/if}

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
