package main

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

func writeAuthenticationError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication is required"})
		return
	}
	// Infrastructure failures must not revoke valid browser sessions.
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "session service is temporarily unavailable"})
}
