import type { ComponentType } from 'svelte'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>
import {
  User, Users, Building2, Lightbulb, Map as MapIcon, Heart, Church, HandHeart,
  Briefcase, Home, Plane, Car, File, Hash, BookOpen, GraduationCap,
  Globe, Code, DollarSign, Star, Tag, Layers, Dumbbell, Camera,
} from 'lucide-svelte'

// Icon used for _ -prefixed system/special files
export { Hash as SpecialFileIcon }

// Full set of icons the LLM can choose from (PascalCase = lucide-svelte export name)
export const ICON_MAP: Record<string, AnyComponent> = {
  User, Users, Building2, Lightbulb, Map: MapIcon, Heart, Church, HandHeart,
  Briefcase, Home, Plane, Car, File, Hash, BookOpen, GraduationCap,
  Globe, Code, DollarSign, Star, Tag, Layers, Dumbbell, Camera,
}

// Hardcoded defaults for generic/common wiki directories.
// Personal or domain-specific dirs (bicf, grantees, properties, trips, etc.)
// should NOT be added here — they fall through to the LLM lookup.
const DEFAULTS: Record<string, AnyComponent> = {
  people:    User,
  companies: Building2,
  ideas:     Lightbulb,
  areas:     MapIcon,
  health:    Heart,
  projects:  Briefcase,
  vehicles:  Car,
  notes:     BookOpen,
  education: GraduationCap,
  travel:    Globe,
}

// Runtime cache, pre-seeded with defaults
const cache = new Map<string, AnyComponent>(Object.entries(DEFAULTS))

// Pending callbacks: dir → list of callbacks waiting for resolution
const pendingCallbacks = new Map<string, ((icon: AnyComponent) => void)[]>()

/**
 * Get the icon for a wiki directory synchronously.
 * For unknown dirs: returns File immediately and calls `onUpdate` when
 * the server resolves the icon (LLM-backed, cached in /data/wiki-dir-icons.json).
 */
export function getDirIcon(dir: string, onUpdate?: (icon: AnyComponent) => void): AnyComponent {
  if (cache.has(dir)) return cache.get(dir)!

  if (onUpdate) {
    if (!pendingCallbacks.has(dir)) {
      pendingCallbacks.set(dir, [])
      fetch(`/api/wiki/dir-icon/${encodeURIComponent(dir)}`)
        .then(r => r.ok ? r.json() : null)
        .then((data: { icon?: string } | null) => {
          const icon = data?.icon && ICON_MAP[data.icon] ? ICON_MAP[data.icon] : File
          cache.set(dir, icon)
          pendingCallbacks.get(dir)?.forEach(cb => cb(icon))
          pendingCallbacks.delete(dir)
        })
        .catch(() => {
          cache.set(dir, File)
          pendingCallbacks.get(dir)?.forEach(cb => cb(File))
          pendingCallbacks.delete(dir)
        })
    }
    pendingCallbacks.get(dir)!.push(onUpdate)
  }

  return File
}
