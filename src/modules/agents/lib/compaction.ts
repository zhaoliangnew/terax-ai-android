export type CompactionProgress = {
  startedAt: number;
  phase: "preparing" | "compacting" | "finishing";
};
