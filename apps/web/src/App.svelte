<script lang="ts">
  import { checkAuth, getUser, isLoading, hasRole, logout } from "./lib/auth.svelte.ts";
  import { loadRoleConfig } from "./lib/roles.svelte.ts";
  import { getRoute, navigate, onNavigate } from "./lib/router.svelte.ts";
  import Login from "./pages/Login.svelte";
  import Calendar from "./pages/Calendar.svelte";
  import Admin from "./pages/Admin.svelte";
  import Account from "./pages/Account.svelte";
  import ToastContainer from "./components/ToastContainer.svelte";
  import Logo from "./components/Logo.svelte";

  checkAuth().then(() => loadRoleConfig());
  onNavigate(() => checkAuth());
</script>

{#if isLoading()}
  <div class="loading">
    <div class="spinner"></div>
    <p>Loading...</p>
  </div>
{:else if !getUser() || getRoute() === "/login"}
  <ToastContainer />
  <Login />
{:else}
  <nav class="navbar">
    <div class="nav-left">
      <button class="nav-brand" onclick={() => navigate("/")}><Logo size={24} /></button>
      <button
        class="nav-link"
        class:active={getRoute() === "/" || getRoute() === ""}
        onclick={() => navigate("/")}
      >
        Calendar
      </button>
      {#if hasRole("admin")}
        <button
          class="nav-link"
          class:active={getRoute() === "/admin"}
          onclick={() => navigate("/admin")}
        >
          Admin
        </button>
      {/if}
    </div>
    <div class="nav-right">
      <button
        class="nav-link"
        class:active={getRoute() === "/account"}
        onclick={() => navigate("/account")}
      >
        {getUser()?.name}
      </button>
      <button class="btn btn-sm" onclick={logout}>Logout</button>
    </div>
  </nav>

  <ToastContainer />
  <main class="container">
    {#if getRoute() === "/admin" && hasRole("admin")}
      <Admin />
    {:else if getRoute() === "/account"}
      <Account />
    {:else}
      <Calendar />
    {/if}
  </main>
{/if}
