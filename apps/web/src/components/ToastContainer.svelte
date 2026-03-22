<script lang="ts">
  import { getToasts, removeToast } from "../lib/toast.svelte.ts";
</script>

{#if getToasts().length > 0}
  <div class="toast-container">
    {#each getToasts() as toast (toast.id)}
      <div class="toast toast-{toast.type}">
        <span class="toast-message">{toast.message}</span>
        <button class="toast-close" onclick={() => removeToast(toast.id)}>x</button>
      </div>
    {/each}
  </div>
{/if}
