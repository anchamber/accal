<script lang="ts">
  import type { User, Role } from "@accal/shared";
  import { ROLES, ASSIGNMENT_ROLE_CONFIG } from "@accal/shared";
  import type { AssignmentRole } from "@accal/shared";
  import { fetchUsers, updateUserRoles } from "../lib/api.ts";

  let users = $state<(User & { oauthProvider: string })[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

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
              <th class="role-col">{role === "admin" ? "Admin" : ASSIGNMENT_ROLE_CONFIG[role as AssignmentRole].label}</th>
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
</div>
