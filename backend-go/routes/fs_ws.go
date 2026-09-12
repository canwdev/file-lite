package routes

// fsChanged 广播目录变化，让所有客户端刷新受影响的目录。
// 取代过去跨实例的 moveRefresh 补丁：任务改动了哪里，由服务端说了算。
func broadcastFSChanged(paths []string) {
	if len(paths) == 0 {
		return
	}
	payload := map[string]any{
		"scope": "fs",
		"type":  "changed",
		"paths": paths,
	}
	for _, client := range snapshotSharedWSClients() {
		sendSharedWSJSON(client, payload)
	}
}
