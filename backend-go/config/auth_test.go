package config

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt"
)

// withTestJWTSecret pins the signing key for the duration of one test. The
// package-level secret is empty in tests, which signs and verifies just fine,
// but pinning it makes a token minted here unmistakably ours.
func withTestJWTSecret(t *testing.T) {
	t.Helper()
	previous := jwtToken
	jwtToken = "test-secret"
	t.Cleanup(func() { jwtToken = previous })
}

func TestAuthTokenWindows(t *testing.T) {
	withTestJWTSecret(t)
	now := time.Now()

	fresh, err := NewAuthTokenAt(now, true)
	if err != nil {
		t.Fatal(err)
	}
	info, ok := ParseAuthToken(fresh)
	if !ok {
		t.Fatal("a freshly minted token was rejected")
	}
	if !info.AccessValid(now) {
		t.Error("a fresh token should authenticate")
	}
	if info.NeedsRenewal(now) {
		t.Error("a fresh token should not ask for renewal yet")
	}
	if !info.Renewable(now) {
		t.Error("a fresh token should be renewable")
	}
	if !info.Remember {
		t.Error("the remember flag was lost")
	}

	// Four minutes left: still valid, but inside the renewal threshold.
	near, err := NewAuthTokenAt(now.Add(-authAccessTTL+4*time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	nearInfo, ok := ParseAuthToken(near)
	if !ok || !nearInfo.AccessValid(now) {
		t.Fatal("a near-expiry token should still authenticate")
	}
	if !nearInfo.NeedsRenewal(now) {
		t.Error("a token with four minutes left should ask for renewal")
	}

	// Access window over, renewal window live: the API must reject it, but the
	// refresh endpoint must accept it.
	expired, err := NewAuthTokenAt(now.Add(-authAccessTTL-time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	expiredInfo, ok := ParseAuthToken(expired)
	if !ok {
		t.Fatal("an expired access token should still parse for renewal")
	}
	if expiredInfo.AccessValid(now) {
		t.Error("an expired access token must not authenticate")
	}
	if !expiredInfo.Renewable(now) {
		t.Error("an expired access token should still be renewable")
	}
	if VerifyAuthJWT(expired) {
		t.Error("VerifyAuthJWT accepted an expired access token")
	}

	// Both windows over: nothing may use it.
	dead, err := NewAuthTokenAt(now.Add(-authRenewWindow-time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	deadInfo, ok := ParseAuthToken(dead)
	if !ok {
		t.Fatal("a dead token should still parse")
	}
	if deadInfo.Renewable(now) {
		t.Error("a token past its renewal window must not be renewable")
	}
	if VerifyAuthJWT(dead) {
		t.Error("VerifyAuthJWT accepted a dead token")
	}
}

func TestRenewAuthTokenPreservesLoginAndRemember(t *testing.T) {
	withTestJWTSecret(t)
	now := time.Now()

	original, err := NewAuthTokenAt(now.Add(-time.Minute), false)
	if err != nil {
		t.Fatal(err)
	}
	before, ok := ParseAuthToken(original)
	if !ok {
		t.Fatal("original token rejected")
	}

	renewed, err := RenewAuthToken(before)
	if err != nil {
		t.Fatal(err)
	}
	after, ok := ParseAuthToken(renewed)
	if !ok {
		t.Fatal("renewed token rejected")
	}
	if after.Remember {
		t.Error("renewal turned a session cookie into a persistent one")
	}
	if !after.LoginAt.Equal(before.LoginAt) {
		t.Errorf("login time moved from %v to %v", before.LoginAt, after.LoginAt)
	}
	if !after.ExpiresAt.After(before.ExpiresAt) {
		t.Errorf("renewal did not extend the access window: %v -> %v", before.ExpiresAt, after.ExpiresAt)
	}
	if !after.RenewUntil.After(before.RenewUntil) {
		t.Errorf("renewal did not slide the renewal window: %v -> %v", before.RenewUntil, after.RenewUntil)
	}
}

func TestRenewAuthTokenRejectsDeadWindow(t *testing.T) {
	withTestJWTSecret(t)
	dead, err := NewAuthTokenAt(time.Now().Add(-authRenewWindow-time.Minute), true)
	if err != nil {
		t.Fatal(err)
	}
	info, ok := ParseAuthToken(dead)
	if !ok {
		t.Fatal("dead token rejected at parse time")
	}
	if _, err := RenewAuthToken(info); err == nil {
		t.Fatal("renewed a token whose renewal window had expired")
	}
}

func TestLegacyAuthTokenRejected(t *testing.T) {
	withTestJWTSecret(t)
	// A token shaped like 1.5.0: no ver, no rexp, one-year expiry. It must not
	// authenticate, otherwise the short access window would be bypassed for up
	// to a year after the upgrade.
	legacy, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": authJWTSubject,
		"typ": authJWTType,
		"iat": time.Now().Unix(),
		"exp": time.Now().AddDate(1, 0, 0).Unix(),
	}).SignedString([]byte(jwtToken))
	if err != nil {
		t.Fatal(err)
	}
	if VerifyAuthJWT(legacy) {
		t.Fatal("VerifyAuthJWT accepted a legacy token without rexp/ver")
	}
	if _, ok := ParseAuthToken(legacy); ok {
		t.Fatal("ParseAuthToken accepted a legacy token without rexp/ver")
	}
}
