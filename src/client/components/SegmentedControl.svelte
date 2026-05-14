<script lang="ts" generics="T extends string | number | boolean = string">
  import { cn } from '@client/lib/cn.js'
  import {
    getSegmentedControlIcon,
    type SegmentedOption,
  } from '@client/lib/segmentedControl.js'

  let {
    options,
    value = $bindable(),
    onValueChange,
    groupLabel,
    disabled = false,
    /** When true, selection is driven only by `value` + `onValueChange` (no internal bind). Use for duplicate UI (e.g. mobile sheet mirror). */
    readOnly = false,
    class: className = '',
  }: {
    options: SegmentedOption<T>[]
    value?: T | undefined
    onValueChange?: (_next: T) => void
    /** Sets `aria-label` on the radiogroup (required for a11y unless you wire a visible label). */
    groupLabel: string
    disabled?: boolean
    readOnly?: boolean
    class?: string
  } = $props()

  /** Equal-width columns: `minmax(0,1fr)` avoids flex bugs in nested `min-w-0` parents (e.g. tunnel header). */
  const gridTemplate = $derived(
    options.length > 0 ? `repeat(${options.length}, minmax(0, 1fr))` : '1fr',
  )

  const baseBtn =
    'box-border flex min-h-8 min-w-0 w-full cursor-pointer flex-row items-center justify-center gap-1 border-r border-border px-2 py-1.5 text-center text-xs font-medium transition-[background-color,color,border-color] duration-200 last:border-r-0'

  function isSelected(option: SegmentedOption<T>): boolean {
    return option.value === value
  }

  function selectAt(index: number) {
    const opt = options[index]
    if (!opt || disabled || opt.disabled) return
    if (readOnly) {
      onValueChange?.(opt.value)
      return
    }
    value = opt.value
    onValueChange?.(opt.value)
  }

  function onSegmentKeydown(e: KeyboardEvent, index: number) {
    if (disabled) return
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
    if (!keys.includes(e.key)) return

    e.preventDefault()
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
    const n = options.length
    if (n === 0) return

    let j = index
    for (let step = 0; step < n; step += 1) {
      j = (j + delta + n) % n
      if (!options[j]!.disabled) {
        selectAt(j)
        return
      }
    }
  }
</script>

<div
  class={cn(
    'grid h-fit w-full overflow-hidden rounded-lg border border-border outline-none',
    className,
  )}
  style={`grid-template-columns: ${gridTemplate}`}
  role="radiogroup"
  aria-label={groupLabel}
>
  {#each options as opt, i (opt.value)}
    {@const selected = isSelected(opt)}
    {@const Icon = getSegmentedControlIcon(opt.icon)}
    {@const iconPx = opt.iconSize ?? 14}
    {@const segmentDisabled = disabled || !!opt.disabled}
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={segmentDisabled}
      disabled={segmentDisabled}
      tabindex={selected ? 0 : -1}
      data-testid={opt.testId}
      class={cn(
        baseBtn,
        selected
          ? 'relative z-10 bg-accent text-accent-foreground'
          : 'bg-transparent text-foreground',
        segmentDisabled && 'cursor-not-allowed opacity-50',
      )}
      onclick={() => selectAt(i)}
      onkeydown={(e) => onSegmentKeydown(e, i)}
    >
      <span class="flex min-w-0 max-w-full flex-row items-center justify-center gap-1">
        {#if Icon}
          <span class="flex shrink-0 items-center" aria-hidden="true">
            <Icon size={iconPx} strokeWidth={2} class="shrink-0" />
          </span>
        {/if}
        <span class="min-w-0 truncate">{opt.label}</span>
      </span>
    </button>
  {/each}
</div>
