<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import StatBadge from '../components/common/StatBadge.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';
import { useDeliveryStore } from '../stores/deliveryStore';
import { useStageProgress } from '../hooks/useStageProgress';
import { acceptancePassed, deliveryDriftHints, evaluateAcceptance, failedCheckLabels } from '../utils/acceptance';
import { curingInRange, formatDate } from '../utils/layer';
import type { DeliveryArchive } from '../types/delivery';

const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();
const deliveryStore = useDeliveryStore();
const { guqinNos } = useStageProgress();

const selectedGuqin = ref(guqinNos.value[0] ?? '');
watch(guqinNos, (list) => {
  if (!selectedGuqin.value && list.length) {
    selectedGuqin.value = list[0];
  }
});

/** 当前选中琴的实时验收门槛结论 */
const checks = computed(() =>
  selectedGuqin.value ? evaluateAcceptance(lacquerStore.layersOf(selectedGuqin.value), stringingStore.byGuqin(selectedGuqin.value)) : [],
);
const allPassed = computed(() => checks.value.length > 0 && acceptancePassed(checks.value));
const currentDelivered = computed(() => (selectedGuqin.value ? deliveryStore.deliveredOf(selectedGuqin.value) : undefined));
const currentPending = computed(() => (selectedGuqin.value ? deliveryStore.pendingOf(selectedGuqin.value) : undefined));

const inspector = ref('周砚秋');
const remark = ref('');

const totalVersions = computed(() => deliveryStore.archives.filter((a) => a.version > 0).length);

async function handleDeliver() {
  const record = await deliveryStore.deliver({ guqinNo: selectedGuqin.value, inspector: inspector.value, remark: remark.value });
  if (!record) {
    ElMessage.error('门槛未全部通过，或该琴已有有效交付（须先撤销），未能登记');
    return;
  }
  ElMessage.success(`已登记交付，档案版本 V${record.version}，板材 / 槽腹 / 灰胎 / 评语快照已冻结`);
  remark.value = '';
}

async function handleSavePending() {
  const record = await deliveryStore.savePending({ guqinNo: selectedGuqin.value, inspector: inspector.value, remark: remark.value });
  if (!record) {
    ElMessage.error('该琴已有有效交付，无需存待交付');
    return;
  }
  ElMessage.warning(`未达交付门槛，已存为待交付（缺：${failedCheckLabels(record.checks).join('、')}）`);
}

function goAccept(archive: DeliveryArchive) {
  selectedGuqin.value = archive.guqinNo;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function removePending(archive: DeliveryArchive) {
  const confirmed = await ElMessageBox.confirm(`确认删除 ${archive.guqinNo} 的待交付记录？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await deliveryStore.remove(archive.id);
  ElMessage.success('已删除待交付记录');
}

const revokeTarget = ref<DeliveryArchive | null>(null);
const revokeReason = ref('客户退回重髹');

function openRevoke(archive: DeliveryArchive) {
  revokeTarget.value = archive;
  revokeReason.value = '客户退回重髹';
}

async function confirmRevoke() {
  const target = revokeTarget.value;
  if (!target) return;
  await deliveryStore.revoke(target.id, revokeReason.value);
  ElMessage.success(`已撤销 ${target.guqinNo} 的交付，V${target.version} 留作上一版；重髹达标后重新交付将生成新版本号`);
  revokeTarget.value = null;
}

const viewing = ref<DeliveryArchive | null>(null);

/** 交付后变动提示：对照档案快照与当前工序记录（档案本身不变） */
const driftHints = computed(() => {
  const archive = viewing.value;
  if (!archive) return [];
  return deliveryDriftHints(archive, lacquerStore.layersOf(archive.guqinNo), stringingStore.byGuqin(archive.guqinNo));
});

function formatTime(value?: string): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—';
}

function versionLabel(archive: DeliveryArchive): string {
  return archive.version > 0 ? `V${archive.version}` : '—';
}
</script>

<template>
  <div>
    <h2 class="page-title">成琴验收与交付档案</h2>
    <p class="page-desc">
      髹过灰胎、每遍荫房温湿度都在工艺窗口（20~30℃ / 70~85%）、已上弦的琴才允许登记交付；未达标的先存成待交付。
      交付时把面板底板、槽腹尺寸、灰胎遍次与散音 / 按音 / 泛音评语冻结成档案，之后补髹漆或改评语，档案内容不跟着变；
      客户退回重髹可撤销交付，旧档案留作上一版，重新交付生成新版本号。
    </p>

    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :md="6">
        <StatBadge label="待交付" :value="deliveryStore.pendingList.length" unit="张" :status="deliveryStore.pendingList.length ? 'warning' : 'default'" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="已交付" :value="deliveryStore.deliveredList.length" unit="张" status="success" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="已撤销（历史版本）" :value="deliveryStore.revokedList.length" unit="版" :status="deliveryStore.revokedList.length ? 'danger' : 'default'" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="交付档案总版次" :value="totalVersions" unit="版" />
      </el-col>
    </el-row>

    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <span>验收登记</span>
          <span class="card-note">门槛：已髹灰胎 · 荫房温湿度全部在窗口 · 已上弦</span>
        </div>
      </template>

      <EmptyPanel v-if="guqinNos.length === 0" description="暂无在制琴坯，请先在板材登记页建档" />

      <template v-else>
        <div class="accept-toolbar">
          <span class="field-label">琴号</span>
          <el-select v-model="selectedGuqin" placeholder="选择琴号" style="width: 160px">
            <el-option v-for="no in guqinNos" :key="no" :label="no" :value="no" />
          </el-select>
          <el-tag v-if="currentDelivered" type="success">已交付 {{ versionLabel(currentDelivered) }}</el-tag>
          <el-tag v-else-if="currentPending" type="warning">待交付（已登记）</el-tag>
        </div>

        <el-alert
          v-if="currentDelivered"
          type="success"
          :closable="false"
          class="accept-alert"
          :title="`该琴已于 ${formatTime(currentDelivered.deliveredAt)} 交付（${versionLabel(currentDelivered)}，验收人 ${currentDelivered.inspector}）`"
          description="如需补髹或重髹，请先在下方「已交付」列表撤销交付；撤销后旧档案留作上一版，重新交付生成新版本号。"
        />

        <template v-else>
          <ul class="check-list">
            <li v-for="check in checks" :key="check.key" class="check-item">
              <el-tag :type="check.pass ? 'success' : 'danger'" size="small" class="check-tag">{{ check.pass ? '达标' : '未达标' }}</el-tag>
              <span class="check-label">{{ check.label }}</span>
              <span class="check-detail">{{ check.detail }}</span>
            </li>
          </ul>

          <div class="accept-form">
            <span class="field-label">验收人</span>
            <el-input v-model="inspector" placeholder="如：周砚秋" maxlength="16" style="width: 160px" />
            <span class="field-label">备注</span>
            <el-input v-model="remark" placeholder="验收备注（可空）" maxlength="60" style="width: 280px" />
            <el-button v-if="allPassed" type="primary" :disabled="!inspector.trim()" @click="handleDeliver">登记交付</el-button>
            <el-button v-else type="warning" :disabled="!inspector.trim()" @click="handleSavePending">
              {{ currentPending ? '更新待交付记录' : '存为待交付' }}
            </el-button>
          </div>
          <p class="accept-hint">
            {{ allPassed ? '门槛全部通过，可登记交付；交付后档案快照即冻结。' : '门槛未全部通过，只能先存成待交付，达标后再来登记交付。' }}
          </p>
        </template>
      </template>
    </el-card>

    <el-card shadow="never" class="block">
      <el-tabs>
        <el-tab-pane :label="`待交付 (${deliveryStore.pendingList.length})`">
          <EmptyPanel v-if="deliveryStore.pendingList.length === 0" description="暂无待交付琴" />
          <el-table v-else :data="deliveryStore.pendingList" size="small" border>
            <el-table-column prop="guqinNo" label="琴号" width="110" />
            <el-table-column label="登记时间" width="150">
              <template #default="scope">{{ formatTime(scope.row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="未达标项" min-width="200">
              <template #default="scope">
                <span class="missing">{{ failedCheckLabels(scope.row.checks).join('、') || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="inspector" label="验收人" width="100" />
            <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="scope">
                <el-button link type="primary" @click="goAccept(scope.row)">去验收</el-button>
                <el-button link type="danger" @click="removePending(scope.row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="`已交付 (${deliveryStore.deliveredList.length})`">
          <EmptyPanel v-if="deliveryStore.deliveredList.length === 0" description="暂无已交付档案" />
          <el-table v-else :data="deliveryStore.deliveredList" size="small" border>
            <el-table-column prop="guqinNo" label="琴号" width="110" />
            <el-table-column label="版本" width="80">
              <template #default="scope">
                <el-tag type="success" size="small">{{ versionLabel(scope.row) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="交付时间" width="150">
              <template #default="scope">{{ formatTime(scope.row.deliveredAt) }}</template>
            </el-table-column>
            <el-table-column prop="inspector" label="验收人" width="100" />
            <el-table-column label="灰胎（档案）" width="140">
              <template #default="scope">{{ scope.row.lacquerLayers.length }} 遍 / {{ scope.row.lacquerTotalMm.toFixed(2) }}mm</template>
            </el-table-column>
            <el-table-column label="散音评语（档案）" min-width="180" show-overflow-tooltip>
              <template #default="scope">{{ scope.row.tone?.sanNote ?? '—' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="170" fixed="right">
              <template #default="scope">
                <el-button link type="primary" @click="viewing = scope.row">查看档案</el-button>
                <el-button link type="danger" @click="openRevoke(scope.row)">撤销交付</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="`历史版本 (${deliveryStore.revokedList.length})`">
          <EmptyPanel v-if="deliveryStore.revokedList.length === 0" description="暂无已撤销的历史档案" />
          <el-table v-else :data="deliveryStore.revokedList" size="small" border>
            <el-table-column prop="guqinNo" label="琴号" width="110" />
            <el-table-column label="版本" width="80">
              <template #default="scope">
                <el-tag type="info" size="small">{{ versionLabel(scope.row) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="交付时间" width="150">
              <template #default="scope">{{ formatTime(scope.row.deliveredAt) }}</template>
            </el-table-column>
            <el-table-column label="撤销时间" width="150">
              <template #default="scope">{{ formatTime(scope.row.revokedAt) }}</template>
            </el-table-column>
            <el-table-column prop="revokeReason" label="撤销原因" min-width="180" show-overflow-tooltip />
            <el-table-column prop="inspector" label="验收人" width="100" />
            <el-table-column label="操作" width="110" fixed="right">
              <template #default="scope">
                <el-button link type="primary" @click="viewing = scope.row">查看档案</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog :model-value="Boolean(viewing)" title="交付档案（冻结快照）" width="880px" @close="viewing = null">
      <template v-if="viewing">
        <el-descriptions :column="3" border size="small" class="archive-meta">
          <el-descriptions-item label="琴号">{{ viewing.guqinNo }}</el-descriptions-item>
          <el-descriptions-item label="档案版本">
            <el-tag :type="viewing.status === '已交付' ? 'success' : 'info'" size="small">{{ versionLabel(viewing) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="viewing.status === '已交付' ? 'success' : 'warning'" size="small">{{ viewing.status }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="交付时间">{{ formatTime(viewing.deliveredAt) }}</el-descriptions-item>
          <el-descriptions-item label="验收人">{{ viewing.inspector }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{ viewing.remark || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="viewing.status === '已撤销'" label="撤销时间">{{ formatTime(viewing.revokedAt) }}</el-descriptions-item>
          <el-descriptions-item v-if="viewing.status === '已撤销'" label="撤销原因" :span="2">{{ viewing.revokeReason || '—' }}</el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="driftHints.length"
          type="info"
          :closable="false"
          class="archive-alert"
          :title="`交付后当前工序记录已有变动：${driftHints.join('；')}`"
          description="以上变动不影响本档案，档案数字与文字保持交付时原样。"
        />
        <el-alert v-else type="success" :closable="false" class="archive-alert" title="交付后工序记录与档案快照一致，无补髹漆或改评语。" />

        <h3 class="archive-section">面板底板</h3>
        <el-table v-if="viewing.boards.length" :data="viewing.boards" size="small" border>
          <el-table-column prop="boardNo" label="板材号" width="110" />
          <el-table-column prop="part" label="部位" width="80" />
          <el-table-column prop="species" label="树种" width="90" />
          <el-table-column prop="dryYears" label="阴干(年)" width="90" />
          <el-table-column prop="thicknessMm" label="厚度(mm)" width="90" />
          <el-table-column prop="grain" label="木纹" width="100" />
          <el-table-column prop="defect" label="缺陷" min-width="80" />
        </el-table>
        <el-empty v-else description="交付时无板材配对记录" :image-size="50" />

        <h3 class="archive-section">槽腹尺寸</h3>
        <el-descriptions v-if="viewing.chamber" :column="3" border size="small">
          <el-descriptions-item label="纳音处面板">{{ viewing.chamber.nayinThickness }}mm</el-descriptions-item>
          <el-descriptions-item label="龙池处面板">{{ viewing.chamber.longchiThickness }}mm</el-descriptions-item>
          <el-descriptions-item label="凤沼处面板">{{ viewing.chamber.fengzhaoThickness }}mm</el-descriptions-item>
          <el-descriptions-item label="槽腹深度">{{ viewing.chamber.chamberDepth }}mm</el-descriptions-item>
          <el-descriptions-item label="天地柱">{{ viewing.chamber.postPos }}</el-descriptions-item>
          <el-descriptions-item label="龙池凤沼">{{ viewing.chamber.poolSize }}</el-descriptions-item>
          <el-descriptions-item label="掏膛日期">{{ formatDate(viewing.chamber.carvedAt) }}</el-descriptions-item>
          <el-descriptions-item label="掏膛人" :span="2">{{ viewing.chamber.carver }}</el-descriptions-item>
        </el-descriptions>
        <el-empty v-else description="交付时无槽腹尺寸记录" :image-size="50" />

        <h3 class="archive-section">灰胎遍次（累计 {{ viewing.lacquerTotalMm.toFixed(2) }}mm）</h3>
        <el-table :data="viewing.lacquerLayers" size="small" border>
          <el-table-column prop="seq" label="遍次" width="70" />
          <el-table-column prop="mixRatio" label="灰胎配比" width="100" />
          <el-table-column prop="curingTemp" label="荫房温度(℃)" width="110" />
          <el-table-column prop="curingHumidity" label="湿度(%)" width="90" />
          <el-table-column label="温湿度" width="90">
            <template #default="scope">
              <el-tag :type="curingInRange(scope.row.curingTemp, scope.row.curingHumidity) ? 'success' : 'danger'" size="small">
                {{ curingInRange(scope.row.curingTemp, scope.row.curingHumidity) ? '窗口内' : '超窗口' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="polishGrit" label="打磨目数" width="90" />
          <el-table-column prop="layerThickness" label="本遍(mm)" width="90" />
          <el-table-column prop="totalThickness" label="累计(mm)" width="90" />
          <el-table-column label="施工日期" width="110">
            <template #default="scope">{{ formatDate(scope.row.appliedAt) }}</template>
          </el-table-column>
          <el-table-column prop="operator" label="髹漆人" min-width="90" />
        </el-table>

        <h3 class="archive-section">音色评语</h3>
        <template v-if="viewing.tone">
          <div class="tone-meta">
            <el-tag size="small" effect="plain">{{ viewing.tone.stringType }}</el-tag>
            <el-tag size="small" effect="plain">弦距 {{ viewing.tone.stringGap }}mm</el-tag>
            <el-tag v-for="defect in viewing.tone.defects" :key="defect" :type="defect === '无' ? 'success' : 'danger'" size="small" effect="plain">
              {{ defect }}
            </el-tag>
            <span class="tone-by">{{ formatDate(viewing.tone.strungAt) }} 上弦 · {{ viewing.tone.operator }}</span>
          </div>
          <dl class="tone-notes">
            <dt>散音</dt>
            <dd>{{ viewing.tone.sanNote }}</dd>
            <dt>按音</dt>
            <dd>{{ viewing.tone.anNote }}</dd>
            <dt>泛音</dt>
            <dd>{{ viewing.tone.fanNote }}</dd>
            <dt>九德</dt>
            <dd>{{ viewing.tone.nineVirtues }}</dd>
          </dl>
        </template>
        <el-empty v-else description="交付时无音色评语记录" :image-size="50" />
      </template>
      <template #footer>
        <el-button @click="viewing = null">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog :model-value="Boolean(revokeTarget)" title="撤销交付（退回重髹）" width="480px" @close="revokeTarget = null">
      <template v-if="revokeTarget">
        <p class="revoke-tip">
          撤销 {{ revokeTarget.guqinNo }} 的交付（{{ versionLabel(revokeTarget) }}）后，该档案留作上一版备查，内容不再变动；
          重髹达标后重新登记交付，将生成 V{{ revokeTarget.version + 1 }} 新档案。
        </p>
        <el-form label-width="90px">
          <el-form-item label="撤销原因" required>
            <el-input v-model="revokeReason" placeholder="如：客户退回重髹" maxlength="40" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="revokeTarget = null">取消</el-button>
        <el-button type="danger" :disabled="!revokeReason.trim()" @click="confirmRevoke">确认撤销</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #4a3728;
}
.page-desc {
  margin: 0 0 12px;
  color: #8a7a68;
  font-size: 13px;
  line-height: 1.7;
}
.stat-row {
  margin-bottom: 12px;
}
.stat-row .el-col {
  margin-bottom: 12px;
}
.block {
  margin-bottom: 16px;
  border-radius: 8px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-note {
  font-size: 12px;
  color: #8a7a68;
}
.accept-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.field-label {
  font-size: 13px;
  color: #8a7a68;
}
.accept-alert {
  margin-bottom: 4px;
}
.check-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  border: 1px solid #ece0cf;
  border-radius: 6px;
}
.check-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px dashed #ece0cf;
}
.check-item:last-child {
  border-bottom: none;
}
.check-tag {
  flex-shrink: 0;
}
.check-label {
  font-weight: 600;
  color: #4a3728;
  min-width: 220px;
}
.check-detail {
  font-size: 13px;
  color: #8a7a68;
}
.accept-form {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.accept-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #a3968a;
}
.missing {
  color: #c62828;
  font-size: 13px;
}
.archive-meta {
  margin-bottom: 12px;
}
.archive-alert {
  margin-bottom: 12px;
}
.archive-section {
  margin: 16px 0 8px;
  font-size: 14px;
  color: #4a3728;
  border-left: 3px solid #c8a97e;
  padding-left: 8px;
}
.tone-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.tone-by {
  font-size: 12px;
  color: #8a7a68;
}
.tone-notes {
  margin: 0;
  border: 1px solid #ece0cf;
  border-radius: 6px;
  padding: 10px 12px;
}
.tone-notes dt {
  font-weight: 600;
  color: #4a3728;
  margin-top: 6px;
}
.tone-notes dt:first-child {
  margin-top: 0;
}
.tone-notes dd {
  margin: 2px 0 0;
  color: #5c4f43;
  font-size: 13px;
  line-height: 1.7;
}
.revoke-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: #5c4f43;
  line-height: 1.7;
}
</style>
