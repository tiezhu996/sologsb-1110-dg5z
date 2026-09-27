import type { BoardPart, WoodGrain, WoodSpecies } from './wood-board';
import type { PostPos } from './sound-chamber';
import type { StringDefect, StringType } from './stringing';

/** 交付档案状态：待交付 → 已交付 →（退琴重髹）已撤销 */
export type DeliveryStatus = '待交付' | '已交付' | '已撤销';

/** 验收检查项（登记时随档案冻结） */
export interface AcceptanceCheck {
  key: 'boards' | 'chamber' | 'lacquer' | 'curing' | 'stringing';
  label: string;
  passed: boolean;
  detail: string;
}

/** 交付时冻结的面板 / 底板快照 */
export interface DeliveryBoardSnapshot {
  part: BoardPart;
  boardNo: string;
  species: WoodSpecies;
  dryYears: number;
  thicknessMm: number;
  grain: WoodGrain;
}

/** 交付时冻结的槽腹尺寸快照 */
export interface DeliveryChamberSnapshot {
  nayinThickness: number;
  longchiThickness: number;
  fengzhaoThickness: number;
  chamberDepth: number;
  postPos: PostPos;
  poolSize: string;
}

/** 交付时冻结的灰胎遍次快照 */
export interface DeliveryLayerSnapshot {
  seq: number;
  mixRatio: string;
  curingTemp: number;
  curingHumidity: number;
  polishGrit: number;
  layerThickness: number;
  appliedAt: string;
}

/** 交付时冻结的音色评语快照 */
export interface DeliveryToneSnapshot {
  stringType: StringType;
  stringGap: number;
  sanNote: string;
  anNote: string;
  fanNote: string;
  nineVirtues: string;
  defects: StringDefect[];
}

/**
 * 成琴交付档案。
 * 登记那一刻把面板底板、槽腹尺寸、灰胎遍次与音色评语深拷贝冻结在此；
 * 之后补髹漆、改评语等工序改动都不会回写本档案。
 * 退琴重髹时撤销交付，档案保留为上一版；重新交付生成新版本号。
 */
export interface Delivery {
  id: string;
  /** 琴号 */
  guqinNo: string;
  /** 交付版本号：同一琴号每交付一次 +1；待交付为 0（未占用版本号） */
  version: number;
  status: DeliveryStatus;
  /** 登记时的验收检查结果 */
  checks: AcceptanceCheck[];
  /** 面板底板快照 */
  boards: DeliveryBoardSnapshot[];
  /** 槽腹尺寸快照（登记时未掏膛则为空） */
  chamber: DeliveryChamberSnapshot | null;
  /** 灰胎遍次快照 */
  layers: DeliveryLayerSnapshot[];
  /** 灰胎累计厚度（mm），登记时冻结 */
  totalThickness: number;
  /** 音色评语快照（登记时未上弦则为空） */
  tone: DeliveryToneSnapshot | null;
  /** 登记时间 ISO */
  registeredAt: string;
  /** 交付时间 ISO（待交付为 null） */
  deliveredAt: string | null;
  /** 撤销交付时间 ISO（退琴重髹） */
  revokedAt: string | null;
  /** 撤销原因 */
  revokeReason: string | null;
  /** 交付人 */
  operator: string;
  /** 备注 */
  remark?: string;
}

export const DELIVERY_STATUSES: DeliveryStatus[] = ['待交付', '已交付', '已撤销'];
