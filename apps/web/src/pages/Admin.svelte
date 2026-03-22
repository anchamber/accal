<script lang="ts">
  import type { User, Role, RoleConfig } from "@accal/shared";
  import { ROLES } from "@accal/shared";
  import { fetchUsers, updateUserRoles, updateRoleConfig } from "../lib/api.ts";
  import { getRoleConfigs, getRoleConfig, refreshRoleConfig } from "../lib/roles.svelte.ts";
  import { toastSuccess, toastError } from "../lib/toast.svelte.ts";

  let users = $state<(User & { oauthProvider: string })[]>([]);
  let loading = $state(true);
  let openDropdown = $state<string | null>(null);

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

  function toggleDropdown(userId: string) {
    openDropdown = openDropdown === userId ? null : userId;
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
            <th>Name</th>
            <th>Email</th>
            <th>Roles</th>
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
                  <div class="role-dropdown-wrapper" onclick={(e) => e.stopPropagation()}>
                    <button class="btn btn-sm add-role-btn" onclick={() => toggleDropdown(user.id)}>+</button>
                    {#if openDropdown === user.id}
                      {@const available = ROLES.filter((r) => !user.roles.includes(r))}
                      {#if available.length > 0}
                        <div class="role-dropdown">
                          {#each available as role}
                            <button class="role-dropdown-item" onclick={() => addRole(user.id, role)}>
                              {roleLabel(role)}
                            </button>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  </div>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
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
