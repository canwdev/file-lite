package config

import (
	"bytes"
	"testing"
)

func TestMediaLinkKeyIsDerivedFromJWTToken(t *testing.T) {
	original := jwtToken
	t.Cleanup(func() { jwtToken = original })

	jwtToken = "first-secret"
	first := MediaLinkKey()
	if len(first) == 0 {
		t.Fatal("MediaLinkKey returned an empty key")
	}
	if bytes.Equal(first, []byte(jwtToken)) {
		t.Fatal("the media-link key must not be the JWT secret itself")
	}
	if !bytes.Equal(first, MediaLinkKey()) {
		t.Fatal("the derived key must be stable for the same secret")
	}

	jwtToken = "second-secret"
	if bytes.Equal(first, MediaLinkKey()) {
		t.Fatal("regenerating jwtToken must revoke every media link")
	}
}
