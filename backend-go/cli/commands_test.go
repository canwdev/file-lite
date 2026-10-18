package cli

import "testing"

// The first menu entry opens the Web UI on loopback. It used to open the IP
// selector, which has its own printed URL; the terminal action now lands on the
// page a user actually wants.
func TestFirstCommandOpensWebUI(t *testing.T) {
	commands := Commands()
	if len(commands) == 0 {
		t.Fatal("no commands")
	}
	first := commands[0]
	if first.ID != "open-web" || first.Label != "Open Web UI" {
		t.Fatalf("first command = %q %q, want open-web / Open Web UI", first.ID, first.Label)
	}
}
