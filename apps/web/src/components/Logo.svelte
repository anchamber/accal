<script lang="ts">
  interface Props {
    size?: number;
  }
  let { size = 28 }: Props = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" width={size} height={size}>
  <path d="M10 28C10 16 22 6 32 6C42 6 54 16 54 28" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="rgba(99,102,241,0.15)"/>
  <path d="M18 26C18 18 24 10 32 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
  <path d="M32 10C40 10 46 18 46 26" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
  <path d="M32 6V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
  <line x1="10" y1="28" x2="28" y2="44" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="54" y1="28" x2="36" y2="44" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="18" y1="26" x2="30" y2="44" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
  <line x1="46" y1="26" x2="34" y2="44" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.4"/>
  <circle cx="32" cy="44" r="3" fill="currentColor"/>
  <line x1="32" y1="47" x2="32" y2="55" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="26" y1="50" x2="38" y2="50" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <line x1="32" y1="55" x2="27" y2="61" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <line x1="32" y1="55" x2="37" y2="61" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>
