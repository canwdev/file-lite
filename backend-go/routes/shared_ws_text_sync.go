package routes

const sharedWSMaxTextBytes = 64 * 1024

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
			sendSharedWSError(client, "text-sync", "", "Channel mismatch")
			return
		}
		if len([]byte(msg.Text)) > sharedWSMaxTextBytes {
			sendSharedWSError(client, "text-sync", "", "Text exceeds 65536 bytes")
			return
		}
		broadcastSharedWSTextSync(msg.Channel, msg.Text)
	default:
		sendSharedWSError(client, "text-sync", "", "Invalid payload")
	}
}

func sharedWSJoinTextSyncChannel(client *sharedWSClient, next string) {
	sharedWSState.Lock()
	defer sharedWSState.Unlock()

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

	sendSharedWSJSON(client, map[string]any{
		"scope":   "text-sync",
		"type":    "sync",
		"channel": next,
		"text":    state.text,
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

	delete(state.clients, client)
	if len(state.clients) == 0 {
		delete(sharedWSTextSyncState.channels, channel)
	}
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
