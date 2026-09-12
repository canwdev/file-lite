<script setup lang="ts">
import type { TransferTab, TransferTabCounts } from './types'
import { computed } from 'vue'

/**
 * 传输面板：固定在右下角的一张卡片（移动端整宽），
 * 用两个页签区分「上传/下载」与「文件复制/移动/删除」。
 *
 * 它只负责外壳与页签，两个列表通过插槽传进来——列表与行组件都不依赖面板，
 * 可以单独复用（例如以后要塞进侧边栏或通知里）。
 */
const props = defineProps<{
  visible: boolean
  activeTab: TransferTab
  /** 当前页签的一句话汇总（由调用方按页签语义生成） */
  summary: string
  transfers: TransferTabCounts
  tasks: TransferTabCounts
}>()

const emit = defineEmits<{
  'update:activeTab': [tab: TransferTab]
  'hide': []
}>()

const tabs = computed(() => [
  {
    key: 'transfers' as const,
    // 上传/下载永远是浏览器侧的传输，和服务端的文件操作不是一回事
    label: 'Transfers',
    icon: 'file-arrow-up-down-outline',
    counts: props.transfers,
  },
  {
    key: 'tasks' as const,
    label: 'Tasks',
    icon: 'file-arrow-left-right-outline',
    counts: props.tasks,
  },
])

/** 角标优先级：还在跑 > 有失败 > 有历史记录 */
function badge(counts: TransferTabCounts) {
  if (counts.active > 0) {
    return { text: String(counts.active), variant: 'vgo-badge--primary' }
  }
  if (counts.failed > 0) {
    return { text: String(counts.failed), variant: 'vgo-badge--danger' }
  }
  return { text: String(counts.total), variant: '' }
}
</script>

<template>
  <Teleport to="body">
    <transition name="fade-up">
      <section
        v-if="visible"
        id="file_lite_transfer_panel"
        class="transfer-panel vgo-panel"
      >
        <header class="transfer-panel__header vgo-panel vgo-panel--flat">
          <div class="transfer-panel__tabs">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="vgo-button vgo-button--text vgo-button--sm"
              :class="{ 'is-active': tab.key === activeTab }"
              @click="emit('update:activeTab', tab.key)"
            >
              <MdiIcon :name="tab.icon" />
              <span>{{ tab.label }}</span>
              <span
                v-if="tab.counts.total > 0"
                class="vgo-badge"
                :class="badge(tab.counts).variant"
              >{{ badge(tab.counts).text }}</span>
            </button>
          </div>

          <button
            class="vgo-button vgo-button--text vgo-button--icon vgo-button--sm"
            title="Hide"
            @click="emit('hide')"
          >
            <i-mdi-close />
          </button>
        </header>

        <div v-if="summary" class="transfer-panel__summary vgo-u-text-overflow" :title="summary">
          {{ summary }}
        </div>

        <div class="transfer-panel__body">
          <slot name="transfers" />
          <slot name="tasks" />
        </div>

        <footer class="transfer-panel__footer vgo-panel vgo-panel--flat">
          <slot name="footer" />
        </footer>
      </section>
    </transition>
  </Teleport>
</template>

<style scoped lang="scss">
.transfer-panel {
  position: fixed;
  right: var(--vgo-space-4);
  // 让开底部状态栏：显示/隐藏的入口按钮就在那里，面板不能盖住它
  bottom: calc(var(--vgo-control-lg) + var(--vgo-space-2));
  z-index: var(--vgo-z-window);
  display: flex;
  flex-direction: column;
  width: 380px;
  max-height: min(60vh, 520px);
  overflow: hidden;
  font-size: var(--vgo-font-md);

  @media screen and (max-width: $mq_mobile_width) {
    right: 0;
    // 移动端整宽贴底（像一张底部抽屉）：状态栏在窄屏上会换行变高，
    // 留固定缝隙只会把状态栏的文字盖掉一半，不如整块盖住、点面板自己的 × 收起。
    bottom: 0;
    left: 0;
    width: 100%;
    max-height: 70vh;
  }

  &__header {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    padding: var(--vgo-space-1);
    border-bottom: 1px solid var(--vgo-border);
  }

  &__tabs {
    display: flex;
    align-items: center;
    gap: var(--vgo-space-1);
    min-width: 0;
  }

  &__summary {
    flex-shrink: 0;
    padding: var(--vgo-space-2) var(--vgo-space-3);
    border-bottom: 1px solid var(--vgo-border);
    font-size: var(--vgo-font-sm);
    color: var(--vgo-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  &__body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  &__footer {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: var(--vgo-space-2);
    align-items: center;
    justify-content: space-between;
    padding: var(--vgo-space-2) var(--vgo-space-3);
    border-top: 1px solid var(--vgo-border);
  }
}

.fade-up-enter-active,
.fade-up-leave-active {
  transition:
    opacity var(--vgo-duration-base) ease,
    transform var(--vgo-duration-base) ease;
}

.fade-up-enter-from,
.fade-up-leave-to {
  opacity: 0;
  transform: translateY(var(--vgo-space-4));
}
</style>
