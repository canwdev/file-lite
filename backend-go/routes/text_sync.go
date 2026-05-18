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
)

const (
	textSyncAuthCookieName    = "file_lite_auth_token"
	textSyncPath              = "/api/files/text-sync"
	textSyncMaxTextBytes      = 64 * 1024
	textSyncMaxConnectionsPer = 20
)

var (
	textSyncAllowedChannels = map[string]struct{}{
		"CH1": {},
		"CH2": {},
		"CH3": {},
	}
	textSyncIPState = struct {
		sync.Mutex
		counts map[string]int
	}{
		counts: map[string]int{},
	}
	textSyncStore = struct {
		sync.RWMutex
		channels map[string]*textSyncChannelState
	}{
		channels: map[string]*textSyncChannelState{},
	}
	textSyncUpgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return isTextSyncOriginAllowed(r)
		},
	}
)

type textSyncChannelState struct {
	text    string
	clients map[*websocket.Conn]struct{}
}

type textSyncClientMessage struct {
	Type    string `json:"type"`
	Channel string `json:"channel"`
	Text    string `json:"text,omitempty"`
}

type textSyncSyncMessage struct {
	Type    string `json:"type"`
	Channel string `json:"channel"`
	Text    string `json:"text"`
}

type textSyncErrorMessage struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

func handleTextSyncWebSocket(c echo.Context) error {
	if c.Request().URL.Path != textSyncPath {
		return c.NoContent(http.StatusNotFound)
	}
	if !isTextSyncAuthenticated(c) {
		return c.JSON(http.StatusUnauthorized, map[string]string{"message": "Unauthorized"})
	}

	ip := c.RealIP()
	if !acquireTextSyncIPConnection(ip) {
		return c.JSON(http.StatusTooManyRequests, map[string]string{"message": "Too Many Requests"})
	}
	defer releaseTextSyncIPConnection(ip)

	conn, err := textSyncUpgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return nil
	}
	defer conn.Close()

	currentChannel := ""
	defer textSyncLeaveChannel(conn, &currentChannel)

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return nil
		}
		msg, ok := parseTextSyncClientMessage(raw)
		if !ok {
			sendTextSyncError(conn, "Invalid payload")
			continue
		}
		switch msg.Type {
		case "join":
			textSyncJoinChannel(conn, &currentChannel, msg.Channel)
		case "update":
			if currentChannel == "" || msg.Channel != currentChannel {
				sendTextSyncError(conn, "Channel mismatch")
				continue
			}
			if len([]byte(msg.Text)) > textSyncMaxTextBytes {
				sendTextSyncError(conn, "Text exceeds 65536 bytes")
				continue
			}
			textSyncBroadcast(msg.Channel, msg.Text)
		default:
			sendTextSyncError(conn, "Invalid payload")
		}
	}
}

func parseTextSyncClientMessage(raw []byte) (textSyncClientMessage, bool) {
	var msg textSyncClientMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return textSyncClientMessage{}, false
	}
	if msg.Type != "join" && msg.Type != "update" {
		return textSyncClientMessage{}, false
	}
	if _, ok := textSyncAllowedChannels[msg.Channel]; !ok {
		return textSyncClientMessage{}, false
	}
	if msg.Type == "update" && msg.Text == "" {
		// Allow empty string update; only ensure field presence by unmarshalling default.
	}
	return msg, true
}

func textSyncJoinChannel(conn *websocket.Conn, currentChannel *string, next string) {
	textSyncStore.Lock()
	defer textSyncStore.Unlock()

	if *currentChannel != "" {
		leaveFromCurrentChannelLocked(conn, *currentChannel)
	}
	state := textSyncStore.channels[next]
	if state == nil {
		state = &textSyncChannelState{
			text:    "",
			clients: map[*websocket.Conn]struct{}{},
		}
		textSyncStore.channels[next] = state
	}
	state.clients[conn] = struct{}{}
	*currentChannel = next
	sendTextSyncSync(conn, next, state.text)
}

func textSyncLeaveChannel(conn *websocket.Conn, currentChannel *string) {
	textSyncStore.Lock()
	defer textSyncStore.Unlock()
	if *currentChannel == "" {
		return
	}
	leaveFromCurrentChannelLocked(conn, *currentChannel)
	*currentChannel = ""
}

func leaveFromCurrentChannelLocked(conn *websocket.Conn, channel string) {
	state := textSyncStore.channels[channel]
	if state == nil {
		return
	}
	delete(state.clients, conn)
	if len(state.clients) == 0 {
		delete(textSyncStore.channels, channel)
	}
}

func textSyncBroadcast(channel, text string) {
	textSyncStore.Lock()
	state := textSyncStore.channels[channel]
	if state == nil {
		state = &textSyncChannelState{
			text:    "",
			clients: map[*websocket.Conn]struct{}{},
		}
		textSyncStore.channels[channel] = state
	}
	state.text = text
	conns := make([]*websocket.Conn, 0, len(state.clients))
	for conn := range state.clients {
		conns = append(conns, conn)
	}
	textSyncStore.Unlock()

	for _, conn := range conns {
		sendTextSyncSync(conn, channel, text)
	}
}

func sendTextSyncSync(conn *websocket.Conn, channel, text string) {
	_ = conn.WriteJSON(textSyncSyncMessage{
		Type:    "sync",
		Channel: channel,
		Text:    text,
	})
}

func sendTextSyncError(conn *websocket.Conn, message string) {
	_ = conn.WriteJSON(textSyncErrorMessage{
		Type:    "error",
		Message: message,
	})
}

func acquireTextSyncIPConnection(ip string) bool {
	textSyncIPState.Lock()
	defer textSyncIPState.Unlock()
	current := textSyncIPState.counts[ip]
	if current >= textSyncMaxConnectionsPer {
		return false
	}
	textSyncIPState.counts[ip] = current + 1
	return true
}

func releaseTextSyncIPConnection(ip string) {
	textSyncIPState.Lock()
	defer textSyncIPState.Unlock()
	current := textSyncIPState.counts[ip]
	if current <= 1 {
		delete(textSyncIPState.counts, ip)
		return
	}
	textSyncIPState.counts[ip] = current - 1
}

func isTextSyncAuthenticated(c echo.Context) bool {
	token := c.QueryParam("token")
	if token == "" {
		token = c.Request().Header.Get("Authorization")
	}
	if token == "" {
		if cookie, err := c.Cookie(textSyncAuthCookieName); err == nil {
			token = cookie.Value
		}
	}
	return token != "" && config.VerifyAuthJWT(token)
}

func isTextSyncOriginAllowed(r *http.Request) bool {
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
	return isTextSyncLoopback(originHost) && isTextSyncLoopback(requestHost)
}

func isTextSyncLoopback(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}
