package sevenzip

import (
	"regexp"
	"strconv"
	"sync"
)

// percentPattern matches a 7-Zip progress percentage. The process rewrites the
// same stderr line with backspaces, so the scanner has to run on the visible
// line, not on newline-delimited records.
var percentPattern = regexp.MustCompile(`(\d{1,3})%`)

// progressWriter applies backspaces and reports the latest percentage.
// It also keeps newline-terminated text for error messages.
type progressWriter struct {
	mu       sync.Mutex
	line     []byte
	log      []byte
	last     int
	seen     bool
	onChange func(int)
}

func (w *progressWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, b := range p {
		switch b {
		case '\b':
			if len(w.line) > 0 {
				w.line = w.line[:len(w.line)-1]
			}
		case '\n', '\r':
			w.captureLine()
			w.line = w.line[:0]
		default:
			w.line = append(w.line, b)
			w.notePercent()
		}
	}
	return len(p), nil
}

func (w *progressWriter) captureLine() {
	if len(w.line) == 0 {
		return
	}
	w.log = append(w.log, w.line...)
	w.log = append(w.log, '\n')
	w.notePercent()
}

func (w *progressWriter) notePercent() {
	matches := percentPattern.FindAllSubmatch(w.line, -1)
	if len(matches) == 0 {
		return
	}
	raw := matches[len(matches)-1][1]
	n, err := strconv.Atoi(string(raw))
	if err != nil || n > 100 {
		return
	}
	if w.seen && n == w.last {
		return
	}
	w.seen = true
	w.last = n
	if w.onChange != nil {
		// onChange must not call Write on this writer.
		w.onChange(n)
	}
}

// Text returns the newline-separated log with progress backspaces applied.
func (w *progressWriter) Text() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	buf := append([]byte(nil), w.log...)
	if len(w.line) > 0 {
		buf = append(buf, w.line...)
	}
	return string(buf)
}

// SawPercent reports whether a percentage was parsed.
func (w *progressWriter) SawPercent() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.seen
}
