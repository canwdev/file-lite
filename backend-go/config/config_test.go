package config

import (
	"reflect"
	"testing"
)

func TestNormalizeLogLevel(t *testing.T) {
	cases := map[string]string{
		"":          LogLevelWarn,
		"nonsense":  LogLevelWarn,
		"verbose":   LogLevelVerbose,
		" VERBOSE ": LogLevelVerbose,
		"warn":      LogLevelWarn,
		"error":     LogLevelError,
		"none":      LogLevelNone,
		"Warning":   LogLevelWarn,
	}
	for in, want := range cases {
		if got := normalizeLogLevel(in); got != want {
			t.Errorf("normalizeLogLevel(%q) = %q, want %q", in, got, want)
		}
	}
}

// startPath 已删除：首次打开进入哪个位置由前端的挂载点列表决定（第一个位置，
// 通常是 Home），不再有服务端配置的起始目录。
//
// 这条用例存在的意义不是测行为，而是**防止字段悄悄回来**：`Cfg` 会原样写回
// config.json，多一个字段就会重新定义「首次打开进入哪里」的语义。
//
// allowedRoots 后来**按需求回来了**（限制访问范围，默认空 = 不限制），所以这里不再
// 断言它不存在——它不再决定「首次打开进入哪里」，而是决定「能到哪里」。
func TestConfigHasNoStartPath(t *testing.T) {
	var c Cfg
	// 用反射而不是直接引用字段：字段一旦被删掉，这里也要继续能编译。
	typ := reflect.TypeOf(c)
	if _, ok := typ.FieldByName("StartPath"); ok {
		t.Fatal("Cfg 不该再有 StartPath 字段：首次打开的位置由前端的第一个挂载点决定")
	}
}

// An auth ticket is a single-use credential: redeeming it twice must fail, and
// the second attempt must not hand out another token.
func TestConsumeAuthTicketIsSingleUse(t *testing.T) {
	ticket, err := NewAuthTicket()
	if err != nil {
		t.Fatal(err)
	}

	first, ok := ConsumeAuthTicket(ticket.Value)
	if !ok || first == "" {
		t.Fatalf("first redemption failed: ok=%v token=%q", ok, first)
	}
	second, ok := ConsumeAuthTicket(ticket.Value)
	if ok || second != "" {
		t.Fatalf("a redeemed ticket was accepted again: ok=%v token=%q", ok, second)
	}

	// An unrelated ticket is still rejected, and a fresh one still works.
	if _, ok := ConsumeAuthTicket("not-a-ticket"); ok {
		t.Fatal("an unknown ticket was accepted")
	}
	fresh, err := NewAuthTicket()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := ConsumeAuthTicket(fresh.Value); !ok {
		t.Fatal("a fresh ticket should be accepted")
	}
}

// Development mode relaxes the CSRF check, so it must only answer to the
// file-lite-specific variable. NODE_ENV is set by unrelated tooling.
func TestIsExplicitDevModeIgnoresNodeEnv(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	if IsExplicitDevMode() {
		t.Fatal("NODE_ENV=development must not enable dev mode")
	}
	t.Setenv("FILE_LITE_DEV_MODE", "true")
	if !IsExplicitDevMode() {
		t.Fatal("FILE_LITE_DEV_MODE=true should enable dev mode")
	}
	t.Setenv("FILE_LITE_DEV_MODE", "1")
	if IsExplicitDevMode() {
		t.Fatal("only the exact value \"true\" enables dev mode")
	}
}
