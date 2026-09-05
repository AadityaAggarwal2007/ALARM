-- CreateTable
CREATE TABLE "TimeTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "nextDate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mainCategoryId" INTEGER NOT NULL,
    "subCategoryId" INTEGER,
    "linkedTemplateId" INTEGER,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "priority" TEXT NOT NULL DEFAULT 'STANDARD',
    "note" TEXT,
    "isInStatistics" BOOLEAN NOT NULL DEFAULT true,
    "planSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "isEnableNotification" BOOLEAN NOT NULL DEFAULT false,
    "fifteenMinBefore" BOOLEAN NOT NULL DEFAULT false,
    "oneHourBefore" BOOLEAN NOT NULL DEFAULT false,
    "threeHourBefore" BOOLEAN NOT NULL DEFAULT false,
    "oneDayBefore" BOOLEAN NOT NULL DEFAULT false,
    "oneWeekBefore" BOOLEAN NOT NULL DEFAULT false,
    "beforeEnd" BOOLEAN NOT NULL DEFAULT false,
    "enforce" BOOLEAN NOT NULL DEFAULT false,
    "challengeType" TEXT NOT NULL DEFAULT 'math',
    "difficulty" TEXT NOT NULL DEFAULT 'easy',
    "requiredCorrect" INTEGER NOT NULL DEFAULT 3,
    "silent" BOOLEAN NOT NULL DEFAULT false,
    "vibrate" BOOLEAN NOT NULL DEFAULT true,
    "ringStartedAt" DATETIME,
    "dismissedAt" DATETIME,
    "dismissAttempts" INTEGER NOT NULL DEFAULT 0,
    "gaveUpAt" DATETIME,
    CONSTRAINT "TimeTask_mainCategoryId_fkey" FOREIGN KEY ("mainCategoryId") REFERENCES "MainCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TimeTask_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TimeTask_linkedTemplateId_fkey" FOREIGN KEY ("linkedTemplateId") REFERENCES "Template" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MainCategory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customName" TEXT,
    "defaultType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "SubCategory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mainCategoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    CONSTRAINT "SubCategory_mainCategoryId_fkey" FOREIGN KEY ("mainCategoryId") REFERENCES "MainCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Template" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "mainCategoryId" INTEGER NOT NULL,
    "subCategoryId" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'STANDARD',
    "isEnableNotification" BOOLEAN NOT NULL DEFAULT false,
    "isInStatistics" BOOLEAN NOT NULL DEFAULT true,
    "repeatEnabled" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "enforce" BOOLEAN NOT NULL DEFAULT false,
    "challengeType" TEXT NOT NULL DEFAULT 'math',
    "difficulty" TEXT NOT NULL DEFAULT 'easy',
    "requiredCorrect" INTEGER NOT NULL DEFAULT 3,
    "silent" BOOLEAN NOT NULL DEFAULT false,
    "vibrate" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Template_mainCategoryId_fkey" FOREIGN KEY ("mainCategoryId") REFERENCES "MainCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Template_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RepeatTime" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "templateId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "day" TEXT,
    "dayNumber" INTEGER,
    "month" TEXT,
    "weekNumber" INTEGER,
    CONSTRAINT "RepeatTime_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UndefinedTask" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" DATETIME,
    "mainCategoryId" INTEGER NOT NULL,
    "subCategoryId" INTEGER,
    "priority" TEXT NOT NULL DEFAULT 'STANDARD',
    "note" TEXT,
    CONSTRAINT "UndefinedTask_mainCategoryId_fkey" FOREIGN KEY ("mainCategoryId") REFERENCES "MainCategory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UndefinedTask_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "mainCategoryId" INTEGER,
    "subCategoryId" INTEGER,
    "metric" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "targetValue" BIGINT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" DATETIME NOT NULL,
    CONSTRAINT "Goal_mainCategoryId_fkey" FOREIGN KEY ("mainCategoryId") REFERENCES "MainCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Goal_subCategoryId_fkey" FOREIGN KEY ("subCategoryId") REFERENCES "SubCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "goalId" INTEGER,
    "goalTitle" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "targetValue" BIGINT NOT NULL,
    "actualValue" BIGINT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "isAchieved" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoalHistory_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ThemeSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "language" TEXT NOT NULL DEFAULT 'SYSTEM',
    "themeColors" TEXT NOT NULL DEFAULT 'DEFAULT',
    "colorsType" TEXT NOT NULL DEFAULT 'PURPLE',
    "dynamicColor" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "TasksSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "taskViewStatus" TEXT NOT NULL DEFAULT 'EXPANDED',
    "homeViewMode" TEXT NOT NULL DEFAULT 'AGENDA',
    "taskAnalyticsRange" TEXT NOT NULL DEFAULT 'WEEK',
    "analyticsAnchorDate" TEXT,
    "customRangeStart" TEXT,
    "customRangeEnd" TEXT,
    "calendarButtonBehavior" TEXT NOT NULL DEFAULT 'PICKER',
    "secureMode" BOOLEAN NOT NULL DEFAULT false,
    "durationPresets" TEXT NOT NULL DEFAULT '10,15,30,45,60,120'
);

-- CreateIndex
CREATE INDEX "TimeTask_date_idx" ON "TimeTask"("date");

-- CreateIndex
CREATE INDEX "TimeTask_startTime_idx" ON "TimeTask"("startTime");

-- CreateIndex
CREATE INDEX "TimeTask_mainCategoryId_idx" ON "TimeTask"("mainCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "MainCategory_defaultType_key" ON "MainCategory"("defaultType");

-- CreateIndex
CREATE INDEX "SubCategory_mainCategoryId_idx" ON "SubCategory"("mainCategoryId");

-- CreateIndex
CREATE INDEX "RepeatTime_templateId_idx" ON "RepeatTime"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
