package main

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	webpush "github.com/SherClockHolmes/webpush-go"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestVAPIDSubscriberProducesValidContactClaim(t *testing.T) {
	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	for _, subject := range []string{"mailto:support@wtmelon.store", "support@wtmelon.store", " MAILTO:support@wtmelon.store "} {
		t.Run(subject, func(t *testing.T) {
			s := testPushSubscription(t)
			s.Endpoint = "https://web.push.apple.com/test-only"
			client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				auth := r.Header.Get("Authorization")
				token := strings.Split(strings.TrimPrefix(auth, "vapid t="), ",")[0]
				parts := strings.Split(token, ".")
				if len(parts) != 3 {
					t.Fatal("missing VAPID token")
				}
				data, err := base64.RawURLEncoding.DecodeString(parts[1])
				if err != nil {
					t.Fatal(err)
				}
				var claims map[string]any
				if err := json.Unmarshal(data, &claims); err != nil {
					t.Fatal(err)
				}
				if claims["sub"] != "mailto:support@wtmelon.store" || claims["aud"] != "https://web.push.apple.com" {
					t.Fatalf("invalid VAPID contact or audience: %v", claims)
				}
				return &http.Response{StatusCode: 201, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
			})}
			response, err := webpush.SendNotificationWithContext(context.Background(), []byte(`{"title":"test"}`), &s, &webpush.Options{HTTPClient: client, Subscriber: vapidSubscriber(subject), VAPIDPublicKey: public, VAPIDPrivateKey: private, TTL: 60})
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
		})
	}
	if got := vapidSubscriber("https://wtmelon.store/support"); got != "https://wtmelon.store/support" {
		t.Fatal(got)
	}
}

func TestPushProviderReasonDoesNotExposeResponseSecrets(t *testing.T) {
	if got := pushProviderReason([]byte(`{"reason":"BadJwtToken"}`)); got != "BadJwtToken" {
		t.Fatal(got)
	}
	for _, body := range []string{`{"reason":"private-token"}`, `{"error":"secret"}`, `not json`} {
		if got := pushProviderReason([]byte(body)); got != "unknown" {
			t.Fatal(got)
		}
	}
}

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
