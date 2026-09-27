import type { LacquerLayer } from '../types/lacquer-layer';
import type { SoundChamber } from '../types/sound-chamber';
import type { Stringing } from '../types/stringing';
import type { WoodBoard } from '../types/wood-board';
import type {
  AcceptanceCheck,
  DeliveryBoardSnapshot,
  DeliveryChamberSnapshot,
  DeliveryLayerSnapshot,
  DeliveryToneSnapshot,
} from '../types/delivery';
import { curingInRange, cumulativeThickness, sortLayers } from './layer';

/** 验收输入：一张琴在各工序的当前记录 */
export interface AcceptanceSource {
  panel?: WoodBoard;
  base?: WoodBoard;
  chamber?: SoundChamber;
  layers: LacquerLayer[];
  stringing?: Stringing;
}

/**
 * 成琴验收五项检查，全部通过才允许登记交付：
 * 面板底板配对、槽腹尺寸已记录、髹过灰胎、每遍荫房温湿度都在工艺窗口、已上弦。
 */
export function evaluateAcceptance(source: AcceptanceSource): AcceptanceCheck[] {
  const layers = sortLayers(source.layers);
  const outOfRange = layers.filter((layer) => !curingInRange(layer.curingTemp, layer.curingHumidity));
  return [
    {
      key: 'boards',
      label: '面板底板配对',
      passed: Boolean(source.panel && source.base),
      detail:
        source.panel && source.base
          ? `${source.panel.species}面板 ${source.panel.thicknessMm}mm + ${source.base.species}底板 ${source.base.thicknessMm}mm`
          : '面板或底板尚未配对',
    },
    {
      key: 'chamber',
      label: '槽腹尺寸已记录',
      passed: Boolean(source.chamber),
      detail: source.chamber
        ? `槽腹深 ${source.chamber.chamberDepth}mm，纳音 ${source.chamber.nayinThickness}mm，天地柱 ${source.chamber.postPos}`
        : '尚无槽腹尺寸记录',
    },
    {
      key: 'lacquer',
      label: '已髹灰胎',
      passed: layers.length > 0,
      detail: layers.length ? `${layers.length} 遍，累计 ${cumulativeThickness(layers).toFixed(2)}mm` : '尚无灰胎遍次记录',
    },
    {
      key: 'curing',
      label: '荫房温湿度全在窗口',
      passed: layers.length > 0 && outOfRange.length === 0,
      detail:
        layers.length === 0
          ? '尚无髹漆记录'
          : outOfRange.length === 0
            ? `${layers.length} 遍均在 20~30℃ / 70~85% 窗口内`
            : `第 ${outOfRange.map((layer) => layer.seq).join('、')} 遍超窗口`,
    },
    {
      key: 'stringing',
      label: '已上弦',
      passed: Boolean(source.stringing),
      detail: source.stringing ? `${source.stringing.stringType}，弦距 ${source.stringing.stringGap}mm` : '尚未上弦',
    },
  ];
}

/** 验收是否全部通过 */
export function acceptancePassed(checks: AcceptanceCheck[]): boolean {
  return checks.every((check) => check.passed);
}

/** 交付快照：登记时刻的工序数据，冻结后不再随工序表变化 */
export interface DeliverySnapshot {
  boards: DeliveryBoardSnapshot[];
  chamber: DeliveryChamberSnapshot | null;
  layers: DeliveryLayerSnapshot[];
  totalThickness: number;
  tone: DeliveryToneSnapshot | null;
}

/** 从当前工序记录构建交付快照（逐字段摘取，不带源表 id） */
export function buildDeliverySnapshot(source: AcceptanceSource): DeliverySnapshot {
  const boards: DeliveryBoardSnapshot[] = [source.panel, source.base]
    .filter((board): board is WoodBoard => Boolean(board))
    .map((board) => ({
      part: board.part,
      boardNo: board.boardNo,
      species: board.species,
      dryYears: board.dryYears,
      thicknessMm: board.thicknessMm,
      grain: board.grain,
    }));

  const chamber: DeliveryChamberSnapshot | null = source.chamber
    ? {
        nayinThickness: source.chamber.nayinThickness,
        longchiThickness: source.chamber.longchiThickness,
        fengzhaoThickness: source.chamber.fengzhaoThickness,
        chamberDepth: source.chamber.chamberDepth,
        postPos: source.chamber.postPos,
        poolSize: source.chamber.poolSize,
      }
    : null;

  const layers: DeliveryLayerSnapshot[] = sortLayers(source.layers).map((layer) => ({
    seq: layer.seq,
    mixRatio: layer.mixRatio,
    curingTemp: layer.curingTemp,
    curingHumidity: layer.curingHumidity,
    polishGrit: layer.polishGrit,
    layerThickness: layer.layerThickness,
    appliedAt: layer.appliedAt,
  }));

  const tone: DeliveryToneSnapshot | null = source.stringing
    ? {
        stringType: source.stringing.stringType,
        stringGap: source.stringing.stringGap,
        sanNote: source.stringing.sanNote,
        anNote: source.stringing.anNote,
        fanNote: source.stringing.fanNote,
        nineVirtues: source.stringing.nineVirtues,
        defects: [...source.stringing.defects],
      }
    : null;

  return { boards, chamber, layers, totalThickness: cumulativeThickness(source.layers), tone };
}
