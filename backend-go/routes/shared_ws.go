package routes

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"

	"file-lite-go/apierr"
	"file-lite-go/config"
	"file-lite-go/middlewares"
)

const (
	sharedWSPath              = "/api/ws"
	sharedWSMaxConnectionsPer = 20

	// 每个连接的出站队列长度。异步任务会高频推送进度，队列满时进度类消息
	// 会被丢弃（进度可丢，终态 / 冲突不可丢），绝不能因为一个慢客户端把广播阻塞住。
	sharedWSSendBufferSize = 256
	sharedWSWriteWait      = 10 * time.Second
	sharedWSPongWait       = 60 * time.Second
	sharedWSPingPeriod     = 25 * time.Second
	// 入站消息只剩 text-sync 的短文本（命令都走 HTTP）：给一个上限，
	// 免得一条畸形消息就把连接的内存吃光。
	sharedWSMaxMessageBytes = 256 << 10
)

var (
	sharedWSIPState = struct {
		sync.Mutex
		counts map[string]int
	}{
		counts: map[string]int{},
	}
	sharedWSState = struct {
		sync.Mutex
		clients map[*sharedWSClient]struct{}
	}{
		clients: map[*sharedWSClient]struct{}{},
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

	send      chan []byte
	done      chan struct{}
	closeOnce sync.Once
}

// enqueue 把已序列化的消息放进出站队列。
// droppable 为 true（进度等可丢消息）时队列满就丢弃，绝不阻塞调用方。
func (c *sharedWSClient) enqueue(payload []byte, droppable bool) {
	if droppable {
		select {
		case c.send <- payload:
		default:
		}
		return
	}
	select {
	case c.send <- payload:
	case <-c.done:
	}
}

func (c *sharedWSClient) close() {
	c.closeOnce.Do(func() {
		close(c.done)
		_ = c.conn.Close()
	})
}

// writeLoop 是唯一的写协程：串行化写操作，并周期性发 ping 探测半死连接。
func (c *sharedWSClient) writeLoop() {
	ticker := time.NewTicker(sharedWSPingPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case msg := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(sharedWSWriteWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				c.close()
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(sharedWSWriteWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				c.close()
				return
			}
		}
	}
}

type sharedWSTextSyncClientMessage struct {
	Type    string `json:"type"`
	Channel string `json:"channel"`
	Text    string `json:"text,omitempty"`
}

func handleSharedWebSocket(c echo.Context) error {
	if c.Request().URL.Path != sharedWSPath {
		return c.NoContent(http.StatusNotFound)
	}
	if !isSharedWSAuthenticated(c) {
		return apierr.Write(c, apierr.Unauthorized("Unauthorized"))
	}

	ip := c.RealIP()
	if !acquireSharedWSIPConnection(ip) {
		return apierr.Write(c, apierr.TooManyRequests("Too many connections"))
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
		send: make(chan []byte, sharedWSSendBufferSize),
		done: make(chan struct{}),
	}
	go client.writeLoop()
	sharedWSRegisterClient(client)
	defer sharedWSUnregisterClient(client)
	defer client.close()

	// 心跳：读超时由 pong 续期，半死连接会被清理，连接计数随之释放
	conn.SetReadLimit(sharedWSMaxMessageBytes)
	_ = conn.SetReadDeadline(time.Now().Add(sharedWSPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(sharedWSPongWait))
	})

	go syncSharedWSSettingsToClient(client)
	go sendSharedWSTasksSnapshot(client)

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return nil
		}

		// 入站只有实时协作：任务、设置、属性测量的命令全部走 HTTP
		// （见 docs/design/api.md §11）。这条连接只负责推送。
		msg, err := parseSharedWSTextSyncMessage(raw)
		if err != nil {
			sendSharedWSError(client, "text-sync", err.Error())
			continue
		}
		handleSharedWSTextSyncMessage(client, msg)
	}
}

func parseSharedWSTextSyncMessage(raw []byte) (sharedWSTextSyncClientMessage, error) {
	var msg sharedWSTextSyncClientMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return sharedWSTextSyncClientMessage{}, err
	}
	if (msg.Type != "join" && msg.Type != "update") || msg.Channel == "" {
		return sharedWSTextSyncClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
	}
	if !isSharedWSTextSyncChannelAllowed(msg.Channel) {
		return sharedWSTextSyncClientMessage{}, echo.NewHTTPError(http.StatusBadRequest, "Invalid payload")
	}
	return msg, nil
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
	sharedWSUnregisterTextSyncClientLocked(client)
}

func snapshotSharedWSClients() []*sharedWSClient {
	sharedWSState.Lock()
	defer sharedWSState.Unlock()

	clients := make([]*sharedWSClient, 0, len(sharedWSState.clients))
	for client := range sharedWSState.clients {
		clients = append(clients, client)
	}
	return clients
}

func sendSharedWSJSON(client *sharedWSClient, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	client.enqueue(raw, false)
}

// sendSharedWSJSONDroppable 用于进度这类可丢消息：慢客户端不会拖住广播。
func sendSharedWSJSONDroppable(client *sharedWSClient, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	client.enqueue(raw, true)
}

// sendSharedWSError 只用于协议层错误（消息解析不了、text-sync 频道不合法）。
// 命令已经走 HTTP，它们的失败由响应体的 code/message 给出，不需要在这里关联请求。
func sendSharedWSError(client *sharedWSClient, scope, message string) {
	sendSharedWSJSON(client, map[string]any{
		"scope":   scope,
		"type":    "error",
		"message": message,
	})
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
	// The browser sends the HttpOnly auth cookie on the same-origin handshake.
	// A bearer header stays supported for non-browser clients; the token is no
	// longer read from the query string, where it would leak into logs.
	token := c.Request().Header.Get("Authorization")
	if token == "" {
		if cookie, err := c.Cookie(middlewares.AuthCookieName); err == nil {
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
