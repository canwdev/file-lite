package routes

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"

	"file-lite-go/config"
	"file-lite-go/utils"
)

const (
	sharedWSPath              = "/api/ws"
	sharedWSAuthCookieName    = "file_lite_auth_token"
	sharedWSMaxTextBytes      = 64 * 1024
	sharedWSMaxConnectionsPer = 20
)

var (
	sharedWSAllowedChannels = map[string]struct{}{
		"CH1": {},
		"CH2": {},
		"CH3": {},
	}
	sharedWSIPState = struct {
		sync.Mutex
		counts map[string]int
	}{
		counts: map[string]int{},
	}
	sharedWSState = struct {
		sync.Mutex
		channels map[string]*sharedWSTextChannelState
		clients  map[*sharedWSClient]struct{}
	}{
		channels: map[string]*sharedWSTextChannelState{},
		clients:  map[*sharedWSClient]struct{}{},
	}
	sharedWSUpgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return isSharedWSOriginAllowed(r)
		},
	}
)

type sharedWSClient struct {
	conn            *websocket.Conn
	ip              string
	textSyncChannel string
	writeMu         sync.Mutex
}

type sharedWSTextChannelState struct {
	text    string
	clients map[*sharedWSClient]struct{}
}

type sharedWSBaseMessage struct {
	Scope string `json:"scope"`
	Type  string `json:"type"`
}

type sharedWSTextSyncClientMessage struct {
	Scope   string `json:"scope"`
	Type    string `json:"type"`
	Channel string `json:"channel"`
	Text    string `json:"text,omitempty"`
}

type sharedWSSettingsClientMessage struct {
	Scope     string `json:"scope"`
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	Key       string `json:"key"`
	Value     any    `json:"value,omitempty"`
}

type sharedWSSettingsSetEnvelope struct {
	Scope     string           `json:"scope"`
	Type      string           `json:"type"`
	RequestID string           `json:"requestId"`
	Key       string           `json:"key"`
	Value     *json.RawMessage `json:"value"`
}

func handleSharedWebSocket(c echo.Context) error {
	if c.Request().URL.Path != sharedWSPath {
		return c.NoContent(http.StatusNotFound)
	}
	if !isSharedWSAuthenticated(c) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
	}

	ip := c.RealIP()
	if !acquireSharedWSIPConnection(ip) {
		return c.JSON(http.StatusTooManyRequests, map[string]string{"message": "Too Many Requests"})
	}
	defer releaseSharedWSIPConnection(ip)

	conn, err := sharedWSUpgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return nil
	}
	defer conn.Close()

	client := &sharedWSClient{
		conn: conn,
		ip:   ip,
	}
	sharedWSRegisterClient(client)
	defer sharedWSUnregisterClient(client)

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return nil
		}

		scope, err := parseSharedWSMessageScope(raw)
		if err != nil {
			sendSharedWSError(client, "ws", "", err.Error())
			continue
		}

		switch scope {
		case "text-sync":
			msg, err := parseSharedWSTextSyncMessage(raw)
			if err != nil {
				sendSharedWSError(client, "text-sync", "", err.Error())
				continue
			}
			handleSharedWSTextSyncMessage(client, msg)
		case "settings":
			msg, err := parseSharedWSSettingsMessage(raw)
			if err != nil {
				sendSharedWSError(client, "settings", "", err.Error())
				continue
			}
			handleSharedWSSettingsMessage(client, msg)
		default:
			sendSharedWSError(client, "ws", "", "Invalid payload")
		}
	}
}

func parseSharedWSMessageScope(raw []byte) (string, error) {
	var msg sharedWSBaseMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return "", err
	}
	return msg.Scope, nil
}

func parseSharedWSTextSyncMessage(raw []byte) (sharedWSTextSyncClientMessage, error) {
	var msg sharedWSTextSyncClientMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return sharedWSTextSyncClientMessage{}, err
	}
	if (msg.Type != "join" && msg.Type != "update") || msg.Channel == "" {
		return sharedWSTextSyncClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
	}
	if _, ok := sharedWSAllowedChannels[msg.Channel]; !ok {
		return sharedWSTextSyncClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
	}
	return msg, nil
}

func parseSharedWSSettingsMessage(raw []byte) (sharedWSSettingsClientMessage, error) {
	var base sharedWSBaseMessage
	if err := json.Unmarshal(raw, &base); err != nil {
		return sharedWSSettingsClientMessage{}, err
	}

	switch base.Type {
	case "get", "delete":
		var msg sharedWSSettingsClientMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			return sharedWSSettingsClientMessage{}, err
		}
		if msg.RequestID == "" || msg.Key == "" {
			return sharedWSSettingsClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
		}
		return msg, nil
	case "set":
		var envelope sharedWSSettingsSetEnvelope
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return sharedWSSettingsClientMessage{}, err
		}
		if envelope.RequestID == "" || envelope.Key == "" || envelope.Value == nil {
			return sharedWSSettingsClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
		}
		var value any
		if err := json.Unmarshal(*envelope.Value, &value); err != nil {
			return sharedWSSettingsClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
		}
		return sharedWSSettingsClientMessage{
			Scope:     envelope.Scope,
			Type:      envelope.Type,
			RequestID: envelope.RequestID,
			Key:       envelope.Key,
			Value:     value,
		}, nil
	default:
		return sharedWSSettingsClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
	}
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

func handleSharedWSSettingsMessage(client *sharedWSClient, msg sharedWSSettingsClientMessage) {
	var (
		value any
		err   error
	)

	switch msg.Type {
	case "get":
		value, err = utils.GetSettingsValue(msg.Key)
	case "set":
		value, err = utils.SetSettingsValue(msg.Key, msg.Value)
	case "delete":
		value, err = utils.DeleteSettingsValue(msg.Key)
	default:
		sendSharedWSError(client, "settings", msg.RequestID, "Invalid payload")
		return
	}

	if err != nil {
		sendSharedWSError(client, "settings", msg.RequestID, "Settings request failed")
		return
	}

	sendSharedWSJSON(client, map[string]any{
		"scope":     "settings",
		"type":      "response",
		"requestId": msg.RequestID,
		"action":    msg.Type,
		"key":       msg.Key,
		"value":     value,
	})

	if msg.Type == "set" || msg.Type == "delete" {
		broadcastSharedWSSettings(msg.Key, value)
	}
}

func sharedWSRegisterClient(client *sharedWSClient) {
	sharedWSState.Lock()
	defer sharedWSState.Unlock()
	sharedWSState.clients[client] = struct{}{}
}

func sharedWSUnregisterClient(client *sharedWSClient) {
	sharedWSState.Lock()
	defer sharedWSState.Unlock()

	delete(sharedWSState.clients, client)
	if client.textSyncChannel != "" {
		sharedWSLeaveTextSyncChannelLocked(client, client.textSyncChannel)
		client.textSyncChannel = ""
	}
}

func sharedWSJoinTextSyncChannel(client *sharedWSClient, next string) {
	sharedWSState.Lock()
	defer sharedWSState.Unlock()

	if client.textSyncChannel != "" {
		sharedWSLeaveTextSyncChannelLocked(client, client.textSyncChannel)
	}

	state := sharedWSState.channels[next]
	if state == nil {
		state = &sharedWSTextChannelState{
			text:    "",
			clients: map[*sharedWSClient]struct{}{},
		}
		sharedWSState.channels[next] = state
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

func sharedWSLeaveTextSyncChannelLocked(client *sharedWSClient, channel string) {
	state := sharedWSState.channels[channel]
	if state == nil {
		return
	}

	delete(state.clients, client)
	if len(state.clients) == 0 {
		delete(sharedWSState.channels, channel)
	}
}

func broadcastSharedWSTextSync(channel, text string) {
	sharedWSState.Lock()
	state := sharedWSState.channels[channel]
	if state == nil {
		state = &sharedWSTextChannelState{
			text:    "",
			clients: map[*sharedWSClient]struct{}{},
		}
		sharedWSState.channels[channel] = state
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

func broadcastSharedWSSettings(key string, value any) {
	sharedWSState.Lock()
	clients := make([]*sharedWSClient, 0, len(sharedWSState.clients))
	for client := range sharedWSState.clients {
		clients = append(clients, client)
	}
	sharedWSState.Unlock()

	message := map[string]any{
		"scope": "settings",
		"type":  "sync",
		"key":   key,
		"value": value,
	}
	for _, client := range clients {
		sendSharedWSJSON(client, message)
	}
}

func sendSharedWSJSON(client *sharedWSClient, payload any) {
	client.writeMu.Lock()
	defer client.writeMu.Unlock()
	_ = client.conn.WriteJSON(payload)
}

func sendSharedWSError(client *sharedWSClient, scope, requestID, message string) {
	payload := map[string]any{
		"scope":   scope,
		"type":    "error",
		"message": message,
	}
	if requestID != "" {
		payload["requestId"] = requestID
	}
	sendSharedWSJSON(client, payload)
}

func acquireSharedWSIPConnection(ip string) bool {
	sharedWSIPState.Lock()
	defer sharedWSIPState.Unlock()

	current := sharedWSIPState.counts[ip]
	if current >= sharedWSMaxConnectionsPer {
		return false
	}
	sharedWSIPState.counts[ip] = current + 1
	return true
}

func releaseSharedWSIPConnection(ip string) {
	sharedWSIPState.Lock()
	defer sharedWSIPState.Unlock()

	current := sharedWSIPState.counts[ip]
	if current <= 1 {
		delete(sharedWSIPState.counts, ip)
		return
	}
	sharedWSIPState.counts[ip] = current - 1
}

func isSharedWSAuthenticated(c echo.Context) bool {
	token := c.QueryParam("token")
	if token == "" {
		token = c.Request().Header.Get("Authorization")
	}
	if token == "" {
		if cookie, err := c.Cookie(sharedWSAuthCookieName); err == nil {
			token = cookie.Value
		}
	}
	return token != "" && config.VerifyAuthJWT(token)
}

func isSharedWSOriginAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" || r.Host == "" {
		return true
	}
	originURL, err := url.Parse(origin)
	if err != nil {
		return false
	}
	originHost := strings.ToLower(originURL.Hostname())
	requestHost, _, err := net.SplitHostPort(r.Host)
	if err != nil {
		requestHost = r.Host
	}
	requestHost = strings.ToLower(requestHost)
	if originHost == requestHost {
		return true
	}
	return isSharedWSLoopback(originHost) && isSharedWSLoopback(requestHost)
}

func isSharedWSLoopback(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}
