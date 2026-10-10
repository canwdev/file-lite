package routes

const sharedWSMaxTextBytes = 64 * 1024

// 通道文本常驻内存，只在服务端进程重启时清空：刷新页面、断线重连都会重新 join，
// 文本跟着人走就没了。每个通道上限 64 KiB、通道只有 CH1~CH3 三个，留着远比丢掉划算。
// `clients` 只记成员关系，空了也不删通道。
var (
	sharedWSAllowedChannels = map[string]struct{}{
		"CH1": {},
		"CH2": {},
		"CH3": {},
	}
	sharedWSTextSyncState = struct {
		channels map[string]*sharedWSTextChannelState
	}{
		channels: map[string]*sharedWSTextChannelState{},
	}
)

type sharedWSTextChannelState struct {
	text    string
	clients map[*sharedWSClient]struct{}
}

func isSharedWSTextSyncChannelAllowed(channel string) bool {
	_, ok := sharedWSAllowedChannels[channel]
	return ok
}

func handleSharedWSTextSyncMessage(client *sharedWSClient, msg sharedWSTextSyncClientMessage) {
	switch msg.Type {
	case "join":
		sharedWSJoinTextSyncChannel(client, msg.Channel)
	case "update":
		if client.textSyncChannel == "" || client.textSyncChannel != msg.Channel {
			sendSharedWSError(client, "text-sync", "Channel mismatch")
			return
		}
		if len([]byte(msg.Text)) > sharedWSMaxTextBytes {
			sendSharedWSError(client, "text-sync", "Text exceeds 65536 bytes")
			return
		}
		broadcastSharedWSTextSync(msg.Channel, msg.Text)
	default:
		sendSharedWSError(client, "text-sync", "Invalid payload")
	}
}

func sharedWSJoinTextSyncChannel(client *sharedWSClient, next string) {
	sharedWSState.Lock()
	defer sharedWSState.Unlock()

	// 已经在同一个通道里：直接回一份当前内容，不要先退再进。
	//
	// 退出的若是最后一个人，通道连同里面的文本会被删掉，接着重新建出来就是空的 ——
	// 表现就是「重开 Text Sync 窗口（或前端重连）之后，之前同步的文本不见了」。
	// join 因此做成幂等：重复 join 只回报状态，不动成员关系。
	if client.textSyncChannel == next {
		sharedWSSendTextSyncStateLocked(client, next)
		return
	}

	if client.textSyncChannel != "" {
		sharedWSLeaveTextSyncChannelLocked(client, client.textSyncChannel)
	}

	state := sharedWSTextSyncState.channels[next]
	if state == nil {
		state = &sharedWSTextChannelState{
			text:    "",
			clients: map[*sharedWSClient]struct{}{},
		}
		sharedWSTextSyncState.channels[next] = state
	}
	state.clients[client] = struct{}{}
	client.textSyncChannel = next

	sharedWSSendTextSyncStateLocked(client, next)
}

// sharedWSSendTextSyncStateLocked 把某个通道的当前文本回给一个客户端，调用方需持有 sharedWSState。
// 通道不存在就是空串：这个通道还没有人写过内容。
func sharedWSSendTextSyncStateLocked(client *sharedWSClient, channel string) {
	text := ""
	if state := sharedWSTextSyncState.channels[channel]; state != nil {
		text = state.text
	}
	sendSharedWSJSON(client, map[string]any{
		"scope":   "text-sync",
		"type":    "sync",
		"channel": channel,
		"text":    text,
	})
}

func sharedWSUnregisterTextSyncClientLocked(client *sharedWSClient) {
	if client.textSyncChannel == "" {
		return
	}
	sharedWSLeaveTextSyncChannelLocked(client, client.textSyncChannel)
	client.textSyncChannel = ""
}

func sharedWSLeaveTextSyncChannelLocked(client *sharedWSClient, channel string) {
	state := sharedWSTextSyncState.channels[channel]
	if state == nil {
		return
	}

	// 只解除成员关系，**不删通道**：最后一个客户端离开（关页面、断线、切通道）之后
	// 文本仍然留着，重新 join 的人拿到的还是之前同步的内容。代价见文件头的说明。
	delete(state.clients, client)
}

func broadcastSharedWSTextSync(channel, text string) {
	sharedWSState.Lock()
	state := sharedWSTextSyncState.channels[channel]
	if state == nil {
		state = &sharedWSTextChannelState{
			text:    "",
			clients: map[*sharedWSClient]struct{}{},
		}
		sharedWSTextSyncState.channels[channel] = state
	}
	state.text = text
	clients := make([]*sharedWSClient, 0, len(state.clients))
	for client := range state.clients {
		clients = append(clients, client)
	}
	sharedWSState.Unlock()

	message := map[string]any{
		"scope":   "text-sync",
		"type":    "sync",
		"channel": channel,
		"text":    text,
	}
	for _, client := range clients {
		sendSharedWSJSON(client, message)
	}
}

func clearSharedWSTextSyncState() {
	sharedWSState.Lock()
	defer sharedWSState.Unlock()

	for client := range sharedWSState.clients {
		client.textSyncChannel = ""
	}
	sharedWSTextSyncState.channels = map[string]*sharedWSTextChannelState{}
}
