<script lang="ts">
  import type { JumpDay } from "@accal/shared";
  import { fetchJumpDays, createJumpDay, deleteJumpDay, importIcal } from "../lib/api.ts";
  import { getUser, hasRole } from "../lib/auth.svelte.ts";
  import { toastError, toastSuccess } from "../lib/toast.svelte.ts";
  import { getRoleConfigs } from "../lib/roles.svelte.ts";
  import JumpDayModal from "../components/JumpDayModal.svelte";

  let currentDate = $state(new Date());
  let jumpDays = $state<JumpDay[]>([]);
  let selectedDay = $state<JumpDay | null>(null);
  let showModal = $state(false);

  const year = $derived(currentDate.getFullYear());
  const month = $derived(currentDate.getMonth());
  const monthStr = $derived(
    `${year}-${String(month + 1).padStart(2, "0")}`,
  );
  const monthName = $derived(
    currentDate.toLocaleString("default", { month: "long", year: "numeric" }),
  );

  const firstDay = $derived(new Date(year, month, 1).getDay());
  // Adjust so Monday=0
  const startOffset = $derived((firstDay + 6) % 7);
  const daysInMonth = $derived(new Date(year, month + 1, 0).getDate());

  const calendarDays = $derived.by(() => {
    const days: (number | null)[] = [];
    for (let i = 0; i < startOffset; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    while (days.length % 7 !== 0) days.push(null);
    return days;
  });

  function jumpDayMap(): Map<string, JumpDay> {
    const map = new Map<string, JumpDay>();
    for (const jd of jumpDays) map.set(jd.date, jd);
    return map;
  }

  function dateStr(day: number): string {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function getStatus(jd: JumpDay): "full" | "partial" | "empty" {
    const configs = getRoleConfigs();
    const assignmentCounts = new Map<string, number>();
    for (const a of jd.assignments) {
      assignmentCounts.set(a.role, (assignmentCounts.get(a.role) ?? 0) + 1);
    }

    const requiredConfigs = configs.filter((c) => c.requirement === "required");
    const limitingConfigs = configs.filter((c) => c.requirement === "limiting");

    const allRequiredFilled = requiredConfigs.every(
      (c) => (assignmentCounts.get(c.role) ?? 0) >= c.minPerDay,
    );
    if (!allRequiredFilled) return "empty";

    const allLimitingFilled = limitingConfigs.every(
      (c) => (assignmentCounts.get(c.role) ?? 0) >= c.minPerDay,
    );
    if (!allLimitingFilled) return "partial";

    return "full";
  }

  function getTooltip(jd: JumpDay): string {
    const configs = getRoleConfigs();
    const assignmentCounts = new Map<string, number>();
    for (const a of jd.assignments) {
      assignmentCounts.set(a.role, (assignmentCounts.get(a.role) ?? 0) + 1);
    }

    const missingRequired = configs
      .filter((c) => c.requirement === "required" && (assignmentCounts.get(c.role) ?? 0) < c.minPerDay)
      .map((c) => c.label);
    const missingLimiting = configs
      .filter((c) => c.requirement === "limiting" && (assignmentCounts.get(c.role) ?? 0) < c.minPerDay)
      .map((c) => c.label);

    if (missingRequired.length > 0) {
      const parts = [`Missing required: ${missingRequired.join(", ")}`];
      if (missingLimiting.length > 0) parts.push(`Missing limiting: ${missingLimiting.join(", ")}`);
      return parts.join("\n");
    }
    if (missingLimiting.length > 0) {
      return `Missing limiting: ${missingLimiting.join(", ")}`;
    }
    return "All roles filled";
  }

  async function loadJumpDays() {
    try {
      jumpDays = await fetchJumpDays(monthStr);
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  function prevMonth() {
    currentDate = new Date(year, month - 1, 1);
  }

  function nextMonth() {
    currentDate = new Date(year, month + 1, 1);
  }

  async function openDay(day: number) {
    const date = dateStr(day);
    let jd = jumpDayMap().get(date);
    if (!jd && hasRole("admin")) {
      try {
        jd = await createJumpDay(date);
        await loadJumpDays();
        jd = jumpDayMap().get(date);
      } catch (e) {
        toastError((e as Error).message);
        return;
      }
    }
    if (jd) {
      selectedDay = jd;
      showModal = true;
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteJumpDay(id);
      showModal = false;
      selectedDay = null;
      await loadJumpDays();
    } catch (e) {
      toastError((e as Error).message);
    }
  }

  async function handleRefresh() {
    await loadJumpDays();
    if (selectedDay) {
      selectedDay = jumpDayMap().get(selectedDay.date) ?? null;
    }
  }

  let fileInput: HTMLInputElement;

  async function handleImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const result = await importIcal(file);
      toastSuccess(`Imported ${result.created} jump days (${result.skipped} skipped)`);
      await loadJumpDays();
    } catch (err) {
      toastError((err as Error).message);
    }
    input.value = "";
  }

  function handleModalClose() {
    showModal = false;
    selectedDay = null;
    loadJumpDays();
  }

  $effect(() => {
    void monthStr; // track dependency
    loadJumpDays();
  });
</script>

<div class="calendar-page">
  <div class="calendar-header">
    <button class="btn" onclick={prevMonth}>&larr;</button>
    <h2>{monthName}</h2>
    <button class="btn" onclick={nextMonth}>&rarr;</button>
    {#if hasRole("admin")}
      <input
        type="file"
        accept=".ics,.ical"
        class="hidden-input"
        bind:this={fileInput}
        onchange={handleImport}
      />
      <button class="btn btn-sm" onclick={() => fileInput.click()} title="Import from iCal file">
        Import .ics
      </button>
    {/if}
  </div>

  <div class="calendar-grid">
    <div class="weekday-header">Mon</div>
    <div class="weekday-header">Tue</div>
    <div class="weekday-header">Wed</div>
    <div class="weekday-header">Thu</div>
    <div class="weekday-header">Fri</div>
    <div class="weekday-header">Sat</div>
    <div class="weekday-header">Sun</div>

    {#each calendarDays as day}
      {#if day === null}
        <div class="calendar-cell empty"></div>
      {:else}
        {@const jd = jumpDayMap().get(dateStr(day))}
        <button
          class="calendar-cell"
          class:has-jumpday={!!jd}
          class:clickable={!!jd || hasRole("admin")}
          class:canceled={jd && !!jd.canceledAt}
          class:status-full={jd && !jd.canceledAt && getStatus(jd) === "full"}
          class:status-partial={jd && !jd.canceledAt && getStatus(jd) === "partial"}
          class:status-empty={jd && !jd.canceledAt && getStatus(jd) === "empty"}
          class:today={dateStr(day) === new Date().toISOString().split("T")[0]}
          title={jd ? (jd.canceledAt ? `Canceled${jd.cancelReason ? `: ${jd.cancelReason}` : ""}` : getTooltip(jd)) : ""}
          onclick={() => openDay(day)}
        >
          <span class="day-number">{day}</span>
          {#if jd}
            <div class="jumpday-indicator">
              <span class="status-bar"></span>
            </div>
          {/if}
        </button>
      {/if}
    {/each}
  </div>

  {#if showModal && selectedDay}
    <JumpDayModal
      jumpDay={selectedDay}
      onclose={handleModalClose}
      ondelete={handleDelete}
      onrefresh={handleRefresh}
    />
  {/if}
</div>
