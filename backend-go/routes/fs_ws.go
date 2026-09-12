package routes

// broadcastFSChanged 广播目录变化，让所有客户端刷新受影响的目录。
// 取代过去跨实例的 moveRefresh 补丁：任务改动了哪里，由服务端说了算。
//
// changes 给出每个受影响目录里增删了哪些条目，客户端据此原地打补丁；
// paths 仍然保留，作为拿不到 changes 时的整目录刷新兜底。
func broadcastFSChanged(paths []string, changes []fsDirChange) {
	if len(paths) == 0 && len(changes) == 0 {
		return
	}
	payload := map[string]any{
		"scope": "fs",
		"type":  "changed",
		"paths": paths,
	}
	if len(changes) > 0 {
		payload["changes"] = changes
	}
	for _, client := range snapshotSharedWSClients() {
		sendSharedWSJSON(client, payload)
	}
}
