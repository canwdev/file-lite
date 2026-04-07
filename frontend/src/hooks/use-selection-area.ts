import SelectionArea from '@viselect/vanilla'

export function useSelectionArea({
  containerRef,
  onStart,
  onStop,
  toggleClass = 'active',
  selectables = ['.selectable'],
}: {
  containerRef: Ref<HTMLElement | null>
  onStart: () => void
  onStop: (stored: HTMLElement[]) => void
  toggleClass?: string
  selectables?: string[]
}) {
  const selectionRef = shallowRef()
  onMounted(() => {
    const el = containerRef.value
    if (!el) {
      return
    }
    // https://github.com/simonwep/selection/tree/master/packages/vanilla
    selectionRef.value = new SelectionArea({
      selectables,
      boundaries: [el],
      features: {
        touch: false,
        singleTap: {
          allow: false,
        },
      },
      container: el,
    })
      .on('start', ({ event }) => {
        if (!(event as MouseEvent).ctrlKey && !(event as MouseEvent).metaKey) {
          selectionRef.value.clearSelection()
          setTimeout(() => {
            onStart && onStart()
          })
        }
      })
      .on(
        'move',
        ({
          store: {
            changed: { added, removed },
          },
        }) => {
          for (const el of added) {
            el.classList.add(toggleClass)
          }

          for (const el of removed) {
            el.classList.remove(toggleClass)
          }
        },
      )
      .on('stop', ({ store: { stored } }) => {
        setTimeout(() => {
          onStop && onStop(stored as HTMLElement[])
        })
      })
  })
  onBeforeUnmount(() => {
    if (selectionRef.value) {
      // console.log('onBeforeUnmount', selectionRef.value)
      selectionRef.value.destroy()
    }
  })

  return selectionRef
}
