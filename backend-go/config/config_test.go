package config

import (
	"reflect"
	"testing"
	"time"
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
	ticket, err := NewAuthTicket(TicketTierPersistent)
	if err != nil {
		t.Fatal(err)
	}

	first, ok := ConsumeAuthTicket(ticket.Value, true)
	if !ok || first == "" {
		t.Fatalf("first redemption failed: ok=%v token=%q", ok, first)
	}
	second, ok := ConsumeAuthTicket(ticket.Value, true)
	if ok || second != "" {
		t.Fatalf("a redeemed ticket was accepted again: ok=%v token=%q", ok, second)
	}

	// An unrelated ticket is still rejected, and a fresh one still works.
	if _, ok := ConsumeAuthTicket("not-a-ticket", true); ok {
		t.Fatal("an unknown ticket was accepted")
	}
	fresh, err := NewAuthTicket(TicketTierPersistent)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := ConsumeAuthTicket(fresh.Value, true); !ok {
		t.Fatal("a fresh ticket should be accepted")
	}
}

// The printed addresses are alternatives: each has its own single-use ticket,
// so redeeming the loopback link must not burn the LAN link a phone is about
// to open.
func TestAuthTicketsAreIndependent(t *testing.T) {
	tickets, err := NewAuthTickets(TicketTierPersistent, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(tickets) != 3 {
		t.Fatalf("got %d tickets, want 3", len(tickets))
	}
	seen := map[string]struct{}{}
	for _, ticket := range tickets {
		if _, duplicate := seen[ticket.Value]; duplicate {
			t.Fatalf("duplicate ticket %q", ticket.Value)
		}
		seen[ticket.Value] = struct{}{}
	}

	for i, ticket := range tickets {
		if _, ok := ConsumeAuthTicket(ticket.Value, true); !ok {
			t.Fatalf("ticket %d was burned by redeeming an earlier one", i)
		}
		if _, ok := ConsumeAuthTicket(ticket.Value, true); ok {
			t.Fatalf("ticket %d was accepted twice", i)
		}
	}
}

// A new mint replaces the whole batch: URLs from an earlier call stop working,
// which is what keeps a stale QR code from being redeemed.
func TestMintingReplacesPreviousBatch(t *testing.T) {
	first, err := NewAuthTicket(TicketTierPersistent)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewAuthTicket(TicketTierPersistent)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := ConsumeAuthTicket(first.Value, true); ok {
		t.Fatal("the replaced ticket was still accepted")
	}
	if _, ok := ConsumeAuthTicket(second.Value, true); !ok {
		t.Fatal("the current ticket was rejected")
	}
}

// A ticket that was never redeemed is rejected once its five minutes are over.
func TestExpiredTicketIsRejected(t *testing.T) {
	ticket, err := NewAuthTicket(TicketTierPersistent)
	if err != nil {
		t.Fatal(err)
	}
	authTicketMu.Lock()
	stored := authTickets[ticket.Value]
	stored.expiresAt = time.Now().Add(-time.Second)
	authTickets[ticket.Value] = stored
	authTicketMu.Unlock()

	if _, ok := ConsumeAuthTicket(ticket.Value, true); ok {
		t.Fatal("an expired ticket was accepted")
	}
}

// A ticket is typed by hand, so it is ten lowercase letters/digits.
func TestAuthTicketFormat(t *testing.T) {
	ticket, err := NewAuthTicket(TicketTierPersistent)
	if err != nil {
		t.Fatal(err)
	}
	if len(ticket.Value) != authTicketLength {
		t.Fatalf("ticket %q has %d characters, want %d", ticket.Value, len(ticket.Value), authTicketLength)
	}
	for _, char := range ticket.Value {
		lowercase := char >= 'a' && char <= 'z'
		digit := char >= '0' && char <= '9'
		if !lowercase && !digit {
			t.Fatalf("ticket %q contains %q; only 0-9a-z is allowed", ticket.Value, char)
		}
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

func TestParseTicketTier(t *testing.T) {
	if tier, ok := ParseTicketTier(""); !ok || tier != TicketTierPersistent {
		t.Fatalf("empty tier = %q, %v; want persistent", tier, ok)
	}
	for _, tier := range []TicketTier{TicketTier15m, TicketTier1h, TicketTier8h, TicketTier24h, TicketTierPersistent} {
		got, ok := ParseTicketTier(string(tier))
		if !ok || got != tier {
			t.Errorf("ParseTicketTier(%q) = %q, %v", tier, got, ok)
		}
	}
	if _, ok := ParseTicketTier("5m"); ok {
		t.Fatal("an unknown tier must be rejected")
	}
}

func TestTicketTierTokenPolicy(t *testing.T) {
	cases := []struct {
		tier      TicketTier
		wantRenew bool
		wantTTL   time.Duration
	}{
		{TicketTier15m, false, 15 * time.Minute},
		{TicketTier1h, false, time.Hour},
		{TicketTier8h, false, 8 * time.Hour},
		{TicketTier24h, false, 24 * time.Hour},
		{TicketTierPersistent, true, authAccessTTL},
	}
	for _, tc := range cases {
		t.Run(string(tc.tier), func(t *testing.T) {
			ticket, err := NewAuthTicket(tc.tier)
			if err != nil {
				t.Fatal(err)
			}
			token, ok := ConsumeAuthTicket(ticket.Value, true)
			if !ok {
				t.Fatal("ticket redemption failed")
			}
			info, ok := ParseAuthToken(token)
			if !ok {
				t.Fatal("issued token did not parse")
			}
			if info.CanRenew != tc.wantRenew {
				t.Fatalf("CanRenew = %v, want %v", info.CanRenew, tc.wantRenew)
			}
			remaining := time.Until(info.ExpiresAt)
			if remaining < tc.wantTTL-5*time.Second || remaining > tc.wantTTL+5*time.Second {
				t.Fatalf("expires in %v, want about %v", remaining, tc.wantTTL)
			}
			if info.NeedsRenewal(time.Now()) {
				t.Fatal("a freshly issued token must not need renewal")
			}
			if _, err := RenewAuthToken(info); (err == nil) != tc.wantRenew {
				t.Fatalf("RenewAuthToken error = %v, wantRenew = %v", err, tc.wantRenew)
			}
		})
	}
}

// A token minted by a version without the norenew claim is still renewable:
// the field is absent, so the parser must default to the old behaviour.
func TestTokensWithoutNoRenewRemainRenewable(t *testing.T) {
	token, err := NewAuthTokenAt(time.Now(), true)
	if err != nil {
		t.Fatal(err)
	}
	info, ok := ParseAuthToken(token)
	if !ok || !info.CanRenew {
		t.Fatalf("legacy-shaped token CanRenew = %v, ok = %v", info.CanRenew, ok)
	}
	if _, err := RenewAuthToken(info); err != nil {
		t.Fatalf("legacy-shaped token should renew: %v", err)
	}
}
