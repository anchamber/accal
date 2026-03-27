<script lang="ts">
  import type { User, Profile, Role, AssignmentRole, RoleConfig } from "@accal/shared";
  import { ROLES, ASSIGNMENT_ROLES } from "@accal/shared";
  import {
    fetchUsers,
    updateUserRoles,
    updateRoleConfig,
    deleteUserPreview,
    deleteUser,
    fetchProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    linkProfile,
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

  // --- Profiles ---
  let profiles = $state<Profile[]>([]);
  let profilesLoading = $state(true);
  let showCreateProfile = $state(false);
  let newProfileName = $state("");
  let newProfileRoles = $state<AssignmentRole[]>([]);
  let profileDropdown = $state<string | null>(null);
  let profileDropdownPos = $state({ top: 0, left: 0 });
  let linkTarget = $state<Profile | null>(null);
  let deleteProfileTarget = $state<Profile | null>(null);

  async function loadProfiles() {
    profilesLoading = true;
    try {
      profiles = await fetchProfiles();
    } catch (e) {
      toastError((e as Error).message);
    } finally {
      profilesLoading = false;
    }
  }

  async function handleCreateProfile() {
    if (!newProfileName.trim()) return;
    try {
      const created = await createProfile(newProfileName.trim(), newProfileRoles);
      profiles = [...profiles, created];
      newProfileName = "";
      newProfileRoles = [];
      showCreateProfile = false;
      toastSuccess("Profile created");
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  function toggleNewProfileRole(role: AssignmentRole) {
    if (newProfileRoles.includes(role)) {
      newProfileRoles = newProfileRoles.filter((r) => r !== role);
    } else {
      newProfileRoles = [...newProfileRoles, role];
    }
  }

  async function removeProfileRole(profileId: string, role: AssignmentRole) {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const newRoles = profile.roles.filter((r) => r !== role) as AssignmentRole[];
    try {
      await updateProfile(profileId, { roles: newRoles });
      profile.roles = newRoles;
      profiles = [...profiles];
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  async function addProfileRole(profileId: string, role: AssignmentRole) {
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile || profile.roles.includes(role)) return;
    const newRoles = [...profile.roles, role] as AssignmentRole[];
    try {
      await updateProfile(profileId, { roles: newRoles });
      profile.roles = newRoles;
      profiles = [...profiles];
      profileDropdown = null;
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  function toggleProfileDropdown(profileId: string, e: MouseEvent) {
    if (profileDropdown === profileId) {
      profileDropdown = null;
      return;
    }
    const btn = e.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    profileDropdownPos = { top: rect.bottom + 4, left: rect.left };
    profileDropdown = profileId;
  }

  async function executeDeleteProfile() {
    if (!deleteProfileTarget) return;
    try {
      await deleteProfile(deleteProfileTarget.id);
      toastSuccess(`Deleted profile ${deleteProfileTarget.name}`);
      profiles = profiles.filter((p) => p.id !== deleteProfileTarget!.id);
      deleteProfileTarget = null;
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  async function executeLinkProfile(userId: string) {
    if (!linkTarget) return;
    try {
      const result = await linkProfile(linkTarget.id, userId);
      toastSuccess(`Linked profile. ${result.mergedAssignments} assignments transferred${result.skippedAssignments ? `, ${result.skippedAssignments} skipped (duplicates)` : ""}.`);
      profiles = profiles.filter((p) => p.id !== linkTarget!.id);
      linkTarget = null;
      loadUsers(); // refresh users to show merged roles
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  function profileRoleLabel(role: string): string {
    return getRoleConfig(role as AssignmentRole).label;
  }

  loadUsers();
  loadProfiles();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="admin-page" onclick={() => { openDropdown = null; profileDropdown = null; }}>
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

  <h2 style="margin-top: 2rem;">Profiles</h2>
  <p class="section-hint">Profiles are people without a user account who can be assigned to jump days by an admin.</p>

  <button class="btn btn-sm btn-primary" style="margin-bottom: 1rem;" onclick={() => { showCreateProfile = !showCreateProfile; }}>
    {showCreateProfile ? "Cancel" : "Create Profile"}
  </button>

  {#if showCreateProfile}
    <div class="create-profile-form">
      <input
        type="text"
        class="inline-input"
        placeholder="Name"
        bind:value={newProfileName}
        onkeydown={(e) => { if (e.key === "Enter") handleCreateProfile(); }}
      />
      <div class="role-checkboxes">
        {#each ASSIGNMENT_ROLES as role}
          <label class="role-checkbox">
            <input
              type="checkbox"
              checked={newProfileRoles.includes(role)}
              onchange={() => toggleNewProfileRole(role)}
            />
            {profileRoleLabel(role)}
          </label>
        {/each}
      </div>
      <button class="btn btn-sm btn-primary" onclick={handleCreateProfile} disabled={!newProfileName.trim()}>Create</button>
    </div>
  {/if}

  {#if profilesLoading}
    <p>Loading profiles...</p>
  {:else if profiles.length === 0}
    <p class="empty-hint">No profiles yet.</p>
  {:else}
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="col-name">Name</th>
            <th>Roles</th>
            <th class="col-actions"></th>
          </tr>
        </thead>
        <tbody>
          {#each profiles as profile}
            <tr>
              <td>{profile.name}</td>
              <td>
                <div class="roles-cell">
                  <div class="pills">
                    {#each profile.roles as role}
                      <span class="pill">
                        {profileRoleLabel(role)}
                        <button class="pill-x" onclick={() => removeProfileRole(profile.id, role as AssignmentRole)}>x</button>
                      </span>
                    {/each}
                  </div>
                  <button class="btn btn-sm add-role-btn" onclick={(e) => { e.stopPropagation(); toggleProfileDropdown(profile.id, e); }}>+</button>
                </div>
              </td>
              <td>
                <div class="btn-group">
                  <button class="btn btn-sm" onclick={() => { linkTarget = profile; }}>Link to User</button>
                  <button class="btn btn-sm btn-danger" onclick={() => { deleteProfileTarget = profile; }}>Delete</button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if profileDropdown}
    {@const profile = profiles.find((p) => p.id === profileDropdown)}
    {#if profile}
      {@const available = ASSIGNMENT_ROLES.filter((r) => !profile.roles.includes(r))}
      {#if available.length > 0}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="role-dropdown" style="top: {profileDropdownPos.top}px; left: {profileDropdownPos.left}px;" onclick={(e) => e.stopPropagation()}>
          {#each available as role}
            <button class="role-dropdown-item" onclick={() => addProfileRole(profile.id, role)}>
              {profileRoleLabel(role)}
            </button>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}

  {#if deleteProfileTarget}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-backdrop" onclick={() => { deleteProfileTarget = null; }}>
      <div class="modal" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>Delete profile "{deleteProfileTarget.name}"?</h3>
        </div>
        <div class="modal-body">
          <p>This will remove the profile and all its jump day assignments.</p>
          <div class="modal-actions">
            <button class="btn" onclick={() => { deleteProfileTarget = null; }}>Cancel</button>
            <button class="btn btn-danger" onclick={executeDeleteProfile}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  {#if linkTarget}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-backdrop" onclick={() => { linkTarget = null; }}>
      <div class="modal" onclick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>Link "{linkTarget.name}" to a User</h3>
        </div>
        <div class="modal-body">
          <p>Select a user account to merge this profile into. All assignments will be transferred.</p>
          {#if users.length === 0}
            <p>No users available.</p>
          {:else}
            <div class="link-user-list">
              {#each users as user}
                <button class="link-user-item" onclick={() => executeLinkProfile(user.id)}>
                  <div class="user-cell">
                    {#if user.avatarUrl}
                      <img src={user.avatarUrl} alt="" class="avatar" />
                    {/if}
                    <span>{user.name}</span>
                    <span class="text-muted">({user.email})</span>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
          <div class="modal-actions">
            <button class="btn" onclick={() => { linkTarget = null; }}>Cancel</button>
          </div>
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
