import type { BoardPart, WoodDefect, WoodGrain, WoodSpecies } from './wood-board';
import type { PostPos } from './sound-chamber';
import type { StringDefect, StringType } from './stringing';

/** 交付档案状态：待交付（未达门槛先存档）/ 已交付 / 已撤销（退回重髹，留作上一版） */
export type DeliveryStatus = '待交付' | '已交付' | '已撤销';

/** 验收门槛检查项 */
export interface AcceptanceCheck {
  key: 'lacquer' | 'curing' | 'stringing';
  label: string;
  pass: boolean;
  detail: string;
}

/** 交付时冻结的板材快照（面板 / 底板） */
export interface BoardSnapshot {
  boardNo: string;
  part: BoardPart;
  species: WoodSpecies;
  dryYears: number;
  thicknessMm: number;
  grain: WoodGrain;
  defect: WoodDefect;
}

/** 交付时冻结的槽腹尺寸快照 */
export interface ChamberSnapshot {
  nayinThickness: number;
  longchiThickness: number;
  fengzhaoThickness: number;
  chamberDepth: number;
  postPos: PostPos;
  poolSize: string;
  carvedAt: string;
  carver: string;
}

/** 交付时冻结的灰胎遍次快照 */
export interface LacquerSnapshot {
  seq: number;
  mixRatio: string;
  curingTemp: number;
  curingHumidity: number;
  polishGrit: number;
  layerThickness: number;
  totalThickness: number;
  appliedAt: string;
  operator: string;
}

/** 交付时冻结的音色评语快照（散音 / 按音 / 泛音 / 九德） */
export interface ToneSnapshot {
  stringType: StringType;
  stringGap: number;
  sanNote: string;
  anNote: string;
  fanNote: string;
  nineVirtues: string;
  defects: StringDefect[];
  strungAt: string;
  operator: string;
}

/**
 * 成琴交付档案。
 * 交付时把板材、槽腹、灰胎遍次与音色评语整体冻结为快照：
 * 之后补髹漆、改评语只动工序记录，不回写本档案。
 * 客户退回重髹时撤销交付，本档案留作上一版；重新交付生成新版本号。
 */
export interface DeliveryArchive {
  id: string;
  /** 琴号 */
  guqinNo: string;
  /** 版本号：同一琴号首次交付为 1，撤销后重新交付递增；待交付为 0（尚未分配） */
  version: number;
  status: DeliveryStatus;
  /** 登记时的验收门槛结论快照 */
  checks: AcceptanceCheck[];
  /** 验收人 */
  inspector: string;
  /** 备注 */
  remark?: string;
  /** 记录创建时间 ISO（待交付首次登记时间） */
  createdAt: string;
  /** 交付时间 ISO */
  deliveredAt?: string;
  /** 撤销时间 ISO（退回重髹时填写） */
  revokedAt?: string;
  /** 撤销原因 */
  revokeReason?: string;
  /** 面板底板快照 */
  boards: BoardSnapshot[];
  /** 槽腹尺寸快照（交付时无槽腹记录则为空） */
  chamber?: ChamberSnapshot;
  /** 灰胎遍次快照 */
  lacquerLayers: LacquerSnapshot[];
  /** 灰胎累计厚度快照（mm） */
  lacquerTotalMm: number;
  /** 音色评语快照 */
  tone?: ToneSnapshot;
}

export const DELIVERY_STATUSES: DeliveryStatus[] = ['待交付', '已交付', '已撤销'];
