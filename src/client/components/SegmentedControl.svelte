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
    class: className = '',
  }: {
    options: SegmentedOption<T>[]
    value?: T | undefined
    onValueChange?: (_next: T) => void
    /** Sets `aria-label` on the radiogroup (required for a11y unless you wire a visible label). */
    groupLabel: string
    disabled?: boolean
    class?: string
  } = $props()

  const baseBtn =
    'flex min-h-7 flex-1 shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap border border-border px-2 py-1.5 text-xs transition-[background-color,color,border-color] duration-200'

  function isSelected(option: SegmentedOption<T>): boolean {
    return option.value === value
  }

  function selectAt(index: number) {
    const opt = options[index]
    if (!opt || disabled || opt.disabled) return
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
    'flex h-fit w-full overflow-hidden rounded-lg outline-none',
    className,
  )}
  role="radiogroup"
  aria-label={groupLabel}
>
  {#each options as opt, i (opt.value)}
    {@const selected = isSelected(opt)}
    {@const Icon = getSegmentedControlIcon(opt.icon)}
    {@const iconPx = opt.iconSize ?? 14}
    {@const segmentDisabled = disabled || !!opt.disabled}
    {@const isFirst = i === 0}
    {@const isLast = i === options.length - 1}
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
        isFirst && 'ml-0 rounded-bl-lg rounded-tl-lg',
        !isFirst && '-ml-px',
        isLast && 'rounded-br-lg rounded-tr-lg',
        selected
          ? 'relative z-10 bg-accent text-accent-foreground'
          : 'bg-transparent text-foreground',
        segmentDisabled && 'cursor-not-allowed opacity-50',
      )}
      onclick={() => selectAt(i)}
      onkeydown={(e) => onSegmentKeydown(e, i)}
    >
      {#if Icon}
        <span class="flex items-center" aria-hidden="true">
          <Icon size={iconPx} strokeWidth={2} class="shrink-0" />
        </span>
      {/if}
      {opt.label}
    </button>
  {/each}
</div>
