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
