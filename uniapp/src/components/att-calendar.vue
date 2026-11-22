<template>
  <view class="cal">
    <view class="cal__week">
      <text v-for="w in weekLabels" :key="w" class="cal__week-item">{{ w }}</text>
    </view>

    <view class="cal__grid" :class="{ 'cal__grid--compact': compact }">
      <view
        v-for="(date, idx) in cells"
        :key="date || `blank-${idx}`"
        class="cal__cell"
        :class="[date ? `cal__cell--${stateOfDate(date)}` : 'cal__cell--blank', date === selected ? 'cal__cell--selected' : '', date === todayKey ? 'cal__cell--today' : '']"
        @tap="date && select(date)"
      >
        <template v-if="date">
          <text class="cal__day">{{ Number(date.slice(8, 10)) }}</text>
          <text v-if="stateOfDate(date) === 'leave'" class="cal__mark cal__mark--leave">请假</text>
          <view v-else-if="pairOf(date) && (pairOf(date).on || pairOf(date).off)" class="cal__times">
            <text class="cal__time" :class="{ 'cal__time--warn': isWarn(pairOf(date).on) }">{{ pairOf(date).on ? fmtTime(pairOf(date).on.checkin_time) : "—" }}</text>
            <text class="cal__time" :class="{ 'cal__time--warn': isWarn(pairOf(date).off) }">{{ pairOf(date).off ? fmtTime(pairOf(date).off.checkin_time) : "—" }}</text>
          </view>
          <text v-else-if="stateOfDate(date) === 'absent'" class="cal__mark">缺卡</text>
          <text v-else-if="stateOfDate(date) === 'in_progress'" class="cal__mark cal__mark--progress">进行中</text>
        </template>
      </view>
    </view>
  </view>
</template>

<script>
import { buildCells, fmtTime, WEEK_LABELS, stateOfDay } from "@/utils/checkin";

/**
 * 月历（一天一格，上下班时间分两行）。
 * 本人出勤页和「组长看成员」的抽屉共用同一个组件 —— 两处判定口径必须一致。
 * 已批准请假日由父组件经 leaveDays 传入，优先于打卡/缺卡判定。
 * 对应 frontend/src/pages/attendance/MonthCalendar.tsx。
 */
export default {
  name: "AttCalendar",
  props: {
    month: { type: String, default: "" },
    cells: { type: Array, default: null },
    /** { "YYYY-MM-DD": { on, off } } */
    byDate: { type: Object, default: () => ({}) },
    todayKey: { type: String, default: "" },
    selected: { type: String, default: "" },
    hasData: { type: Boolean, default: false },
    rule: { type: Object, default: null },
    /** 已批准请假日 { "YYYY-MM-DD": true }（与 PC MonthCalendar 的 stateOf 同口径，优先级最高） */
    leaveDays: { type: Object, default: () => ({}) },
    compact: { type: Boolean, default: false },
  },
  emits: ["select"],
  computed: {
    weekLabels() {
      return WEEK_LABELS;
    },
    grid() {
      if (this.cells && this.cells.length) return this.cells;
      return this.month ? buildCells(this.month) : [];
    },
  },
  methods: {
    fmtTime,
    pairOf(date) {
      return this.byDate[date] || {};
    },
    isWarn(rec) {
      return Boolean(rec && rec.status !== "normal");
    },
    stateOfDate(date) {
      // 已批准的请假优先：请假日不算缺卡，也不该显示打卡时间
      if (this.leaveDays[date]) return "leave";
      const pair = this.byDate[date];
      if (!this.hasData) {
        // 该月没有任何记录时不要把工作日刷成「缺卡」
        if (pair && (pair.on || pair.off)) return "partial";
        if (date > this.todayKey) return "future";
        const d = new Date(`${date}T00:00:00`);
        return d.getDay() === 0 || d.getDay() === 6 ? "weekend" : "idle";
      }
      return stateOfDay(pair, date, this.todayKey, new Date(), this.rule);
    },
    select(date) {
      this.$emit("select", date);
    },
  },
};
</script>

<style scoped>
.cal__week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
  padding: 0 2px 6px;
}

.cal__week-item {
  text-align: center;
  font-size: var(--text-xs);
  color: var(--ink-3);
  font-weight: var(--weight-medium);
}

.cal__grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}

.cal__cell {
  height: 56px;
  box-sizing: border-box;
  padding: 4px 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 1px;
  border-radius: 8px;
  background: transparent;
}

.cal__cell--blank {
  visibility: hidden;
}

.cal__day {
  font-size: var(--text-base);
  color: var(--ink);
  font-weight: var(--weight-medium);
  line-height: 1.2;
}

.cal__cell--weekend .cal__day,
.cal__cell--future .cal__day,
.cal__cell--idle .cal__day {
  color: var(--ink-2);
}

.cal__times {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.1;
}

.cal__time {
  font-size: 9px;
  color: var(--ink-3);
}

.cal__time--warn {
  color: var(--warn-strong);
}

.cal__mark {
  font-size: 9px;
  color: var(--danger);
}

.cal__mark--progress {
  color: var(--primary);
}

/* 已批准请假：绿色系（PC 的浅绿底 + 深绿字，这里复用 ok 系 token，不新增 hex） */
.cal__mark--leave {
  color: var(--ok-text);
}

/* 状态底色：与 PC 的 att-done / att-partial / att-absent / att-rest 对应 */
.cal__cell--done {
  background: var(--ok-soft);
}

.cal__cell--partial {
  background: var(--warn-soft);
}

.cal__cell--absent {
  background: var(--danger-soft);
}

.cal__cell--leave {
  background: var(--ok-soft);
}

.cal__cell--in_progress {
  background: var(--info-soft);
}

.cal__cell--weekend,
.cal__cell--future,
.cal__cell--idle {
  background: transparent;
}

.cal__cell--today {
  box-shadow: inset 0 0 0 1px var(--brand);
}

.cal__cell--selected {
  background: var(--brand-soft);
  box-shadow: inset 0 0 0 2px var(--brand);
}

.cal__cell--selected .cal__day {
  color: var(--brand);
  font-weight: var(--weight-semibold);
}

.cal__grid--compact .cal__cell {
  height: 44px;
}

.cal__grid--compact .cal__time {
  font-size: 8px;
}
</style>
