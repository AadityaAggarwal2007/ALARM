export type Category = {
  id: number;
  customName: string | null;
  defaultType: string | null;
  sortOrder: number;
  subCategories: SubCategory[];
};

export type SubCategory = {
  id: number;
  mainCategoryId: number;
  name: string;
  description: string | null;
};

export type Task = {
  id: number;
  date: string;
  nextDate: string | null;
  startTime: string;
  endTime: string;
  createdAt: string;
  mainCategoryId: number;
  subCategoryId: number | null;
  linkedTemplateId: number | null;
  isCompleted: boolean;
  priority: "STANDARD" | "MEDIUM" | "MAX";
  note: string | null;
  isInStatistics: boolean;
  planSource: string;
  isEnableNotification: boolean;
  fifteenMinBefore: boolean;
  oneHourBefore: boolean;
  threeHourBefore: boolean;
  oneDayBefore: boolean;
  oneWeekBefore: boolean;
  beforeEnd: boolean;
  enforce: boolean;
  challengeType: "math" | "typing";
  difficulty: "easy" | "medium" | "hard";
  requiredCorrect: number;
  silent: boolean;
  vibrate: boolean;
  ringStartedAt: string | null;
  dismissedAt: string | null;
  dismissAttempts: number;
  gaveUpAt: string | null;
  mainCategory: Category;
  subCategory: SubCategory | null;
};

export type Template = {
  id: number;
  startTime: string;
  endTime: string;
  mainCategoryId: number;
  subCategoryId: number | null;
  priority: "STANDARD" | "MEDIUM" | "MAX";
  note: string | null;
  isEnableNotification: boolean;
  isInStatistics: boolean;
  repeatEnabled: boolean;
  enforce: boolean;
  challengeType: "math" | "typing";
  difficulty: "easy" | "medium" | "hard";
  requiredCorrect: number;
  silent: boolean;
  vibrate: boolean;
  mainCategory: Category;
  subCategory: SubCategory | null;
  repeatTimes: RepeatTime[];
};

export type RepeatTime = {
  id?: number;
  type: "WEEK_DAY" | "WEEK_DAY_IN_MONTH" | "MONTH_DAY" | "YEAR_DAY";
  day: string | null;
  dayNumber: number | null;
  month: string | null;
  weekNumber: number | null;
};

export type UndefinedTask = {
  id: number;
  createdAt: string;
  deadline: string | null;
  mainCategoryId: number;
  subCategoryId: number | null;
  priority: "STANDARD" | "MEDIUM" | "MAX";
  note: string | null;
  mainCategory: Category;
  subCategory: SubCategory | null;
};

export type Goal = {
  id: number;
  title: string;
  scopeType: string;
  metric: "DURATION" | "TASK_COUNT";
  direction: "AT_LEAST" | "AT_MOST";
  targetValue: number;
  actualValue: number;
  progress: number;
  status: "IN_PROGRESS" | "ACHIEVED" | "EXCEEDED" | "EXPIRED" | "UNAVAILABLE";
  deadline: string;
  createdAt: string;
  categoryLabel: string | null;
};

export type Analytics = {
  range: { from: string; to: string };
  summary: {
    totalMs: number;
    totalTasks: number;
    completed: number;
    completionRate: number;
  };
  categories: {
    id: number;
    label: string;
    color: string;
    icon: string;
    ms: number;
    count: number;
    share: number;
  }[];
  load: { date: string; ms: number }[];
  creation: { hour: number; count: number }[];
  distribution: { label: string; minutes: number; count: number }[];
  planSource: Record<string, number>;
  metrics: {
    avgTasksPerDay: number;
    avgMsPerDay: number;
    busiestDay: string;
    busiestMs: number;
    longestMs: number;
    topCategory: string | null;
    activeDays: number;
  };
  heatmap: number[][];
  discipline: {
    enforcedCount: number;
    solvedCount: number;
    gaveUpCount: number;
    honourRate: number;
    avgLatenessMs: number;
    worstLatenessMs: number;
    avgAttempts: number;
    byDay: { date: string; total: number; onTime: number }[];
  };
};
