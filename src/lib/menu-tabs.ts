export const COURSE_TAB_IDS = ["petite", "joie", "cent-quatre"] as const;

export type CourseTabId = (typeof COURSE_TAB_IDS)[number];

export function getMenuTabIdForKey(
  currentTabId: CourseTabId,
  key: string
): CourseTabId | null {
  const currentIndex = COURSE_TAB_IDS.indexOf(currentTabId);
  if (currentIndex < 0) return null;

  if (key === "Home") {
    return COURSE_TAB_IDS[0];
  }

  if (key === "End") {
    return COURSE_TAB_IDS[COURSE_TAB_IDS.length - 1];
  }

  if (key === "ArrowRight") {
    return COURSE_TAB_IDS[(currentIndex + 1) % COURSE_TAB_IDS.length];
  }

  if (key === "ArrowLeft") {
    return COURSE_TAB_IDS[(currentIndex - 1 + COURSE_TAB_IDS.length) % COURSE_TAB_IDS.length];
  }

  return null;
}
