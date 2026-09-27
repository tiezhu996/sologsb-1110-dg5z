<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import StatBadge from '../components/common/StatBadge.vue';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import { useBoardStore } from '../stores/boardStore';
import { useChamberStore } from '../stores/chamberStore';
import { useLacquerStore } from '../stores/lacquerStore';
import { useStringingStore } from '../stores/stringingStore';
import { useDeliveryStore } from '../stores/deliveryStore';
import { acceptancePassed, buildDeliverySnapshot, evaluateAcceptance, type AcceptanceSource } from '../utils/delivery';
import { curingInRange, formatDate } from '../utils/layer';
import { DELIVERY_STATUSES, type Delivery, type DeliveryStatus } from '../types/delivery';

const route = useRoute();
const boardStore = useBoardStore();
const chamberStore = useChamberStore();
const lacquerStore = useLacquerStore();
const stringingStore = useStringingStore();
const deliveryStore = useDeliveryStore();

/** 全部在制琴号（聚合各工序表） */
const guqinOptions = computed(() => {
  const set = new Set<string>();
  boardStore.boards.forEach((b) => set.add(b.guqinNo));
  chamberStore.chambers.forEach((c) => set.add(c.guqinNo));
  lacquerStore.layers.forEach((l) => set.add(l.guqinNo));
  stringingStore.stringings.forEach((s) => set.add(s.guqinNo));
  return Array.from(set).sort();
});

const selectedGuqin = ref('');
watch(
  guqinOptions,
  (list) => {
    if (!selectedGuqin.value && list.length) {
      selectedGuqin.value = list[0];
    }
  },
  { immediate: true },
);

/** 选中琴的当前工序记录（验收与快照的数据源） */
const source = computed<AcceptanceSource>(() => {
  const no = selectedGuqin.value;
  const boards = boardStore.boardsOf(no);
  return {
    panel: boards.find((b) => b.part === '面板'),
    base: boards.find((b) => b.part === '底板'),
    chamber: chamberStore.byGuqin(no),
    layers: lacquerStore.layersOf(no),
    stringing: stringingStore.byGuqin(no),
  };
});

const checks = computed(() => evaluateAcceptance(source.value));
const allPassed = computed(() => acceptancePassed(checks.value));
const failedLabels = computed(() => checks.value.filter((c) => !c.passed).map((c) => c.label).join('、'));

const activeDelivery = computed(() => (selectedGuqin.value ? deliveryStore.activeOf(selectedGuqin.value) : undefined));
const pendingDelivery = computed(() => (selectedGuqin.value ? deliveryStore.pendingOf(selectedGuqin.value) : undefined));
const lastRevoked = computed(() =>
  selectedGuqin.value ? deliveryStore.versionsOf(selectedGuqin.value).find((v) => v.status === '已撤销') : undefined,
);
/** 验收全过且当前无有效交付档案时才允许登记交付 */
const canDeliver = computed(() => Boolean(selectedGuqin.value) && allPassed.value && !activeDelivery.value);

/* ---------- 登记对话框（存为待交付 / 登记交付共用） ---------- */
type DialogMode = 'pending' | 'deliver';
const dialogMode = ref<DialogMode>('deliver');
const dialogVisible = ref(false);
const formRef = ref<FormInstance>();
const dialogForm = ref({ operator: '周砚秋', remark: '' });
const dialogRules: FormRules = {
  operator: [{ required: true, message: '请输入交付人', trigger: 'blur' }],
};

function openDialog(mode: DialogMode) {
  if (!selectedGuqin.value) {
    ElMessage.warning('请先选择琴号');
    return;
  }
  dialogMode.value = mode;
  dialogForm.value = { operator: '周砚秋', remark: '' };
  dialogVisible.value = true;
}

async function submitDialog() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  const input = {
    guqinNo: selectedGuqin.value,
    checks: checks.value,
    snapshot: buildDeliverySnapshot(source.value),
    operator: dialogForm.value.operator,
    remark: dialogForm.value.remark,
  };
  if (dialogMode.value === 'deliver') {
    const delivery = await deliveryStore.deliver(input);
    ElMessage.success(`已登记交付，档案版本 v${delivery.version}，内容已冻结`);
  } else {
    await deliveryStore.savePending(input);
    ElMessage.success('已存为待交付，验收达标后可登记交付');
  }
  dialogVisible.value = false;
}

/* ---------- 撤销交付 / 删除待交付 ---------- */
async function revoke(delivery: Delivery) {
  const reason = await ElMessageBox.prompt(
    `${delivery.guqinNo} v${delivery.version} 撤销后档案保留为上一版，重新交付将生成新版本号。`,
    '撤销交付（退琴重髹）',
    {
      confirmButtonText: '撤销交付',
      cancelButtonText: '取消',
      inputValue: '客户退回，重髹漆',
      inputPlaceholder: '撤销原因',
      inputValidator: (value: string) => Boolean(value?.trim()) || '请填写撤销原因',
      type: 'warning',
    },
  )
    .then(({ value }) => value)
    .catch(() => null);
  if (reason === null) return;
  await deliveryStore.revoke(delivery.id, reason);
  ElMessage.success(`已撤销交付，v${delivery.version} 留作历史版本`);
}

async function removePending(delivery: Delivery) {
  const confirmed = await ElMessageBox.confirm(`确认删除 ${delivery.guqinNo} 的待交付验收单？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await deliveryStore.removePending(delivery.id);
  ElMessage.success('已删除待交付验收单');
}

/* ---------- 档案详情（只读快照） ---------- */
const detailId = ref('');
const detailVisible = ref(false);
const detail = computed(() => deliveryStore.deliveries.find((d) => d.id === detailId.value) ?? null);

function openDetail(delivery: Delivery) {
  detailId.value = delivery.id;
  detailVisible.value = true;
}

/* ---------- 档案列表筛选 ---------- */
const statusParam = computed(() => (typeof route.query.status === 'string' ? route.query.status : ''));
const keyword = computed(() => (typeof route.query.kw === 'string' ? route.query.kw : ''));

const visible = computed(() =>
  deliveryStore.deliveries.filter((delivery) => {
    if (statusParam.value && delivery.status !== statusParam.value) return false;
    const kw = keyword.value.trim().toLowerCase();
    if (kw && ![delivery.guqinNo, delivery.operator, delivery.remark ?? ''].join(' ').toLowerCase().includes(kw)) {
      return false;
    }
    return true;
  }),
);

function statusTagType(status: DeliveryStatus): 'success' | 'warning' | 'info' {
  if (status === '已交付') return 'success';
  if (status === '待交付') return 'warning';
  return 'info';
}
</script>

<template>
  <div>
    <h2 class="page-title">成琴验收与交付档案</h2>
    <p class="page-desc">
      髹过灰胎、每遍荫房温湿度都在工艺窗口、已上弦的琴才允许登记交付；未达标可先存为待交付。
      交付档案在登记时刻冻结，之后补髹漆或改评语都不会改变档案内容；退琴重髹可撤销交付，旧档案留作上一版。
    </p>

    <el-row :gutter="12" class="stat-row">
      <el-col :xs="12" :md="6">
        <StatBadge label="已交付" :value="deliveryStore.deliveredCount" unit="张" status="success" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="待交付" :value="deliveryStore.pendingCount" unit="张" :status="deliveryStore.pendingCount ? 'warning' : 'default'" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="已撤销（历史版本）" :value="deliveryStore.revokedCount" unit="版" :status="deliveryStore.revokedCount ? 'danger' : 'default'" />
      </el-col>
      <el-col :xs="12" :md="6">
        <StatBadge label="交付档案" :value="deliveryStore.deliveries.length" unit="份" />
      </el-col>
    </el-row>

    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <span>验收台</span>
          <span class="card-note">五项检查全部通过才允许登记交付</span>
        </div>
      </template>

      <div class="accept-bar">
        <el-select v-model="selectedGuqin" placeholder="选择琴号" style="width: 180px">
          <el-option v-for="no in guqinOptions" :key="no" :label="no" :value="no" />
        </el-select>
        <el-tag v-if="activeDelivery" type="success">已交付 · v{{ activeDelivery.version }}</el-tag>
        <el-tag v-else-if="pendingDelivery" type="warning">待交付（已存验收单）</el-tag>
        <el-tag v-else type="info" effect="plain">未登记</el-tag>
        <span v-if="lastRevoked" class="card-note">上一版 v{{ lastRevoked.version }} 已撤销：{{ lastRevoked.revokeReason }}</span>
      </div>

      <el-table :data="checks" size="small" border class="check-table">
        <el-table-column prop="label" label="验收检查项" width="180" />
        <el-table-column label="结果" width="90">
          <template #default="scope">
            <el-tag :type="scope.row.passed ? 'success' : 'danger'" size="small">{{ scope.row.passed ? '通过' : '未通过' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="detail" label="明细" min-width="320" />
      </el-table>

      <div class="accept-actions">
        <el-button :disabled="Boolean(activeDelivery)" @click="openDialog('pending')">存为待交付</el-button>
        <el-button type="primary" :disabled="!canDeliver" @click="openDialog('deliver')">登记交付</el-button>
        <span v-if="activeDelivery" class="warn-text">该琴已交付，退琴重髹请先在下方档案列表撤销交付</span>
        <span v-else-if="!allPassed" class="warn-text">未达标项：{{ failedLabels }}，可先存为待交付</span>
        <span v-else class="ok-text">验收全部通过，可登记交付（将生成 v{{ deliveryStore.nextVersionOf(selectedGuqin) }}）</span>
      </div>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>
        <div class="card-head">
          <span>交付档案</span>
          <span class="card-note">档案内容为登记时刻冻结的快照，不随后续工序改动</span>
        </div>
      </template>

      <FilterBar
        :fields="[{ key: 'status', label: '状态', options: DELIVERY_STATUSES, width: 120 }]"
        keyword-placeholder="搜索琴号 / 交付人 / 备注"
        :result-count="visible.length"
        :total-count="deliveryStore.deliveries.length"
      />

      <EmptyPanel v-if="visible.length === 0" description="暂无符合条件的交付档案" />

      <el-table v-else :data="visible" size="small" border>
        <el-table-column prop="guqinNo" label="琴号" width="100" />
        <el-table-column label="版本" width="70">
          <template #default="scope">{{ scope.row.version > 0 ? `v${scope.row.version}` : '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="scope">
            <el-tag :type="statusTagType(scope.row.status)" size="small">{{ scope.row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="灰胎" width="120">
          <template #default="scope">{{ scope.row.layers.length }} 遍 / {{ scope.row.totalThickness.toFixed(2) }}mm</template>
        </el-table-column>
        <el-table-column label="登记时间" width="105">
          <template #default="scope">{{ formatDate(scope.row.registeredAt) }}</template>
        </el-table-column>
        <el-table-column label="交付时间" width="105">
          <template #default="scope">{{ scope.row.deliveredAt ? formatDate(scope.row.deliveredAt) : '—' }}</template>
        </el-table-column>
        <el-table-column label="撤销信息" min-width="170">
          <template #default="scope">
            <span v-if="scope.row.revokedAt">{{ formatDate(scope.row.revokedAt) }} · {{ scope.row.revokeReason }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="operator" label="交付人" width="90" />
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openDetail(scope.row)">查看档案</el-button>
            <el-button v-if="scope.row.status === '已交付'" link type="danger" @click="revoke(scope.row)">撤销交付</el-button>
            <el-button v-if="scope.row.status === '待交付'" link type="danger" @click="removePending(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'deliver' ? `登记交付 · ${selectedGuqin}` : `存为待交付 · ${selectedGuqin}`"
      width="480px"
    >
      <el-alert
        v-if="dialogMode === 'deliver'"
        type="success"
        :closable="false"
        show-icon
        title="交付后档案内容冻结，后续补髹漆或改评语不会影响本档案"
        class="dialog-alert"
      />
      <el-alert v-else type="warning" :closable="false" show-icon title="当前验收未全部通过，先存为待交付；达标后再登记交付" class="dialog-alert" />
      <el-form ref="formRef" :model="dialogForm" :rules="dialogRules" label-width="90px">
        <el-form-item label="交付人" prop="operator">
          <el-input v-model="dialogForm.operator" placeholder="如：周砚秋" maxlength="16" style="width: 200px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="dialogForm.remark" type="textarea" :rows="2" maxlength="60" placeholder="交付说明（可空）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitDialog">{{ dialogMode === 'deliver' ? '确认交付' : '保存待交付' }}</el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="detailVisible"
      size="720px"
      :title="detail ? `${detail.guqinNo} 交付档案${detail.version > 0 ? ` · v${detail.version}` : '（待交付）'}` : ''"
    >
      <template v-if="detail">
        <el-alert type="info" :closable="false" show-icon class="dialog-alert" title="本档案为登记时刻冻结的快照，后续补髹漆、改评语等工序改动不会回写此处" />
        <div class="detail-meta">
          <el-tag :type="statusTagType(detail.status)" size="small">{{ detail.status }}</el-tag>
          <span>登记 {{ formatDate(detail.registeredAt) }}</span>
          <span v-if="detail.deliveredAt">交付 {{ formatDate(detail.deliveredAt) }}</span>
          <span v-if="detail.revokedAt">撤销 {{ formatDate(detail.revokedAt) }}（{{ detail.revokeReason }}）</span>
          <span>交付人 {{ detail.operator }}</span>
          <span v-if="detail.remark">备注：{{ detail.remark }}</span>
        </div>

        <h3 class="detail-title">验收检查（登记时）</h3>
        <el-table :data="detail.checks" size="small" border>
          <el-table-column prop="label" label="检查项" width="170" />
          <el-table-column label="结果" width="80">
            <template #default="scope">
              <el-tag :type="scope.row.passed ? 'success' : 'danger'" size="small">{{ scope.row.passed ? '通过' : '未通过' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="detail" label="明细" min-width="280" />
        </el-table>

        <h3 class="detail-title">面板底板</h3>
        <el-table v-if="detail.boards.length" :data="detail.boards" size="small" border>
          <el-table-column prop="part" label="部位" width="70" />
          <el-table-column prop="boardNo" label="板材号" width="110" />
          <el-table-column prop="species" label="树种" width="80" />
          <el-table-column prop="dryYears" label="阴干(年)" width="90" />
          <el-table-column prop="thicknessMm" label="厚度(mm)" width="90" />
          <el-table-column prop="grain" label="木纹" min-width="90" />
        </el-table>
        <el-empty v-else description="登记时无配对板材" :image-size="50" />

        <h3 class="detail-title">槽腹尺寸</h3>
        <el-descriptions v-if="detail.chamber" :column="3" border size="small">
          <el-descriptions-item label="纳音处面板">{{ detail.chamber.nayinThickness }}mm</el-descriptions-item>
          <el-descriptions-item label="龙池处面板">{{ detail.chamber.longchiThickness }}mm</el-descriptions-item>
          <el-descriptions-item label="凤沼处面板">{{ detail.chamber.fengzhaoThickness }}mm</el-descriptions-item>
          <el-descriptions-item label="槽腹深度">{{ detail.chamber.chamberDepth }}mm</el-descriptions-item>
          <el-descriptions-item label="天地柱">{{ detail.chamber.postPos }}</el-descriptions-item>
          <el-descriptions-item label="龙池凤沼">{{ detail.chamber.poolSize }}</el-descriptions-item>
        </el-descriptions>
        <el-empty v-else description="登记时无槽腹记录" :image-size="50" />

        <h3 class="detail-title">灰胎遍次（{{ detail.layers.length }} 遍，累计 {{ detail.totalThickness.toFixed(2) }}mm）</h3>
        <el-table v-if="detail.layers.length" :data="detail.layers" size="small" border>
          <el-table-column prop="seq" label="遍次" width="60" />
          <el-table-column prop="mixRatio" label="配比" width="90" />
          <el-table-column label="荫房温湿度" width="140">
            <template #default="scope">{{ scope.row.curingTemp }}℃ / {{ scope.row.curingHumidity }}%</template>
          </el-table-column>
          <el-table-column label="窗口" width="80">
            <template #default="scope">
              <el-tag :type="curingInRange(scope.row.curingTemp, scope.row.curingHumidity) ? 'success' : 'danger'" size="small">
                {{ curingInRange(scope.row.curingTemp, scope.row.curingHumidity) ? '窗口内' : '超窗口' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="polishGrit" label="目数" width="80" />
          <el-table-column prop="layerThickness" label="厚度(mm)" width="90" />
          <el-table-column label="施工日期" min-width="100">
            <template #default="scope">{{ formatDate(scope.row.appliedAt) }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="登记时无灰胎遍次" :image-size="50" />

        <h3 class="detail-title">音色评语</h3>
        <el-descriptions v-if="detail.tone" :column="1" border size="small">
          <el-descriptions-item label="弦">
            {{ detail.tone.stringType }} · 弦距 {{ detail.tone.stringGap }}mm · 缺陷 {{ detail.tone.defects.join('、') }}
          </el-descriptions-item>
          <el-descriptions-item label="散音">{{ detail.tone.sanNote }}</el-descriptions-item>
          <el-descriptions-item label="按音">{{ detail.tone.anNote }}</el-descriptions-item>
          <el-descriptions-item label="泛音">{{ detail.tone.fanNote }}</el-descriptions-item>
          <el-descriptions-item label="九德">{{ detail.tone.nineVirtues }}</el-descriptions-item>
        </el-descriptions>
        <el-empty v-else description="登记时无上弦评语" :image-size="50" />
      </template>
    </el-drawer>
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
.accept-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.check-table {
  margin-bottom: 12px;
}
.accept-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.warn-text {
  font-size: 13px;
  color: #c62828;
}
.ok-text {
  font-size: 13px;
  color: #2f7d32;
}
.dialog-alert {
  margin-bottom: 14px;
}
.detail-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #8a7a68;
  margin-bottom: 8px;
}
.detail-title {
  margin: 16px 0 8px;
  font-size: 14px;
  color: #4a3728;
}
</style>
