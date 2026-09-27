import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import {
  acceptancePassed,
  evaluateAcceptance,
  toBoardSnapshots,
  toChamberSnapshot,
  toLacquerSnapshots,
  toToneSnapshot,
} from '../utils/acceptance';
import { cumulativeThickness } from '../utils/layer';
import { useBoardStore } from './boardStore';
import { useChamberStore } from './chamberStore';
import { useLacquerStore } from './lacquerStore';
import { useStringingStore } from './stringingStore';
import type { AcceptanceCheck, DeliveryArchive } from '../types/delivery';

export interface DeliveryInput {
  guqinNo: string;
  inspector: string;
  remark?: string;
}

interface DeliveryState {
  archives: DeliveryArchive[];
  hydrated: boolean;
}

/** 读取某琴当前工序数据并评估验收门槛 */
function currentChecks(guqinNo: string): AcceptanceCheck[] {
  const lacquerStore = useLacquerStore();
  const stringingStore = useStringingStore();
  return evaluateAcceptance(lacquerStore.layersOf(guqinNo), stringingStore.byGuqin(guqinNo));
}

/** 成琴验收与交付档案（档案快照冻结，撤销留作上一版） */
export const useDeliveryStore = defineStore('delivery', {
  state: (): DeliveryState => ({ archives: [], hydrated: false }),

  getters: {
    ofGuqin(state) {
      return (guqinNo: string): DeliveryArchive[] =>
        state.archives.filter((a) => a.guqinNo === guqinNo).sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt));
    },
    /** 该琴当前待交付记录（最多一条） */
    pendingOf(state) {
      return (guqinNo: string): DeliveryArchive | undefined =>
        state.archives.find((a) => a.guqinNo === guqinNo && a.status === '待交付');
    },
    /** 该琴当前有效的已交付档案（最多一条） */
    deliveredOf(state) {
      return (guqinNo: string): DeliveryArchive | undefined =>
        state.archives.find((a) => a.guqinNo === guqinNo && a.status === '已交付');
    },
    /** 下一版版本号：同一琴号历次档案最大版本 + 1 */
    nextVersion(state) {
      return (guqinNo: string): number =>
        state.archives.filter((a) => a.guqinNo === guqinNo).reduce((max, a) => Math.max(max, a.version), 0) + 1;
    },
    pendingList(state): DeliveryArchive[] {
      return state.archives.filter((a) => a.status === '待交付').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    deliveredList(state): DeliveryArchive[] {
      return state.archives.filter((a) => a.status === '已交付').sort((a, b) => (b.deliveredAt ?? '').localeCompare(a.deliveredAt ?? ''));
    },
    revokedList(state): DeliveryArchive[] {
      return state.archives.filter((a) => a.status === '已撤销').sort((a, b) => (b.revokedAt ?? '').localeCompare(a.revokedAt ?? ''));
    },
  },

  actions: {
    async hydrate() {
      this.archives = await db.deliveries.toArray();
      this.hydrated = true;
    },

    /**
     * 存成待交付：门槛未达标时先登记，记下未达标项；
     * 该琴已有待交付记录则更新验收结论，不重复建档。
     */
    async savePending(input: DeliveryInput): Promise<DeliveryArchive | null> {
      const guqinNo = input.guqinNo.trim();
      if (!guqinNo || this.deliveredOf(guqinNo)) return null;
      const checks = currentChecks(guqinNo);
      const existing = this.pendingOf(guqinNo);
      const record: DeliveryArchive = existing
        ? { ...existing, checks, inspector: input.inspector.trim(), remark: input.remark?.trim() || undefined }
        : {
            id: uid('delivery'),
            guqinNo,
            version: 0,
            status: '待交付',
            checks,
            inspector: input.inspector.trim(),
            remark: input.remark?.trim() || undefined,
            createdAt: new Date().toISOString(),
            boards: [],
            lacquerLayers: [],
            lacquerTotalMm: 0,
          };
      await db.deliveries.put(toPlain(record));
      this.archives = existing ? this.archives.map((a) => (a.id === record.id ? record : a)) : [record, ...this.archives];
      return record;
    },

    /**
     * 登记交付：重新评估门槛，全部通过才把当前板材 / 槽腹 / 灰胎 / 评语冻结为档案快照。
     * 已有待交付记录的，就地转为已交付并分配版本号；否则新建档案。
     * 返回 null 表示门槛未通过或该琴已有有效交付（须先撤销）。
     */
    async deliver(input: DeliveryInput): Promise<DeliveryArchive | null> {
      const guqinNo = input.guqinNo.trim();
      if (!guqinNo || this.deliveredOf(guqinNo)) return null;

      const boardStore = useBoardStore();
      const chamberStore = useChamberStore();
      const lacquerStore = useLacquerStore();
      const stringingStore = useStringingStore();

      const layers = lacquerStore.layersOf(guqinNo);
      const stringing = stringingStore.byGuqin(guqinNo);
      const checks = evaluateAcceptance(layers, stringing);
      if (!acceptancePassed(checks)) return null;

      const now = new Date().toISOString();
      const pending = this.pendingOf(guqinNo);
      const record: DeliveryArchive = {
        id: pending?.id ?? uid('delivery'),
        guqinNo,
        version: this.nextVersion(guqinNo),
        status: '已交付',
        checks,
        inspector: input.inspector.trim(),
        remark: input.remark?.trim() || undefined,
        createdAt: pending?.createdAt ?? now,
        deliveredAt: now,
        boards: toBoardSnapshots(boardStore.boardsOf(guqinNo)),
        chamber: toChamberSnapshot(chamberStore.byGuqin(guqinNo)),
        lacquerLayers: toLacquerSnapshots(layers),
        lacquerTotalMm: cumulativeThickness(layers),
        tone: toToneSnapshot(stringing),
      };
      await db.deliveries.put(toPlain(record));
      this.archives = pending ? this.archives.map((a) => (a.id === record.id ? record : a)) : [record, ...this.archives];
      return record;
    },

    /** 撤销交付（客户退回重髹）：档案留作上一版，快照内容不动 */
    async revoke(id: string, reason: string): Promise<void> {
      const current = this.archives.find((a) => a.id === id);
      if (!current || current.status !== '已交付') return;
      const next: DeliveryArchive = {
        ...current,
        status: '已撤销',
        revokedAt: new Date().toISOString(),
        revokeReason: reason.trim() || '客户退回重髹',
      };
      await db.deliveries.put(toPlain(next));
      this.archives = this.archives.map((a) => (a.id === id ? next : a));
    },

    /** 仅允许删除待交付记录；已交付 / 已撤销档案必须留存备查 */
    async remove(id: string): Promise<void> {
      const current = this.archives.find((a) => a.id === id);
      if (!current || current.status !== '待交付') return;
      await db.deliveries.delete(id);
      this.archives = this.archives.filter((a) => a.id !== id);
    },
  },
});
