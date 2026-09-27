import type { LacquerLayer } from '../types/lacquer-layer';
import type { Stringing } from '../types/stringing';
import type { WoodBoard } from '../types/wood-board';
import type { SoundChamber } from '../types/sound-chamber';
import type {
  AcceptanceCheck,
  BoardSnapshot,
  ChamberSnapshot,
  DeliveryArchive,
  LacquerSnapshot,
  ToneSnapshot,
} from '../types/delivery';
import { cumulativeThickness, curingInRange, formatDate, sortLayers } from './layer';

/**
 * 成琴验收门槛：髹过灰胎、每遍荫房温湿度都在工艺窗口、已经上过弦。
 * 三项全部通过才允许登记交付，否则只能先存成待交付。
 */
export function evaluateAcceptance(layers: LacquerLayer[], stringing: Stringing | undefined): AcceptanceCheck[] {
  const sorted = sortLayers(layers);
  const outOfRange = sorted.filter((layer) => !curingInRange(layer.curingTemp, layer.curingHumidity));
  return [
    {
      key: 'lacquer',
      label: '已髹灰胎',
      pass: sorted.length > 0,
      detail: sorted.length ? `已髹 ${sorted.length} 遍，累计 ${cumulativeThickness(sorted).toFixed(2)}mm` : '尚无髹漆遍次记录',
    },
    {
      key: 'curing',
      label: '荫房温湿度全部在工艺窗口',
      pass: sorted.length > 0 && outOfRange.length === 0,
      detail:
        sorted.length === 0
          ? '尚无髹漆遍次记录'
          : outOfRange.length === 0
            ? `${sorted.length} 遍均在 20~30℃ / 70~85% 窗口内`
            : `第 ${outOfRange.map((layer) => layer.seq).join('、')} 遍超窗口（${outOfRange
                .map((layer) => `${layer.curingTemp}℃/${layer.curingHumidity}%`)
                .join('，')}）`,
    },
    {
      key: 'stringing',
      label: '已上弦',
      pass: Boolean(stringing),
      detail: stringing ? `${stringing.stringType}，${formatDate(stringing.strungAt)} 上弦，弦距 ${stringing.stringGap}mm` : '尚无上弦记录',
    },
  ];
}

/** 门槛是否全部通过 */
export function acceptancePassed(checks: AcceptanceCheck[]): boolean {
  return checks.every((check) => check.pass);
}

/** 未达标项名称（待交付列表展示用） */
export function failedCheckLabels(checks: AcceptanceCheck[]): string[] {
  return checks.filter((check) => !check.pass).map((check) => check.label);
}

/** 板材 → 交付快照 */
export function toBoardSnapshots(boards: WoodBoard[]): BoardSnapshot[] {
  return boards.map((board) => ({
    boardNo: board.boardNo,
    part: board.part,
    species: board.species,
    dryYears: board.dryYears,
    thicknessMm: board.thicknessMm,
    grain: board.grain,
    defect: board.defect,
  }));
}

/** 槽腹 → 交付快照 */
export function toChamberSnapshot(chamber: SoundChamber | undefined): ChamberSnapshot | undefined {
  if (!chamber) return undefined;
  return {
    nayinThickness: chamber.nayinThickness,
    longchiThickness: chamber.longchiThickness,
    fengzhaoThickness: chamber.fengzhaoThickness,
    chamberDepth: chamber.chamberDepth,
    postPos: chamber.postPos,
    poolSize: chamber.poolSize,
    carvedAt: chamber.carvedAt,
    carver: chamber.carver,
  };
}

/** 灰胎遍次 → 交付快照（按遍次升序） */
export function toLacquerSnapshots(layers: LacquerLayer[]): LacquerSnapshot[] {
  return sortLayers(layers).map((layer) => ({
    seq: layer.seq,
    mixRatio: layer.mixRatio,
    curingTemp: layer.curingTemp,
    curingHumidity: layer.curingHumidity,
    polishGrit: layer.polishGrit,
    layerThickness: layer.layerThickness,
    totalThickness: layer.totalThickness,
    appliedAt: layer.appliedAt,
    operator: layer.operator,
  }));
}

/** 上弦与评语 → 交付快照 */
export function toToneSnapshot(stringing: Stringing | undefined): ToneSnapshot | undefined {
  if (!stringing) return undefined;
  return {
    stringType: stringing.stringType,
    stringGap: stringing.stringGap,
    sanNote: stringing.sanNote,
    anNote: stringing.anNote,
    fanNote: stringing.fanNote,
    nineVirtues: stringing.nineVirtues,
    defects: [...stringing.defects],
    strungAt: stringing.strungAt,
    operator: stringing.operator,
  };
}

const TONE_FIELD_LABELS: Array<{ key: keyof Pick<ToneSnapshot, 'sanNote' | 'anNote' | 'fanNote' | 'nineVirtues'>; label: string }> = [
  { key: 'sanNote', label: '散音' },
  { key: 'anNote', label: '按音' },
  { key: 'fanNote', label: '泛音' },
  { key: 'nineVirtues', label: '九德' },
];

/**
 * 交付后变动提示：把档案快照与当前工序记录对照，列出交付之后的补髹漆 / 改评语等出入。
 * 档案本身不变，这里只是帮档案员一眼看出「交付后又改过什么」。
 */
export function deliveryDriftHints(
  archive: DeliveryArchive,
  currentLayers: LacquerLayer[],
  currentStringing: Stringing | undefined,
): string[] {
  if (archive.status === '待交付') return [];
  const hints: string[] = [];
  const currentTotal = cumulativeThickness(currentLayers);
  if (currentLayers.length !== archive.lacquerLayers.length) {
    hints.push(`髹漆遍次 档案 ${archive.lacquerLayers.length} 遍 → 当前 ${currentLayers.length} 遍`);
  }
  if (Number(currentTotal.toFixed(3)) !== Number(archive.lacquerTotalMm.toFixed(3))) {
    hints.push(`累计灰胎 档案 ${archive.lacquerTotalMm.toFixed(2)}mm → 当前 ${currentTotal.toFixed(2)}mm`);
  }
  if (archive.tone) {
    if (!currentStringing) {
      hints.push('上弦记录已被删除');
    } else {
      const changed = TONE_FIELD_LABELS.filter(({ key }) => currentStringing[key] !== archive.tone?.[key]).map(({ label }) => label);
      if (changed.length) {
        hints.push(`评语已修改（${changed.join('、')}）`);
      }
    }
  }
  return hints;
}
