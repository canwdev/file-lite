package config

import "testing"

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
