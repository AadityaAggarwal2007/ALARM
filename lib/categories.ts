/**
 * Presentation data for the 15 built-in categories.
 *
 * The database stores only `defaultType`; the icon and colour live here so
 * they can be restyled without a migration, and so a custom category can fall
 * back to a stable colour derived from its id.
 */

export type CategoryMeta = {
  label: string;
  icon: string;
  color: string;
};

export const DEFAULT_CATEGORIES: Record<string, CategoryMeta> = {
  WORK: { label: "Work", icon: "💼", color: "#4F7DF3" },
  REST: { label: "Rest", icon: "🛋️", color: "#37B6A9" },
  SPORT: { label: "Sport", icon: "🏃", color: "#E8613C" },
  SLEEP: { label: "Sleep", icon: "🌙", color: "#6C5CE7" },
  CULTURE: { label: "Culture", icon: "🎭", color: "#C2519B" },
  AFFAIRS: { label: "Affairs", icon: "📋", color: "#D99A2B" },
  TRANSPORT: { label: "Transport", icon: "🚇", color: "#5A8CA8" },
  STUDY: { label: "Study", icon: "📚", color: "#3AA76D" },
  EAT: { label: "Eat", icon: "🍽️", color: "#E0A03C" },
  ENTERTAINMENTS: { label: "Entertainment", icon: "🎮", color: "#B565D8" },
  EMPTY: { label: "Empty", icon: "⬜", color: "#7A8290" },
  HYGIENE: { label: "Hygiene", icon: "🚿", color: "#49B6D6" },
  HEALTH: { label: "Health", icon: "❤️", color: "#DC4C6B" },
  SHOPPING: { label: "Shopping", icon: "🛒", color: "#E07B39" },
  OTHER: { label: "Other", icon: "•", color: "#8A8F98" },
};

const CUSTOM_PALETTE = [
  "#4F7DF3",
  "#37B6A9",
  "#E8613C",
  "#6C5CE7",
  "#C2519B",
  "#D99A2B",
  "#3AA76D",
  "#B565D8",
];

export type CategoryLike = {
  id: number;
  defaultType: string | null;
  customName: string | null;
};

export function categoryMeta(category: CategoryLike): CategoryMeta {
  if (category.defaultType && DEFAULT_CATEGORIES[category.defaultType]) {
    return DEFAULT_CATEGORIES[category.defaultType];
  }
  return {
    label: category.customName || "Category",
    icon: "•",
    color: CUSTOM_PALETTE[category.id % CUSTOM_PALETTE.length],
  };
}

export const PRIORITIES = ["STANDARD", "MEDIUM", "MAX"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  STANDARD: "Standard",
  MEDIUM: "Medium",
  MAX: "Max",
};
