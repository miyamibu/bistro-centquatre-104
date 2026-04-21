export type ServicePeriodKey = "LUNCH" | "DINNER";

export type AdminOperatingStatusTone = "warning" | "closed" | "private" | "normal";

export type AdminOperatingStatusKey =
  | "CONFLICT"
  | "CLOSED"
  | "PRIVATE_BLOCKED"
  | "NORMAL";

export type AdminDayStatusLike = {
  isClosed: boolean;
  lunch: {
    privateBlock: { active: boolean };
    reservations: {
      count: number;
      partyTotal: number;
    };
  };
  dinner: {
    privateBlock: { active: boolean };
    reservations: {
      count: number;
      partyTotal: number;
    };
  };
};

export type AdminMonthDaySummaryLike = {
  isClosed: boolean;
  hasLunchPrivateBlock: boolean;
  hasDinnerPrivateBlock: boolean;
  hasConflict: boolean;
};

export type AdminOperatingStatus = {
  key: AdminOperatingStatusKey;
  label: string;
  tone: AdminOperatingStatusTone;
};

export type AdminPeriodOperatingStatus = {
  key: AdminOperatingStatusKey;
  label: string;
  tone: AdminOperatingStatusTone;
  hasPrivateBlock: boolean;
};

function toConflictStatus(): AdminOperatingStatus {
  return {
    key: "CONFLICT",
    label: "競合あり",
    tone: "warning",
  };
}

function toClosedStatus(label = "全日休業"): AdminOperatingStatus {
  return {
    key: "CLOSED",
    label,
    tone: "closed",
  };
}

function toPrivateStatus(label: string): AdminOperatingStatus {
  return {
    key: "PRIVATE_BLOCKED",
    label,
    tone: "private",
  };
}

function toNormalStatus(label = "通常営業"): AdminOperatingStatus {
  return {
    key: "NORMAL",
    label,
    tone: "normal",
  };
}

export function getPrivateBlockLabel(
  hasLunchPrivateBlock: boolean,
  hasDinnerPrivateBlock: boolean
): "終日貸切" | "ランチ貸切" | "ディナー貸切" | null {
  if (hasLunchPrivateBlock && hasDinnerPrivateBlock) {
    return "終日貸切";
  }

  if (hasLunchPrivateBlock) {
    return "ランチ貸切";
  }

  if (hasDinnerPrivateBlock) {
    return "ディナー貸切";
  }

  return null;
}

export function getDayOperatingStatus(dayStatus: AdminDayStatusLike): AdminOperatingStatus {
  const hasLunchPrivateBlock = dayStatus.lunch.privateBlock.active;
  const hasDinnerPrivateBlock = dayStatus.dinner.privateBlock.active;
  const privateLabel = getPrivateBlockLabel(hasLunchPrivateBlock, hasDinnerPrivateBlock);

  if (dayStatus.isClosed && privateLabel) {
    return toConflictStatus();
  }

  if (dayStatus.isClosed) {
    return toClosedStatus();
  }

  if (privateLabel) {
    return toPrivateStatus(privateLabel);
  }

  return toNormalStatus();
}

export function getMonthDayOperatingStatus(
  daySummary: AdminMonthDaySummaryLike | null | undefined
): AdminOperatingStatus {
  if (!daySummary) {
    return toNormalStatus();
  }

  if (daySummary.hasConflict) {
    return toConflictStatus();
  }

  if (daySummary.isClosed) {
    return toClosedStatus();
  }

  const privateLabel = getPrivateBlockLabel(
    daySummary.hasLunchPrivateBlock,
    daySummary.hasDinnerPrivateBlock
  );

  if (privateLabel) {
    return toPrivateStatus(privateLabel);
  }

  return toNormalStatus();
}

export function getDayPeriodOperatingStatus(
  dayStatus: AdminDayStatusLike,
  servicePeriod: ServicePeriodKey
): AdminPeriodOperatingStatus {
  const hasPrivateBlock =
    servicePeriod === "LUNCH"
      ? dayStatus.lunch.privateBlock.active
      : dayStatus.dinner.privateBlock.active;

  if (dayStatus.isClosed && hasPrivateBlock) {
    return {
      ...toConflictStatus(),
      hasPrivateBlock,
    };
  }

  if (dayStatus.isClosed) {
    return {
      ...toClosedStatus("休業"),
      hasPrivateBlock,
    };
  }

  if (hasPrivateBlock) {
    return {
      ...toPrivateStatus("貸切中"),
      hasPrivateBlock,
    };
  }

  return {
    ...toNormalStatus(),
    hasPrivateBlock,
  };
}
