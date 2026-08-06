<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
  name: 'Seekbar',
  props: {
    min: {
      type: [Number, String],
      default: 0,
    },
    max: {
      type: [Number, String],
      default: 100,
    },
    value: {
      type: [Number, String],
      default: 100,
    },
    vertical: {
      type: Boolean,
      default: false,
    },
    wheel: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['input', 'focus', 'blur', 'change'],
  computed: {
    progress(): string {
      const value = Number(this.value)
      const max = Number(this.max)
      if (!Number.isFinite(max) || max <= 0) {
        return '0'
      }
      return ((value / max) * 100).toFixed(1)
    },
  },
  methods: {
    handleInput(event: Event) {
      const t = event.target as HTMLInputElement
      this.$emit('input', t.value)
    },
    handleFocus(event: FocusEvent) {
      this.$emit('focus', event)
    },
    handleBlur(event: FocusEvent) {
      this.$emit('blur', event)
    },
    handleChange(event: Event) {
      const t = event.target as HTMLInputElement
      this.$emit('change', t.value)
    },
    handleWheel(event: WheelEvent) {
      if (this.wheel) {
        event.preventDefault()
        const el = this.$refs.seekBar as HTMLInputElement
        const deltaY = event.deltaY || 0

        const num = Math.abs(deltaY) / 64
        const val = Number(this.value)

        if (deltaY > 0) {
          el.value = String(val - num)
        }
        else if (deltaY < 0) {
          el.value = String(val + num)
        }
        this.$emit('input', el.value)
      }
    },
  },
})
</script>

<template>
  <div class="v-seekbar" :class="{ vertical }">
    <div v-if="!vertical" class="seekbar-fill" :style="`width:${progress}%`" />
    <input
      ref="seekBar"
      type="range"
      :min="min"
      :max="max"
      :value="value"
      class="common-seekbar seekbar-input"
      :disabled="disabled"
      v-bind="$attrs"
      @input="handleInput"
      @focus="handleFocus"
      @blur="handleBlur"
      @change="handleChange"
      @wheel="handleWheel"
    >
  </div>
</template>

<style lang="scss" scoped>
@use "sass:math";

.v-seekbar {
  height: 100%;
  flex: 1;
  position: relative;
  overflow: visible;

  $bar_height: 5px;
  $thumb_size: 14px;
  // 轨道只有 5px，靠加高透明的 input 把命中区域撑到可点
  $clickable_height: 24px;

  &::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: $bar_height;
    transform: translateY(-50%);
    background: var(--vgo-hover);
    border-radius: var(--vgo-radius-pill);
    pointer-events: none;
    z-index: 0;
  }

  &.vertical {
    input {
      writing-mode: bt-lr; /* IE */
      appearance: slider-vertical;
      -webkit-appearance: slider-vertical; /* WebKit */
      height: 100%;
      outline: none;
    }
  }

  .seekbar-fill {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    height: $bar_height;
    width: 0;
    background-color: var(--vgo-primary);
    user-select: none;
    pointer-events: none;
    z-index: 1;
    border-radius: var(--vgo-radius-pill);
  }

  @mixin thumb {
    appearance: none;
    width: $thumb_size;
    height: $thumb_size;
    border: 2px solid var(--vgo-primary);
    border-radius: 50%;
    background-color: var(--vgo-surface-raised);
    cursor: pointer;
  }

  input {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    width: 100%;
    height: $clickable_height;
    transform: translateY(-50%);
    appearance: none;
    background: transparent;
    outline: none;
    margin: 0;
    z-index: 2;
    cursor: pointer;

    &:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    &::-webkit-slider-runnable-track,
    &::-moz-range-track {
      height: $bar_height;
      background: transparent;
      border: none;
    }

    &::-webkit-slider-thumb {
      @include thumb;
      // input 被加高后 thumb 不再自动居中，需按轨道高度回补
      margin-top: math.div($bar_height - $thumb_size, 2);
      opacity: 0;
      transform: scale(0.72);
      transition:
        opacity var(--vgo-duration-fast) ease,
        transform var(--vgo-duration-fast) ease;
    }

    &:hover::-webkit-slider-thumb {
      opacity: 1;
      transform: scale(1);
    }

    // Firefox 自动居中，无需补 margin
    &::-moz-range-thumb {
      @include thumb;
    }
  }
}
</style>
