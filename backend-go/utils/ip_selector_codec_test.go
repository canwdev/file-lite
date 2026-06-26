package utils

import "testing"

func TestEncodeIpSelectorParamsMatchesFixture(t *testing.T) {
	encoded, err := EncodeIpSelectorParams(IpSelectorParams{
		IPs:      []string{"198.18.0.1", "192.168.121.124", "fe80::937e:5a65:a60f:fdb0", "::1"},
		Port:     3110,
		Protocol: "http:",
		Ticket:   "UQtcAaKD",
	})
	if err != nil {
		t.Fatalf("encode failed: %v", err)
	}

	want := "AAwmVVF0Y0FhS0QEBMYSAAEEwKh5fAb-gAAAAAAAAJN-WmWmD_2wBgAAAAAAAAAAAAAAAAAAAAE"
	if encoded != want {
		t.Fatalf("encoded mismatch\nwant: %s\ngot:  %s", want, encoded)
	}
}
