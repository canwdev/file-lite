package thumbnails

import (
	"container/list"
	"sync"
)

// lruCache 是按「总字节数」而不是「条目数」限制的 LRU。
// 手写而不是引第三方库：项目一贯避免为小功能引入依赖（见 scripts/build.ts 里的 zip writer）。
//
// 存的是已经编码好的响应字节，命中时只做一次拷贝即可下发；
// 存入后不再修改，因此可以安全地在多个请求间共享切片。
type lruCache struct {
	mu       sync.Mutex
	maxBytes int64
	curBytes int64
	maxEntry int64
	items    map[string]*list.Element
	order    *list.List // 队首 = 最近使用
}

type lruEntry struct {
	key  string
	data []byte
	ct   string
}

func newLRUCache(maxBytes, maxEntry int64) *lruCache {
	if maxBytes <= 0 {
		maxBytes = 1
	}
	return &lruCache{
		maxBytes: maxBytes,
		maxEntry: maxEntry,
		items:    make(map[string]*list.Element),
		order:    list.New(),
	}
}

// Get 返回缓存条目并把命中项移到队首。
func (c *lruCache) Get(key string) ([]byte, string, bool) {
	if c == nil {
		return nil, "", false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	el, ok := c.items[key]
	if !ok {
		return nil, "", false
	}
	c.order.MoveToFront(el)
	e := el.Value.(*lruEntry)
	return e.data, e.ct, true
}

// Add 写入条目并淘汰队尾直到总占用回到上限之内。
// 超过 maxEntry 的条目直接丢弃：一条异常大的响应不该把整个缓存挤空。
func (c *lruCache) Add(key string, data []byte, ct string) {
	if c == nil || len(data) == 0 {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if int64(len(data)) > c.maxEntry || int64(len(data)) > c.maxBytes {
		return
	}

	if el, ok := c.items[key]; ok {
		e := el.Value.(*lruEntry)
		c.curBytes += int64(len(data)) - int64(len(e.data))
		e.data = data
		e.ct = ct
		c.order.MoveToFront(el)
	} else {
		el := c.order.PushFront(&lruEntry{key: key, data: data, ct: ct})
		c.items[key] = el
		c.curBytes += int64(len(data))
	}

	for c.curBytes > c.maxBytes {
		el := c.order.Back()
		if el == nil {
			break
		}
		e := el.Value.(*lruEntry)
		c.order.Remove(el)
		delete(c.items, e.key)
		c.curBytes -= int64(len(e.data))
	}
}

// Len 返回当前条目数（测试与统计用）。
func (c *lruCache) Len() int {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.order.Len()
}

// Bytes 返回当前总占用字节数（测试与统计用）。
func (c *lruCache) Bytes() int64 {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.curBytes
}
