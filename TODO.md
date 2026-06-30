# TODO

## FileSelector 支持传入文件后缀限制展示

### 目标

让 `FileSelector` 可以接收一个正则模式（如 `\\.(mp4|webm|mkv)$`），打开时文件列表只展示匹配的文件，同时目录保持可见以便导航。

### 原理

代码已有完整的过滤管道：

```
FileFilterState { text, regex, caseSensitive }
  → FilterBar (UI 修改状态)
  → FileManager.filterState (响应式状态)
  → FileList.filteredFiles (computed 过滤，已支持正则)
  → 文件列表展示
```

只需将外部模式灌入 `filterState` 即可，无需新增过滤逻辑。

### 改动清单

#### 1. `FileSelector.vue`

- 新增 prop：`fileFilterPattern?: string`
- 透传给 `<FileManager :file-filter-pattern="fileFilterPattern">`

#### 2. `FileManager.vue`

- 新增 prop：`fileFilterPattern?: string`
- `watch` 该 prop，回填 `filterState`：

```ts
filterState.value.text = pattern
filterState.value.regex = true
```

#### 3. `FileList.vue`

- `filteredFiles` computed 中，目录始终不过滤，保证导航可用：

```ts
return sortedFiles.value.filter((item) => {
  if (item.isDirectory) return true   // ← 目录始终可见
  return reg.test(item.name)
})
```

#### 4. 消费者示例（`VArtPlayer.vue`）

```vue
<!-- 视频选择 -->
<FileSelector file-filter-pattern="\.(mp4|webm|ogg|mkv|m4v|avi|mov|wmv|flv)$" ... />
<!-- 字幕选择 -->
<FileSelector file-filter-pattern="\.(vtt|srt|ass|ssa)$" ... />
```

### 涉及文件

| 文件 | 改动 |
|------|------|
| `frontend/src/views/FileManager/FileSelector.vue` | 新增 prop + 透传 |
| `frontend/src/views/FileManager/FileManager.vue`   | 新增 prop + watch 回填 |
| `frontend/src/views/FileManager/ExplorerUI/FileList.vue` | filteredFiles 保留目录 |
| `frontend/src/views/Apps/components/VArtPlayer.vue` | 实际传入正则 |
