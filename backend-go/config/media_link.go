package config

import (
	"crypto/hmac"
	"crypto/sha256"
)

// mediaLinkKeyInfo domain-separates the media-link key from the JWT signing key.
// The two keys are derived from the same secret, so a value signed as a media
// link can never be mistaken for an access token (and vice versa).
const mediaLinkKeyInfo = "file-lite/media-link/v1"

// MediaLinkKey returns the HMAC key that signs public media links.
//
// It is derived from jwtToken instead of being a field of its own: the derived
// key survives restarts without another secret in config.json, and regenerating
// jwtToken revokes every public link at once. Rotating it also signs every
// session out, which is the intended trade-off — there is nothing else to
// revoke with, since the links are stateless.
func MediaLinkKey() []byte {
	mac := hmac.New(sha256.New, []byte(jwtToken))
	mac.Write([]byte(mediaLinkKeyInfo))
	return mac.Sum(nil)
}
