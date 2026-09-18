package main

import (
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	webpush "github.com/SherClockHolmes/webpush-go"
	"testing"
)

func testPushSubscription(t *testing.T) webpush.Subscription {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return webpush.Subscription{Endpoint: "https://fcm.googleapis.com/fcm/send/test-only", Keys: webpush.Keys{P256dh: base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(make([]byte, 16))}}
}
func TestPushSubscriptionValidation(t *testing.T) {
	s := testPushSubscription(t)
	for _, endpoint := range []string{"https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc", "https://abc.notify.windows.com/abc"} {
		s.Endpoint = endpoint
		if !validPushSubscription(s) {
			t.Fatalf("valid endpoint rejected: %s", endpoint)
		}
	}
	for _, endpoint := range []string{"http://fcm.googleapis.com/abc", "https://127.0.0.1/abc", "https://localhost/abc", "https://evil.example/abc", "https://fcm.googleapis.com.evil.example/abc", "https://user@fcm.googleapis.com/abc", "https://fcm.googleapis.com:8443/abc", "https://fcm.googleapis.com/abc#hash"} {
		s.Endpoint = endpoint
		if validPushSubscription(s) {
			t.Fatalf("unsafe endpoint accepted: %s", endpoint)
		}
	}
	s.Endpoint = "https://fcm.googleapis.com/abc"
	s.Keys.Auth = "bad"
	if validPushSubscription(s) {
		t.Fatal("bad auth key accepted")
	}
	s = testPushSubscription(t)
	s.Keys.P256dh = base64.RawURLEncoding.EncodeToString(make([]byte, 65))
	if validPushSubscription(s) {
		t.Fatal("invalid curve point accepted")
	}
	for _, path := range []string{"https://evil.example", "//evil.example", "/requests?redirect=evil", "/admin"} {
		if notificationURL(path) {
			t.Fatalf("unsafe navigation: %s", path)
		}
	}
}
