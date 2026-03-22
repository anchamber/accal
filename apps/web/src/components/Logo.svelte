<script lang="ts">
  interface Props {
    size?: number;
  }
  let { size = 28 }: Props = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width={size} height={size}>
  <rect x="8" y="14" width="48" height="42" rx="4" stroke="currentColor" stroke-width="2.5" fill="rgba(99,102,241,0.08)"/>
  <rect x="8" y="14" width="48" height="12" rx="4" fill="currentColor"/>
  <line x1="22" y1="10" x2="22" y2="18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <line x1="42" y1="10" x2="42" y2="18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <circle cx="18" cy="34" r="2" fill="currentColor" opacity="0.3"/>
  <circle cx="28" cy="34" r="2" fill="currentColor" opacity="0.3"/>
  <circle cx="38" cy="34" r="2" fill="currentColor" opacity="0.3"/>
  <circle cx="48" cy="34" r="2" fill="currentColor" opacity="0.3"/>
  <circle cx="18" cy="44" r="2" fill="currentColor" opacity="0.3"/>
  <circle cx="28" cy="44" r="2" fill="currentColor" opacity="0.3"/>
  <circle cx="38" cy="44" r="4" fill="currentColor"/>
  <circle cx="48" cy="42" r="1.5" fill="currentColor"/>
  <line x1="48" y1="43.5" x2="48" y2="48" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="45.5" y1="45.5" x2="50.5" y2="45.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <line x1="48" y1="48" x2="46" y2="51" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  <line x1="48" y1="48" x2="50" y2="51" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>
