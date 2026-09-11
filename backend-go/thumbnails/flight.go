package thumbnails

import "sync"

// flightGroup 让同一个 key 的并发请求只执行一次生成逻辑，其余请求等待并复用结果。
//
// 用 DoChan 而不是阻塞式的 Do：调用方可以 select 自己的 ctx，
// 客户端 abort（滚动出视野）时能立刻返回，不必等生成跑完。
type flightGroup struct {
	mu    sync.Mutex
	calls map[string]*flightCall
}

type flightCall struct {
	wg  sync.WaitGroup
	res flightResult
}

func newFlightGroup() *flightGroup {
	return &flightGroup{calls: make(map[string]*flightCall)}
}

func (g *flightGroup) DoChan(key string, fn func() flightResult) <-chan flightResult {
	ch := make(chan flightResult, 1)

	g.mu.Lock()
	if call, ok := g.calls[key]; ok {
		// 已有同 key 的任务在跑：等它的结果，不重复生成
		g.mu.Unlock()
		go func() {
			call.wg.Wait()
			ch <- call.res
		}()
		return ch
	}

	call := &flightCall{}
	call.wg.Add(1)
	g.calls[key] = call
	g.mu.Unlock()

	go func() {
		defer func() {
			g.mu.Lock()
			delete(g.calls, key)
			g.mu.Unlock()
			call.wg.Done()
		}()
		call.res = fn()
	}()

	go func() {
		call.wg.Wait()
		ch <- call.res
	}()

	return ch
}
