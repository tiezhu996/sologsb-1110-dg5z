import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { AcceptanceCheck, Delivery } from '../types/delivery';
import type { DeliverySnapshot } from '../utils/delivery';

export interface DeliveryRegisterInput {
  guqinNo: string;
  /** 登记时的验收检查结果 */
  checks: AcceptanceCheck[];
  /** 登记时刻冻结的工序快照 */
  snapshot: DeliverySnapshot;
  operator: string;
  remark?: string;
}

interface DeliveryState {
  deliveries: Delivery[];
  hydrated: boolean;
}

/** 成琴交付档案：快照冻结后不再随工序数据变化，撤销只改状态不删档案 */
export const useDeliveryStore = defineStore('delivery', {
  state: (): DeliveryState => ({ deliveries: [], hydrated: false }),

  getters: {
    /** 该琴当前的待交付验收单（每琴最多一张） */
    pendingOf(state) {
      return (guqinNo: string): Delivery | undefined =>
        state.deliveries.find((d) => d.guqinNo === guqinNo && d.status === '待交付');
    },
    /** 该琴当前有效的交付档案 */
    activeOf(state) {
      return (guqinNo: string): Delivery | undefined =>
        state.deliveries.find((d) => d.guqinNo === guqinNo && d.status === '已交付');
    },
    /** 该琴已占用的交付版本（含已撤销），版本号倒序 */
    versionsOf(state) {
      return (guqinNo: string): Delivery[] =>
        state.deliveries.filter((d) => d.guqinNo === guqinNo && d.version > 0).sort((a, b) => b.version - a.version);
    },
    /** 下一次交付应使用的版本号 */
    nextVersionOf(state) {
      return (guqinNo: string): number =>
        state.deliveries.filter((d) => d.guqinNo === guqinNo).reduce((max, d) => Math.max(max, d.version), 0) + 1;
    },
    deliveredCount(state): number {
      return state.deliveries.filter((d) => d.status === '已交付').length;
    },
    pendingCount(state): number {
      return state.deliveries.filter((d) => d.status === '待交付').length;
    },
    revokedCount(state): number {
      return state.deliveries.filter((d) => d.status === '已撤销').length;
    },
  },

  actions: {
    async hydrate() {
      this.deliveries = await db.deliveries.orderBy('registeredAt').reverse().toArray();
      this.hydrated = true;
    },

    /** 存为待交付：每琴一张验收单，重复保存则刷新快照与检查结果 */
    async savePending(input: DeliveryRegisterInput): Promise<Delivery> {
      const existed = this.deliveries.find((d) => d.guqinNo === input.guqinNo && d.status === '待交付');
      const delivery: Delivery = {
        id: existed?.id ?? uid('delivery'),
        guqinNo: input.guqinNo.trim(),
        version: 0,
        status: '待交付',
        checks: input.checks,
        boards: input.snapshot.boards,
        chamber: input.snapshot.chamber,
        layers: input.snapshot.layers,
        totalThickness: input.snapshot.totalThickness,
        tone: input.snapshot.tone,
        registeredAt: new Date().toISOString(),
        deliveredAt: null,
        revokedAt: null,
        revokeReason: null,
        operator: input.operator.trim(),
        remark: input.remark?.trim() || undefined,
      };
      await db.deliveries.put(toPlain(delivery));
      this.deliveries = existed
        ? this.deliveries.map((d) => (d.id === delivery.id ? delivery : d))
        : [delivery, ...this.deliveries];
      return delivery;
    },

    /** 登记交付：冻结交付时刻快照并分配新版本号；有待交付单则转为正式交付 */
    async deliver(input: DeliveryRegisterInput): Promise<Delivery> {
      const pending = this.deliveries.find((d) => d.guqinNo === input.guqinNo && d.status === '待交付');
      const version = this.nextVersionOf(input.guqinNo);
      const now = new Date().toISOString();
      const delivery: Delivery = {
        id: pending?.id ?? uid('delivery'),
        guqinNo: input.guqinNo.trim(),
        version,
        status: '已交付',
        checks: input.checks,
        boards: input.snapshot.boards,
        chamber: input.snapshot.chamber,
        layers: input.snapshot.layers,
        totalThickness: input.snapshot.totalThickness,
        tone: input.snapshot.tone,
        registeredAt: pending?.registeredAt ?? now,
        deliveredAt: now,
        revokedAt: null,
        revokeReason: null,
        operator: input.operator.trim(),
        remark: input.remark?.trim() || undefined,
      };
      await db.deliveries.put(toPlain(delivery));
      this.deliveries = pending
        ? this.deliveries.map((d) => (d.id === delivery.id ? delivery : d))
        : [delivery, ...this.deliveries];
      return delivery;
    },

    /** 撤销交付（退琴重髹）：档案保留为上一版，不删除 */
    async revoke(id: string, reason: string) {
      const current = this.deliveries.find((d) => d.id === id);
      if (!current || current.status !== '已交付') return;
      const next: Delivery = {
        ...current,
        status: '已撤销',
        revokedAt: new Date().toISOString(),
        revokeReason: reason.trim() || '客户退回重髹',
      };
      await db.deliveries.put(toPlain(next));
      this.deliveries = this.deliveries.map((d) => (d.id === id ? next : d));
    },

    /** 删除待交付验收单（已交付 / 已撤销档案不允许删除，留作追溯） */
    async removePending(id: string) {
      const current = this.deliveries.find((d) => d.id === id);
      if (!current || current.status !== '待交付') return;
      await db.deliveries.delete(id);
      this.deliveries = this.deliveries.filter((d) => d.id !== id);
    },
  },
});
