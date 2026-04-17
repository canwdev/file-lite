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
  <div class="tk-seekbar" :class="{ vertical }">
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
.tk-seekbar {
  height: 100%;
  flex: 1;
  position: relative;
  overflow: hidden;

  $bar_height: 3px;

  &.vertical {
    input {
      writing-mode: bt-lr; /* IE */
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
    background: var(--vgo-primary);
    user-select: none;
    pointer-events: none;
    z-index: 1;
    border-radius: 2px;
  }

  input {
    width: 100%;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    left: 0;
    right: 0;
    appearance: none;
    height: $bar_height;
    background: var(--vgo-color-border);
    outline: none;
    border-radius: 2px;
    box-shadow: none;
    margin: 0;

    &:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    @mixin mixin-thumb {
      position: relative;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--vgo-primary);
      z-index: 10;
      border: none;
      //box-shadow: 0 0 1px 1px rgba(0, 0, 0, 0.2);
      cursor: pointer;
    }

    &::-webkit-slider-thumb {
      @include mixin-thumb;
      margin: 0;
      opacity: 0;
      transition: all 0.3s;
    }

    &:hover {
      &::-webkit-slider-thumb {
        opacity: 1;
      }
    }

    &::-moz-range-thumb {
      @include mixin-thumb;
    }
  }
}
</style>
