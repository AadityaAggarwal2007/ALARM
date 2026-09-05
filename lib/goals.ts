import { prisma } from "./db";

/**
 * Goals are evaluated live against scheduled blocks rather than stored as a
 * running total, so editing or deleting a block always leaves progress correct.
 * The window runs from the goal's creation to its deadline.
 */

export type GoalStatus =
  | "IN_PROGRESS"
  | "ACHIEVED"
  | "EXCEEDED"
  | "EXPIRED"
  | "UNAVAILABLE";

export type EvaluatedGoal = {
  id: number;
  title: string;
  scopeType: string;
  metric: string;
  direction: string;
  targetValue: number;
  actualValue: number;
  progress: number;
  status: GoalStatus;
  deadline: string;
  createdAt: string;
  categoryLabel: string | null;
};

type GoalRow = {
  id: number;
  title: string;
  scopeType: string;
  metric: string;
  direction: string;
  targetValue: bigint;
  createdAt: Date;
  deadline: Date;
  mainCategoryId: number | null;
  subCategoryId: number | null;
  mainCategory?: { defaultType: string | null; customName: string | null } | null;
  subCategory?: { name: string } | null;
};

export async function evaluateGoal(goal: GoalRow): Promise<EvaluatedGoal> {
  const where: Record<string, unknown> = {
    isInStatistics: true,
    startTime: { gte: goal.createdAt, lte: goal.deadline },
  };

  if (goal.scopeType === "MAIN_CATEGORY" && goal.mainCategoryId) {
    where.mainCategoryId = goal.mainCategoryId;
  }
  if (goal.scopeType === "SUB_CATEGORY" && goal.subCategoryId) {
    where.subCategoryId = goal.subCategoryId;
  }

  const tasks = await prisma.timeTask.findMany({
    where,
    select: { startTime: true, endTime: true },
  });

  const target = Number(goal.targetValue);
  const actual =
    goal.metric === "TASK_COUNT"
      ? tasks.length
      : tasks.reduce(
          (sum, t) => sum + (t.endTime.getTime() - t.startTime.getTime()),
          0
        );

  const expired = Date.now() > goal.deadline.getTime();
  const progress = target > 0 ? actual / target : 0;

  let status: GoalStatus;
  if (target <= 0) {
    status = "UNAVAILABLE";
  } else if (goal.direction === "AT_LEAST") {
    if (actual >= target) status = progress > 1.15 ? "EXCEEDED" : "ACHIEVED";
    else status = expired ? "EXPIRED" : "IN_PROGRESS";
  } else {
    // AT_MOST: staying under is success, and it is only final at the deadline.
    if (actual > target) status = "EXPIRED";
    else status = expired ? "ACHIEVED" : "IN_PROGRESS";
  }

  const categoryLabel =
    goal.subCategory?.name ??
    goal.mainCategory?.customName ??
    goal.mainCategory?.defaultType ??
    null;

  return {
    id: goal.id,
    title: goal.title,
    scopeType: goal.scopeType,
    metric: goal.metric,
    direction: goal.direction,
    targetValue: target,
    actualValue: actual,
    progress,
    status,
    deadline: goal.deadline.toISOString(),
    createdAt: goal.createdAt.toISOString(),
    categoryLabel,
  };
}
