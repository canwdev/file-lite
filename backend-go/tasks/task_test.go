package tasks

import (
	"encoding/json"
	"strings"
	"testing"
)

// 压缩 / 解压只有百分比：进度必须落在 Percent 上，字节字段保持 0，
// 否则客户端会把 100 当成「100 B」显示。
func TestSetPercentReportsPercentWithoutBytes(t *testing.T) {
	tk := &task{id: "t_percent", kind: KindCompress, state: StateRunning}

	tk.setIndeterminate()
	if got := tk.snapshot().Progress.Percent; got != nil {
		t.Fatalf("percent before the first tick = %v, want nil", got)
	}
	if wire := marshalProgress(t, tk.snapshot().Progress); strings.Contains(wire, `"percent"`) {
		t.Fatalf("progress before the first tick = %s, want no percent key", wire)
	}

	tk.setPercent(42)
	p := tk.snapshot().Progress
	if p.Percent == nil || *p.Percent != 42 {
		t.Fatalf("percent = %v, want 42", p.Percent)
	}
	if p.BytesTotal != 0 || p.BytesDone != 0 {
		t.Fatalf("bytes = %d/%d, want 0/0", p.BytesDone, p.BytesTotal)
	}
	if p.Indeterminate {
		t.Fatal("indeterminate should clear once a percentage arrives")
	}
	// 前端只看 JSON：percent 必须是数字，字节字段不能假装成百分比。
	if wire := marshalProgress(t, p); !strings.Contains(wire, `"percent":42`) {
		t.Fatalf("progress = %s, want percent 42", wire)
	}

	tk.setPercent(140)
	if got := *tk.snapshot().Progress.Percent; got != 100 {
		t.Fatalf("clamped high percent = %d, want 100", got)
	}
	tk.setPercent(-5)
	if got := *tk.snapshot().Progress.Percent; got != 0 {
		t.Fatalf("clamped low percent = %d, want 0", got)
	}
}

func marshalProgress(t *testing.T, p Progress) string {
	t.Helper()
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal progress: %v", err)
	}
	return string(b)
}
