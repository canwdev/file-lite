package routes

import (
	"encoding/json"
	"testing"
	"time"
)

// text-sync 通道的成员关系与文本生命周期。
//
// 两个都不该丢文本的时刻：重复 join 同一个通道（TextSync 窗口每次打开都会 join，
// 窗口重开、前端重连都会重来一遍），以及最后一个客户端离开（关页面、断线、切通道）——
// 文本只活在服务端内存里，顺手删掉就再也找不回来了。

func newSharedWSTestClient() *sharedWSClient {
	return &sharedWSClient{
		send: make(chan []byte, 8),
		done: make(chan struct{}),
	}
}

// resetSharedWSTextSyncChannels 清空通道表，避免用例之间互相影响。
func resetSharedWSTextSyncChannels(t *testing.T) {
	t.Helper()
	clear := func() {
		sharedWSState.Lock()
		defer sharedWSState.Unlock()
		sharedWSTextSyncState.channels = map[string]*sharedWSTextChannelState{}
	}
	clear()
	t.Cleanup(clear)
}

func sendTextSync(t *testing.T, client *sharedWSClient, msg sharedWSTextSyncClientMessage) {
	t.Helper()
	handleSharedWSTextSyncMessage(client, msg)
}

// nextTextSyncText 读出下一条消息并校验它是该通道的 sync，返回其中的 text。
func nextTextSyncText(t *testing.T, client *sharedWSClient, channel string) string {
	t.Helper()
	select {
	case raw := <-client.send:
		var msg struct {
			Scope   string `json:"scope"`
			Type    string `json:"type"`
			Channel string `json:"channel"`
			Text    string `json:"text"`
		}
		if err := json.Unmarshal(raw, &msg); err != nil {
			t.Fatalf("unmarshal message: %v", err)
		}
		if msg.Scope != "text-sync" || msg.Type != "sync" || msg.Channel != channel {
			t.Fatalf("unexpected message %+v", msg)
		}
		return msg.Text
	case <-time.After(time.Second):
		t.Fatalf("no message for channel %s", channel)
		return ""
	}
}

// assertNoTextSyncMessage 断言该客户端此刻没有别的消息（join 的回包只发给加入者，不广播）。
func assertNoTextSyncMessage(t *testing.T, client *sharedWSClient) {
	t.Helper()
	select {
	case raw := <-client.send:
		t.Fatalf("unexpected message: %s", string(raw))
	case <-time.After(50 * time.Millisecond):
	}
}

func TestTextSyncRejoinKeepsChannelText(t *testing.T) {
	resetSharedWSTextSyncChannels(t)
	client := newSharedWSTestClient()

	sendTextSync(t, client, sharedWSTextSyncClientMessage{Type: "join", Channel: "CH1"})
	if text := nextTextSyncText(t, client, "CH1"); text != "" {
		t.Fatalf("first join text = %q, want empty", text)
	}

	sendTextSync(t, client, sharedWSTextSyncClientMessage{Type: "update", Channel: "CH1", Text: "hello"})
	if text := nextTextSyncText(t, client, "CH1"); text != "hello" {
		t.Fatalf("broadcast text = %q, want %q", text, "hello")
	}

	// 重开窗口 / 前端重连：同一个通道再 join 一次，文本必须还在
	sendTextSync(t, client, sharedWSTextSyncClientMessage{Type: "join", Channel: "CH1"})
	if text := nextTextSyncText(t, client, "CH1"); text != "hello" {
		t.Fatalf("rejoin text = %q, want %q", text, "hello")
	}
}

func TestTextSyncJoinReportsTextToJoinerOnly(t *testing.T) {
	resetSharedWSTextSyncChannels(t)
	first := newSharedWSTestClient()
	second := newSharedWSTestClient()

	sendTextSync(t, first, sharedWSTextSyncClientMessage{Type: "join", Channel: "CH1"})
	nextTextSyncText(t, first, "CH1")
	sendTextSync(t, first, sharedWSTextSyncClientMessage{Type: "update", Channel: "CH1", Text: "hello"})
	nextTextSyncText(t, first, "CH1")

	sendTextSync(t, second, sharedWSTextSyncClientMessage{Type: "join", Channel: "CH1"})
	if text := nextTextSyncText(t, second, "CH1"); text != "hello" {
		t.Fatalf("second client text = %q, want %q", text, "hello")
	}
	// 加入的回包只发给加入者：第一个客户端不该再收到一条（否则会把别人的输入覆盖掉）
	assertNoTextSyncMessage(t, first)
}

func TestTextSyncTextSurvivesEveryoneLeaving(t *testing.T) {
	resetSharedWSTextSyncChannels(t)
	client := newSharedWSTestClient()

	sendTextSync(t, client, sharedWSTextSyncClientMessage{Type: "join", Channel: "CH1"})
	nextTextSyncText(t, client, "CH1")
	sendTextSync(t, client, sharedWSTextSyncClientMessage{Type: "update", Channel: "CH1", Text: "hello"})
	nextTextSyncText(t, client, "CH1")

	// 切到另一个通道 = 退出 CH1，且是最后一个人：文本必须留着
	sendTextSync(t, client, sharedWSTextSyncClientMessage{Type: "join", Channel: "CH2"})
	nextTextSyncText(t, client, "CH2")

	other := newSharedWSTestClient()
	sendTextSync(t, other, sharedWSTextSyncClientMessage{Type: "join", Channel: "CH1"})
	if text := nextTextSyncText(t, other, "CH1"); text != "hello" {
		t.Fatalf("CH1 text after everyone left = %q, want %q", text, "hello")
	}
}

func TestTextSyncTextSurvivesDisconnect(t *testing.T) {
	resetSharedWSTextSyncChannels(t)
	client := newSharedWSTestClient()

	sendTextSync(t, client, sharedWSTextSyncClientMessage{Type: "join", Channel: "CH1"})
	nextTextSyncText(t, client, "CH1")
	sendTextSync(t, client, sharedWSTextSyncClientMessage{Type: "update", Channel: "CH1", Text: "hello"})
	nextTextSyncText(t, client, "CH1")

	// 刷新页面 / 断线：连接被注销，文本不能跟着走
	sharedWSState.Lock()
	sharedWSUnregisterTextSyncClientLocked(client)
	sharedWSState.Unlock()

	other := newSharedWSTestClient()
	sendTextSync(t, other, sharedWSTextSyncClientMessage{Type: "join", Channel: "CH1"})
	if text := nextTextSyncText(t, other, "CH1"); text != "hello" {
		t.Fatalf("CH1 text after disconnect = %q, want %q", text, "hello")
	}
}
