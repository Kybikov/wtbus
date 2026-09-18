package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/mail"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/vivat-bus/tms/internal/customerexport"
	"github.com/vivat-bus/tms/internal/customerimport"
	"github.com/vivat-bus/tms/internal/telegramoutbox"
	"golang.org/x/crypto/bcrypt"
)

type application struct {
	db                  *pgxpool.Pool
	redis               *redis.Client
	log                 *slog.Logger
	saasControlSecret   string
	bootstrapEmail      string
	bootstrapPassword   string
	bootstrapTenant     string
	bootstrapReset      bool
	seedDemoData        bool
	pushPublicKey       string
	pushPrivateKey      string
	notificationContext context.Context
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	databaseURL := requiredEnv("DATABASE_URL")
	redisURL := requiredEnv("REDIS_URL")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		logger.Error("open postgres pool", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.Ping(ctx); err != nil {
		logger.Error("ping postgres", "error", err)
		os.Exit(1)
	}

	redisOptions, err := redis.ParseURL(redisURL)
	if err != nil {
		logger.Error("parse redis URL", "error", err)
		os.Exit(1)
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		logger.Error("ping redis", "error", err)
		os.Exit(1)
	}

	app := &application{
		db:                db,
		redis:             redisClient,
		log:               logger,
		saasControlSecret: optionalEnv("SAAS_CONTROL_SECRET", ""),
		bootstrapEmail:    optionalEnv("BOOTSTRAP_OWNER_EMAIL", ""),
		bootstrapPassword: optionalEnv("BOOTSTRAP_OWNER_PASSWORD", ""),
		bootstrapTenant:   optionalEnv("BOOTSTRAP_TENANT_SLUG", "vivat-bus"),
		bootstrapReset:    explicitlyEnabled(optionalEnv("BOOTSTRAP_OWNER_RESET_PASSWORD", "")),
		seedDemoData:      explicitlyEnabled(optionalEnv("SEED_DEMO_DATA", "")),
	}
	if err := app.ensureBootstrapOwner(ctx); err != nil {
		logger.Error("ensure bootstrap owner", "error", err)
		os.Exit(1)
	}
	if err := app.ensureSystemActors(ctx); err != nil {
		logger.Error("ensure system actors", "error", err)
		os.Exit(1)
	}
	if app.seedDemoData {
		if err := app.ensureLocalDemoTrips(ctx); err != nil {
			logger.Error("ensure local demo trips", "error", err)
			os.Exit(1)
		}
	}
	if err := app.ensurePushKeys(ctx); err != nil {
		logger.Error("initialize push keys (run database migrations first)", "error", err)
		os.Exit(1)
	}
	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	app.notificationContext = signalContext
	workerDone := make(chan struct{})
	go func() { defer close(workerDone); app.notificationWorker(signalContext) }()
	server := &http.Server{
		Addr:              ":8080",
		Handler:           app.routes(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("api started", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("serve api", "error", err)
			os.Exit(1)
		}
	}()

	<-signalContext.Done()

	shutdownContext, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		logger.Error("shutdown api", "error", err)
	}
	select {
	case <-workerDone:
	case <-shutdownContext.Done():
	}
}

func (app *application) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", app.health)
	mux.HandleFunc("GET /readyz", app.ready)
	mux.HandleFunc("POST /api/v1/auth/login", app.login)
	mux.HandleFunc("POST /api/v1/auth/select-company", app.selectCompany)
	mux.HandleFunc("GET /api/v1/auth/me", app.me)
	mux.HandleFunc("PATCH /api/v1/auth/me", app.updateProfile)
	mux.HandleFunc("POST /api/v1/auth/logout", app.logout)
	mux.HandleFunc("GET /api/v1/public/{slug}/catalog", app.publicCatalog)
	mux.HandleFunc("GET /api/v1/public/{slug}/trips", app.publicTrips)
	mux.HandleFunc("POST /api/v1/public/{slug}/bookings", app.publicCreateBooking)
	staff := app.requireRoles("owner", "admin", "dispatcher", "driver")
	mux.HandleFunc("GET /api/v1/realtime", app.realtime)
	for _, method := range []string{"GET", "POST", "PATCH", "DELETE"} {
		mux.HandleFunc(method+" /api/v1/me/notifications", staff(app.notifications))
		mux.HandleFunc(method+" /api/v1/me/push", staff(app.pushSettings))
	}
	operations := app.requireRoles("owner", "admin", "dispatcher")
	managers := app.requireRoles("owner", "admin")
	mux.HandleFunc("GET /api/v1/tenants/{slug}/entity-details/{entity}/{recordID}", operations(app.entityDetails))
	for _, method := range []string{"GET", "POST", "PATCH", "DELETE"} {
		mux.HandleFunc(method+" /api/v1/tenants/{slug}/entity-views", operations(app.entityViews))
	}
	finance := app.requireRoles("owner", "admin")
	drivers := app.requireRoles("driver")
	tripOperators := app.requireRoles("owner", "admin", "dispatcher", "driver")
	mux.HandleFunc("GET /api/v1/me/preferences", staff(app.getUserPreferences))
	mux.HandleFunc("PATCH /api/v1/me/preferences", staff(app.updateUserPreferences))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/trips", operations(app.listTrips))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/dashboard", operations(app.dashboardSummary))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/trips", operations(app.requireActiveSubscription(app.createTrip)))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/trips/schedule", operations(app.requireActiveSubscription(app.createTripSchedule)))
	mux.HandleFunc("PATCH /api/v1/tenants/{slug}/trips/{tripID}", tripOperators(app.changeTripStatus))
	mux.HandleFunc("PUT /api/v1/tenants/{slug}/trips/{tripID}", operations(app.requireActiveSubscription(app.updateTrip)))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/trip-resources", operations(app.listTripResources))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/routes", operations(app.listRoutes))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/routes", operations(app.requireActiveSubscription(app.createRoute)))
	mux.HandleFunc("PATCH /api/v1/tenants/{slug}/routes/{routeID}", operations(app.requireActiveSubscription(app.updateRoute)))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/availability-blocks", operations(app.listAvailabilityBlocks))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/availability-blocks", operations(app.requireActiveSubscription(app.createAvailabilityBlock)))
	mux.HandleFunc("DELETE /api/v1/tenants/{slug}/availability-blocks/{blockID}", operations(app.requireActiveSubscription(app.deleteAvailabilityBlock)))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/fleet", tripOperators(app.listFleet))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/fleet", managers(app.requireActiveSubscription(app.createVehicle)))
	mux.HandleFunc("PATCH /api/v1/tenants/{slug}/fleet/{vehicleID}", managers(app.requireActiveSubscription(app.updateVehicle)))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/customers", operations(app.listCustomers))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/customers/{customerID}", operations(app.getCustomer))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/customers/export", operations(app.exportCustomers))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/customers", operations(app.requireActiveSubscription(app.createCustomer)))
	mux.HandleFunc("PATCH /api/v1/tenants/{slug}/customers/{customerID}", operations(app.requireActiveSubscription(app.updateCustomer)))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/customers/import", operations(app.requireActiveSubscription(app.importCustomers)))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/custom-fields", operations(app.listCustomFields))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/custom-fields", managers(app.requireActiveSubscription(app.createCustomField)))
	mux.HandleFunc("PATCH /api/v1/tenants/{slug}/custom-fields/{fieldID}", managers(app.requireActiveSubscription(app.updateCustomField)))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/bookings", operations(app.listBookings))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/bookings", operations(app.requireActiveSubscription(app.createBooking)))
	mux.HandleFunc("PATCH /api/v1/tenants/{slug}/bookings/{bookingID}", operations(app.requireActiveSubscription(app.updateBooking)))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/bookings/{bookingID}/payment-confirmation", managers(app.requireActiveSubscription(app.confirmBookingPayment)))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/individual-transfer-requests", operations(app.listIndividualTransferRequests))
	mux.HandleFunc("PATCH /api/v1/tenants/{slug}/individual-transfer-requests/{requestID}", operations(app.requireActiveSubscription(app.updateIndividualTransferRequest)))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/gps-points", tripOperators(app.recordGPSPoint))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/driver/cash-summary", drivers(app.driverCashSummary))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/driver/passengers", drivers(app.driverPassengers))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/driver/cash-received", drivers(app.confirmDriverCashReceived))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/finance/summary", finance(app.financeSummary))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/finance/driver-cash", finance(app.requireActiveSubscription(app.recordDriverCash)))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/finance/expenses", finance(app.requireActiveSubscription(app.recordOperationalExpense)))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/branding", staff(app.getBranding))
	mux.HandleFunc("PATCH /api/v1/tenants/{slug}/branding", managers(app.requireActiveSubscription(app.updateBranding)))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/payment-config", managers(app.getPaymentConfig))
	mux.HandleFunc("PATCH /api/v1/tenants/{slug}/payment-config", managers(app.requireActiveSubscription(app.updatePaymentConfig)))
	mux.HandleFunc("GET /api/v1/tenants/{slug}/team", managers(app.listTeam))
	mux.HandleFunc("POST /api/v1/tenants/{slug}/team", managers(app.requireActiveSubscription(app.createTeamMember)))
	mux.HandleFunc("PATCH /api/v1/tenants/{slug}/team/{membershipID}", managers(app.requireActiveSubscription(app.updateTeamMember)))
	mux.HandleFunc("DELETE /api/v1/tenants/{slug}/team/{membershipID}", managers(app.requireActiveSubscription(app.deleteTeamMember)))
	mux.HandleFunc("POST /api/v1/control/tenants", app.provisionTenant)
	mux.HandleFunc("PUT /api/v1/tenants/{slug}/subscription", app.updateSubscription)
	return app.recover(app.securityHeaders(app.cors(mux)))
}

type tenantContextKey struct{}

func (app *application) requireActiveSubscription(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
		tenant, ok := app.loadTenant(w, r, slug)
		if !ok {
			return
		}
		if !subscriptionAllowsOperations(tenant.SubscriptionStatus) {
			writeJSON(w, http.StatusPaymentRequired, map[string]string{
				"error":              "subscription is inactive; update payment to continue",
				"code":               "subscription_inactive",
				"subscriptionStatus": tenant.SubscriptionStatus,
			})
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), tenantContextKey{}, tenant)))
	}
}

func subscriptionAllowsOperations(status string) bool {
	return status == "trial" || status == "active"
}

const sessionLifetime = 30 * 24 * time.Hour

const (
	loginFailureLimit        = 8
	loginFailureWindow       = 15 * time.Minute
	companySelectionLifetime = 10 * time.Minute
)

type identity struct {
	UserID       string
	MembershipID string
	TenantID     string
	TenantSlug   string
	Role         string
	DisplayName  string
	Email        string
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type companyChoice struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type selectCompanyRequest struct {
	SelectionToken string `json:"selectionToken"`
	TenantSlug     string `json:"tenantSlug"`
}

type loginResponse struct {
	SessionToken             string          `json:"sessionToken,omitempty"`
	ExpiresAt                *time.Time      `json:"expiresAt,omitempty"`
	TenantSlug               string          `json:"tenantSlug,omitempty"`
	Role                     string          `json:"role,omitempty"`
	DisplayName              string          `json:"displayName,omitempty"`
	RequiresCompanySelection bool            `json:"requiresCompanySelection,omitempty"`
	Companies                []companyChoice `json:"companies,omitempty"`
	SelectionToken           string          `json:"selectionToken,omitempty"`
}

func (app *application) ensureBootstrapOwner(ctx context.Context) error {
	if app.bootstrapEmail == "" && app.bootstrapPassword == "" {
		return nil
	}
	if app.bootstrapEmail == "" || app.bootstrapPassword == "" || len([]rune(app.bootstrapPassword)) < 12 {
		return errors.New("bootstrap owner requires an email and a password of at least 12 characters")
	}
	email := strings.ToLower(strings.TrimSpace(app.bootstrapEmail))
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email {
		return errors.New("bootstrap owner email is invalid")
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(app.bootstrapPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash bootstrap password: %w", err)
	}
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var tenantID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM tenants WHERE slug = $1`, strings.ToLower(strings.TrimSpace(app.bootstrapTenant))).Scan(&tenantID); err != nil {
		return fmt.Errorf("load bootstrap tenant: %w", err)
	}
	var userID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO users (email, display_name) VALUES ($1, 'Local owner')
		ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
		RETURNING id::text
	`, email).Scan(&userID); err != nil {
		return fmt.Errorf("create bootstrap user: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO memberships (tenant_id, user_id, role, is_active)
		VALUES ($1, $2, 'owner', true)
		ON CONFLICT (tenant_id, user_id) DO UPDATE
		SET role = CASE WHEN memberships.role::text = 'developer' THEN memberships.role ELSE 'owner'::membership_role END, is_active = true
	`, tenantID, userID); err != nil {
		return fmt.Errorf("create bootstrap membership: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash
		WHERE $3
	`, userID, string(passwordHash), app.bootstrapReset); err != nil {
		return fmt.Errorf("create bootstrap credentials: %w", err)
	}
	if app.bootstrapReset {
		if _, err := tx.Exec(ctx, `DELETE FROM user_sessions WHERE user_id = $1`, userID); err != nil {
			return fmt.Errorf("revoke bootstrap user sessions: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if app.bootstrapReset {
		app.log.Info("bootstrap owner password reset")
	}
	return nil
}

type systemActorStore interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func systemActorEmail(tenantID string) string {
	return "automation+" + strings.ReplaceAll(tenantID, "-", "") + "@system.local"
}

func ensureSystemActor(ctx context.Context, store systemActorStore, tenantID string) (string, error) {
	var userID string
	if err := store.QueryRow(ctx, `
		INSERT INTO users (email, display_name, is_system)
		VALUES ($1, 'Автомат', true)
		ON CONFLICT (email) DO UPDATE
		SET display_name = EXCLUDED.display_name, is_system = true, updated_at = now()
		RETURNING id::text
	`, systemActorEmail(tenantID)).Scan(&userID); err != nil {
		return "", fmt.Errorf("create system user: %w", err)
	}
	var membershipID string
	if err := store.QueryRow(ctx, `
		INSERT INTO memberships (tenant_id, user_id, role, is_active)
		VALUES ($1, $2, 'admin', true)
		ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin', is_active = true
		RETURNING id::text
	`, tenantID, userID).Scan(&membershipID); err != nil {
		return "", fmt.Errorf("create system membership: %w", err)
	}
	return membershipID, nil
}

func (app *application) ensureSystemActors(ctx context.Context) error {
	rows, err := app.db.Query(ctx, `SELECT id::text FROM tenants`)
	if err != nil {
		return err
	}
	defer rows.Close()
	tenantIDs := make([]string, 0)
	for rows.Next() {
		var tenantID string
		if err := rows.Scan(&tenantID); err != nil {
			return err
		}
		tenantIDs = append(tenantIDs, tenantID)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, tenantID := range tenantIDs {
		if _, err := ensureSystemActor(ctx, app.db, tenantID); err != nil {
			return err
		}
	}
	return nil
}

func explicitlyEnabled(value string) bool {
	return strings.EqualFold(strings.TrimSpace(value), "true")
}

func (app *application) ensureLocalDemoTrips(ctx context.Context) error {
	tenantSlug := strings.ToLower(strings.TrimSpace(app.bootstrapTenant))
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin demo trip seed: %w", err)
	}
	defer tx.Rollback(ctx)

	var tenantID, timezone string
	if err := tx.QueryRow(ctx, `SELECT id::text, timezone FROM tenants WHERE slug = $1`, tenantSlug).Scan(&tenantID, &timezone); err != nil {
		return fmt.Errorf("load demo tenant: %w", err)
	}
	var futureTrips int
	if err := tx.QueryRow(ctx, `
		SELECT count(*)
		FROM trips
		WHERE tenant_id = $1 AND starts_at >= now() AND status <> 'cancelled'
	`, tenantID).Scan(&futureTrips); err != nil {
		return fmt.Errorf("check future demo trips: %w", err)
	}
	if futureTrips > 0 {
		return tx.Commit(ctx)
	}

	location, err := time.LoadLocation(timezone)
	if err != nil {
		return fmt.Errorf("load demo tenant timezone: %w", err)
	}
	var vehicleID, driverID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO vehicles (tenant_id, name, registration_number, vehicle_class, capacity, is_active)
		VALUES ($1, 'Демо Mercedes Sprinter', 'DEMO-001', 'microbus', 17, true)
		ON CONFLICT (tenant_id, registration_number) DO UPDATE SET is_active = true
		RETURNING id::text
	`, tenantID).Scan(&vehicleID); err != nil {
		return fmt.Errorf("ensure demo vehicle: %w", err)
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO drivers (tenant_id, full_name, phone_e164, is_active)
		VALUES ($1, 'Демо-диспетчер', '+380000000001', true)
		ON CONFLICT (tenant_id, phone_e164) DO UPDATE SET is_active = true
		RETURNING id::text
	`, tenantID).Scan(&driverID); err != nil {
		return fmt.Errorf("ensure demo driver: %w", err)
	}

	type demoTrip struct {
		routeName   string
		origin      string
		destination string
		currency    string
		priceMinor  int64
		startOffset int
		startHour   int
		travelTime  time.Duration
	}
	demoTrips := []demoTrip{
		{routeName: "Варшава — Киев", origin: "Варшава", destination: "Киев", currency: "EUR", priceMinor: 7900, startOffset: 1, startHour: 9, travelTime: 9 * time.Hour},
		{routeName: "Краков — Львов", origin: "Краков", destination: "Львов", currency: "EUR", priceMinor: 6500, startOffset: 2, startHour: 10, travelTime: 7*time.Hour + 30*time.Minute},
		{routeName: "Львов — Киев", origin: "Львов", destination: "Киев", currency: "UAH", priceMinor: 120000, startOffset: 3, startHour: 8, travelTime: 8 * time.Hour},
	}
	today := time.Now().In(location)
	dayStart := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, location)
	for _, demo := range demoTrips {
		var routeID string
		err := tx.QueryRow(ctx, `
			SELECT id::text FROM routes
			WHERE tenant_id = $1 AND name = $2
			ORDER BY created_at ASC
			LIMIT 1
		`, tenantID, demo.routeName).Scan(&routeID)
		if errors.Is(err, pgx.ErrNoRows) {
			err = tx.QueryRow(ctx, `
				INSERT INTO routes (tenant_id, name, origin_name, destination_name, currency, default_price_minor, default_pricing_mode)
				VALUES ($1, $2, $3, $4, $5, $6, 'per_passenger')
				RETURNING id::text
			`, tenantID, demo.routeName, demo.origin, demo.destination, demo.currency, demo.priceMinor).Scan(&routeID)
		}
		if err != nil {
			return fmt.Errorf("ensure demo route %q: %w", demo.routeName, err)
		}
		startsAt := dayStart.AddDate(0, 0, demo.startOffset).Add(time.Duration(demo.startHour) * time.Hour)
		if _, err := tx.Exec(ctx, `
			INSERT INTO trips (
				tenant_id, route_id, vehicle_id, driver_id, kind, status, origin_name, destination_name,
				starts_at, ends_at, capacity, price_minor, pricing_mode, currency, notes
			)
			VALUES ($1, $2, $3, $4, 'regular', 'new', $5, $6, $7, $8, 17, $9, 'per_passenger', $10, 'Локальный демо-рейс: можно использовать для теста бронирования в боте.')
		`, tenantID, routeID, vehicleID, driverID, demo.origin, demo.destination, startsAt, startsAt.Add(demo.travelTime), demo.priceMinor, demo.currency); err != nil {
			return fmt.Errorf("create demo trip %q: %w", demo.routeName, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit demo trip seed: %w", err)
	}
	app.log.Info("local demo trips ensured", "tenant", tenantSlug, "count", len(demoTrips))
	return nil
}

func sessionToken() (string, []byte, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", nil, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	hash := sha256.Sum256([]byte(token))
	return token, hash[:], nil
}

func sessionTokenFromRequest(r *http.Request) (string, bool) {
	authorization := strings.TrimSpace(r.Header.Get("Authorization"))
	if !strings.HasPrefix(authorization, "Bearer ") {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer "))
	return token, token != ""
}

func loginThrottleKey(r *http.Request, email string) string {
	remoteAddress := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(remoteAddress); err == nil {
		remoteAddress = host
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{remoteAddress, email}, "\x00")))
	return fmt.Sprintf("auth:login:%x", sum[:])
}

func companySelectionKey(tokenHash []byte) string {
	return "auth:company-selection:" + base64.RawURLEncoding.EncodeToString(tokenHash)
}

func (app *application) createSession(ctx context.Context, result identity) (loginResponse, error) {
	token, tokenHash, err := sessionToken()
	if err != nil {
		return loginResponse{}, fmt.Errorf("create session token: %w", err)
	}
	expiresAt := time.Now().UTC().Add(sessionLifetime)
	if _, err := app.db.Exec(ctx, `
		INSERT INTO user_sessions (user_id, membership_id, token_hash, expires_at)
		VALUES ($1, $2, $3, $4)
	`, result.UserID, result.MembershipID, tokenHash, expiresAt); err != nil {
		return loginResponse{}, fmt.Errorf("store session: %w", err)
	}
	return loginResponse{
		SessionToken: token,
		ExpiresAt:    &expiresAt,
		TenantSlug:   result.TenantSlug,
		Role:         result.Role,
		DisplayName:  result.DisplayName,
	}, nil
}

func (app *application) loginIsLimited(ctx context.Context, key string) (bool, error) {
	count, err := app.redis.Get(ctx, key).Int()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return count >= loginFailureLimit, nil
}

func (app *application) recordFailedLogin(ctx context.Context, key string) (bool, error) {
	count, err := app.redis.Incr(ctx, key).Result()
	if err != nil {
		return false, err
	}
	if count == 1 {
		if err := app.redis.Expire(ctx, key, loginFailureWindow).Err(); err != nil {
			return false, err
		}
	}
	return count >= loginFailureLimit, nil
}

func (app *application) authenticate(r *http.Request) (identity, string, error) {
	token, ok := sessionTokenFromRequest(r)
	if !ok {
		return identity{}, "", pgx.ErrNoRows
	}
	hash := sha256.Sum256([]byte(token))
	var result identity
	err := app.db.QueryRow(r.Context(), `
		SELECT u.id::text, m.id::text, t.id::text, t.slug, m.role::text, u.display_name, u.email
		FROM user_sessions s
		JOIN users u ON u.id = s.user_id
		JOIN memberships m ON m.id = s.membership_id AND m.user_id = u.id AND m.is_active
		JOIN tenants t ON t.id = m.tenant_id
		WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
	`, hash[:]).Scan(&result.UserID, &result.MembershipID, &result.TenantID, &result.TenantSlug, &result.Role, &result.DisplayName, &result.Email)
	if err != nil {
		return identity{}, "", err
	}
	return result, token, nil
}

func (app *application) requireRoles(roles ...string) func(http.HandlerFunc) http.HandlerFunc {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[role] = struct{}{}
	}
	allowed["developer"] = struct{}{}
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			identity, _, err := app.authenticate(r)
			if err != nil {
				writeAuthenticationError(w, err)
				return
			}
			slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
			if slug != "" && identity.TenantSlug != slug {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "tenant access is denied"})
				return
			}
			if _, ok := allowed[identity.Role]; !ok {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "role access is denied"})
				return
			}
			next(w, r.WithContext(context.WithValue(r.Context(), identityContextKey{}, identity)))
		}
	}
}

type identityContextKey struct{}

func (app *application) login(w http.ResponseWriter, r *http.Request) {
	var input loginRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid login payload"})
		return
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if input.Email == "" || input.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email and password are required"})
		return
	}
	throttleKey := loginThrottleKey(r, input.Email)
	limited, err := app.loginIsLimited(r.Context(), throttleKey)
	if err != nil {
		app.log.Error("check login rate limit", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authentication is temporarily unavailable"})
		return
	}
	if limited {
		w.Header().Set("Retry-After", strconv.Itoa(int(loginFailureWindow.Seconds())))
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many failed attempts; try again later"})
		return
	}
	var userID, displayName, email, passwordHash string
	err = app.db.QueryRow(r.Context(), `
		SELECT u.id::text, u.display_name, u.email, c.password_hash
		FROM users u
		JOIN user_credentials c ON c.user_id = u.id
		WHERE u.email = $1
	`, input.Email).Scan(&userID, &displayName, &email, &passwordHash)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(input.Password)) != nil {
		limited, limiterErr := app.recordFailedLogin(r.Context(), throttleKey)
		if limiterErr != nil {
			app.log.Error("record failed login", "error", limiterErr)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authentication is temporarily unavailable"})
			return
		}
		if limited {
			w.Header().Set("Retry-After", strconv.Itoa(int(loginFailureWindow.Seconds())))
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "too many failed attempts; try again later"})
			return
		}
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
		return
	}

	rows, err := app.db.Query(r.Context(), `
		SELECT m.id::text, t.id::text, t.slug, t.name, m.role::text
		FROM memberships m
		JOIN tenants t ON t.id = m.tenant_id
		WHERE m.user_id = $1 AND m.is_active
		ORDER BY t.name ASC, t.slug ASC
	`, userID)
	if err != nil {
		app.log.Error("load user companies", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load companies"})
		return
	}
	defer rows.Close()

	companies := make([]companyChoice, 0, 2)
	identities := make([]identity, 0, 2)
	for rows.Next() {
		var membership identity
		var company companyChoice
		if err := rows.Scan(&membership.MembershipID, &membership.TenantID, &membership.TenantSlug, &company.Name, &membership.Role); err != nil {
			app.log.Error("scan user company", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load companies"})
			return
		}
		membership.UserID = userID
		membership.DisplayName = displayName
		membership.Email = email
		company.Slug = membership.TenantSlug
		company.Role = membership.Role
		companies = append(companies, company)
		identities = append(identities, membership)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate user companies", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load companies"})
		return
	}
	if len(identities) == 0 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid email or password"})
		return
	}
	if err := app.redis.Del(r.Context(), throttleKey).Err(); err != nil {
		app.log.Warn("clear failed login rate limit", "error", err)
	}
	if len(identities) == 1 {
		response, err := app.createSession(r.Context(), identities[0])
		if err != nil {
			app.log.Error("create session", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create session"})
			return
		}
		writeJSON(w, http.StatusOK, response)
		return
	}

	selectionToken, tokenHash, err := sessionToken()
	if err != nil {
		app.log.Error("create company selection token", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not prepare company selection"})
		return
	}
	if err := app.redis.Set(r.Context(), companySelectionKey(tokenHash), userID, companySelectionLifetime).Err(); err != nil {
		app.log.Error("store company selection", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authentication is temporarily unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, loginResponse{
		RequiresCompanySelection: true,
		Companies:                companies,
		SelectionToken:           selectionToken,
	})
}

func (app *application) selectCompany(w http.ResponseWriter, r *http.Request) {
	var input selectCompanyRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid company selection payload"})
		return
	}
	input.SelectionToken = strings.TrimSpace(input.SelectionToken)
	input.TenantSlug = strings.ToLower(strings.TrimSpace(input.TenantSlug))
	if input.SelectionToken == "" || !tenantSlugPattern.MatchString(input.TenantSlug) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "company selection is required"})
		return
	}
	tokenHash := sha256.Sum256([]byte(input.SelectionToken))
	userID, err := app.redis.Get(r.Context(), companySelectionKey(tokenHash[:])).Result()
	if errors.Is(err, redis.Nil) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "company selection has expired; sign in again"})
		return
	}
	if err != nil {
		app.log.Error("load company selection", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "authentication is temporarily unavailable"})
		return
	}

	var result identity
	err = app.db.QueryRow(r.Context(), `
		SELECT u.id::text, m.id::text, t.id::text, t.slug, m.role::text, u.display_name, u.email
		FROM users u
		JOIN memberships m ON m.user_id = u.id AND m.is_active
		JOIN tenants t ON t.id = m.tenant_id
		WHERE u.id = $1 AND t.slug = $2
	`, userID, input.TenantSlug).Scan(&result.UserID, &result.MembershipID, &result.TenantID, &result.TenantSlug, &result.Role, &result.DisplayName, &result.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "company access is denied"})
		return
	}
	if err != nil {
		app.log.Error("load selected company", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not select company"})
		return
	}
	response, err := app.createSession(r.Context(), result)
	if err != nil {
		app.log.Error("create selected company session", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create session"})
		return
	}
	if err := app.redis.Del(r.Context(), companySelectionKey(tokenHash[:])).Err(); err != nil {
		app.log.Warn("clear company selection", "error", err)
	}
	writeJSON(w, http.StatusOK, response)
}

func (app *application) me(w http.ResponseWriter, r *http.Request) {
	identity, _, err := app.authenticate(r)
	if err != nil {
		writeAuthenticationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"tenantSlug": identity.TenantSlug, "membershipId": identity.MembershipID, "role": identity.Role, "displayName": identity.DisplayName, "email": identity.Email})
}

func (app *application) logout(w http.ResponseWriter, r *http.Request) {
	identity, token, err := app.authenticate(r)
	if err != nil {
		writeAuthenticationError(w, err)
		return
	}
	hash := sha256.Sum256([]byte(token))
	if _, err := app.db.Exec(r.Context(), `UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND user_id = $2`, hash[:], identity.UserID); err != nil {
		app.log.Error("revoke session", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not close session"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type userPreferencesResponse struct {
	Configured     bool   `json:"configured"`
	Theme          string `json:"theme"`
	Accent         string `json:"accent"`
	Density        string `json:"density"`
	Radius         string `json:"radius"`
	Scale          string `json:"scale"`
	SidebarVariant string `json:"sidebarVariant"`
	SidebarMode    string `json:"sidebarMode"`
}

func defaultUserPreferences() userPreferencesResponse {
	return userPreferencesResponse{
		Theme:          "dark",
		Accent:         "company",
		Density:        "comfortable",
		Radius:         "lg",
		Scale:          "md",
		SidebarVariant: "default",
		SidebarMode:    "default",
	}
}

func validUserPreferences(preferences userPreferencesResponse) bool {
	if preferences.Theme != "light" && preferences.Theme != "dark" && preferences.Theme != "system" {
		return false
	}
	if preferences.Accent != "company" && preferences.Accent != "gold" && preferences.Accent != "ocean" && preferences.Accent != "emerald" && preferences.Accent != "violet" {
		return false
	}
	if preferences.Density != "comfortable" && preferences.Density != "compact" {
		return false
	}
	if preferences.Radius != "sm" && preferences.Radius != "md" && preferences.Radius != "lg" {
		return false
	}
	if preferences.Scale != "sm" && preferences.Scale != "md" && preferences.Scale != "lg" {
		return false
	}
	if preferences.SidebarVariant != "default" && preferences.SidebarVariant != "inset" && preferences.SidebarVariant != "floating" {
		return false
	}
	return preferences.SidebarMode == "default" || preferences.SidebarMode == "icon" || preferences.SidebarMode == "full"
}

func (app *application) getUserPreferences(w http.ResponseWriter, r *http.Request) {
	actor, ok := identityFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication is required"})
		return
	}
	response := defaultUserPreferences()
	err := app.db.QueryRow(r.Context(), `
		SELECT theme, accent, density, radius, scale, sidebar_variant, sidebar_mode
		FROM user_preferences
		WHERE membership_id = $1
	`, actor.MembershipID).Scan(
		&response.Theme,
		&response.Accent,
		&response.Density,
		&response.Radius,
		&response.Scale,
		&response.SidebarVariant,
		&response.SidebarMode,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, response)
		return
	}
	if err != nil {
		app.log.Error("load user preferences", "error", err, "membership", actor.MembershipID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load user preferences"})
		return
	}
	response.Configured = true
	writeJSON(w, http.StatusOK, response)
}

func (app *application) updateUserPreferences(w http.ResponseWriter, r *http.Request) {
	actor, ok := identityFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication is required"})
		return
	}
	var input userPreferencesResponse
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user preferences"})
		return
	}
	input.Theme = strings.TrimSpace(input.Theme)
	input.Accent = strings.TrimSpace(input.Accent)
	input.Density = strings.TrimSpace(input.Density)
	input.Radius = strings.TrimSpace(input.Radius)
	input.Scale = strings.TrimSpace(input.Scale)
	input.SidebarVariant = strings.TrimSpace(input.SidebarVariant)
	input.SidebarMode = strings.TrimSpace(input.SidebarMode)
	if !validUserPreferences(input) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid user preferences"})
		return
	}
	input.Configured = true
	if _, err := app.db.Exec(r.Context(), `
		INSERT INTO user_preferences (membership_id, theme, accent, density, radius, scale, sidebar_variant, sidebar_mode)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (membership_id) DO UPDATE SET
			theme = EXCLUDED.theme,
			accent = EXCLUDED.accent,
			density = EXCLUDED.density,
			radius = EXCLUDED.radius,
			scale = EXCLUDED.scale,
			sidebar_variant = EXCLUDED.sidebar_variant,
			sidebar_mode = EXCLUDED.sidebar_mode,
			updated_at = now()
	`, actor.MembershipID, input.Theme, input.Accent, input.Density, input.Radius, input.Scale, input.SidebarVariant, input.SidebarMode); err != nil {
		app.log.Error("update user preferences", "error", err, "membership", actor.MembershipID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not save user preferences"})
		return
	}
	writeJSON(w, http.StatusOK, input)
}

type teamMemberResponse struct {
	MembershipID string     `json:"membershipId"`
	UserID       string     `json:"userId"`
	DisplayName  string     `json:"displayName"`
	Email        string     `json:"email"`
	Role         string     `json:"role"`
	IsActive     bool       `json:"isActive"`
	IsSystem     bool       `json:"isSystem"`
	CreatedAt    time.Time  `json:"createdAt"`
	LastSeenAt   *time.Time `json:"lastSeenAt,omitempty"`
	DriverID     *string    `json:"driverId,omitempty"`
	ActionCount  int64      `json:"actionCount"`
	LastActionAt *time.Time `json:"lastActionAt,omitempty"`
}

type createTeamMemberRequest struct {
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	Password    string `json:"password"`
	Role        string `json:"role"`
	DriverPhone string `json:"driverPhone"`
}

type updateTeamMemberRequest struct {
	Role     *string `json:"role"`
	IsActive *bool   `json:"isActive"`
	Password *string `json:"password"`
}

var teamRoles = map[string]struct{}{"developer": {}, "owner": {}, "admin": {}, "dispatcher": {}, "driver": {}}

func identityFromContext(ctx context.Context) (identity, bool) {
	value, ok := ctx.Value(identityContextKey{}).(identity)
	return value, ok
}

func validateTeamRole(role string) bool {
	_, ok := teamRoles[role]
	return ok
}

func canManageTeamRole(actorRole, memberRole, nextRole string) bool {
	if actorRole == "developer" {
		return validateTeamRole(memberRole) && validateTeamRole(nextRole)
	}
	if memberRole == "developer" || nextRole == "developer" {
		return false
	}
	if actorRole == "owner" {
		return validateTeamRole(memberRole) && validateTeamRole(nextRole)
	}
	return actorRole == "admin" && (memberRole == "dispatcher" || memberRole == "driver") && (nextRole == "dispatcher" || nextRole == "driver")
}

func canDeleteTeamMember(actorRole, memberRole string, memberActive bool) bool {
	if actorRole == "developer" {
		return validateTeamRole(memberRole)
	}
	if memberRole == "developer" {
		return false
	}
	if actorRole == "owner" {
		return validateTeamRole(memberRole)
	}
	if actorRole != "admin" {
		return false
	}
	return !memberActive || memberRole == "dispatcher" || memberRole == "driver"
}

func (app *application) activeDriverID(ctx context.Context, tenantID, membershipID string) (string, error) {
	var driverID string
	err := app.db.QueryRow(ctx, `
		SELECT id::text FROM drivers
		WHERE tenant_id = $1 AND membership_id = $2 AND is_active
	`, tenantID, membershipID).Scan(&driverID)
	return driverID, err
}

func (app *application) listTeam(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	rows, err := app.db.Query(r.Context(), `
		SELECT m.id::text, u.id::text, u.display_name, u.email, m.role::text, m.is_active, u.is_system, m.created_at,
			(SELECT max(s.last_seen_at) FROM user_sessions s WHERE s.membership_id = m.id AND s.revoked_at IS NULL AND s.expires_at > now())
			, (SELECT d.id::text FROM drivers d WHERE d.membership_id = m.id),
			(SELECT count(*) FROM activity_events event WHERE event.actor_membership_id = m.id),
			(SELECT max(event.created_at) FROM activity_events event WHERE event.actor_membership_id = m.id)
		FROM memberships m
		JOIN users u ON u.id = m.user_id
		WHERE m.tenant_id = $1
		ORDER BY m.is_active DESC, u.display_name, u.email
	`, tenant.ID)
	if err != nil {
		app.log.Error("list team", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load team"})
		return
	}
	defer rows.Close()
	items := make([]teamMemberResponse, 0)
	for rows.Next() {
		var item teamMemberResponse
		if err := rows.Scan(&item.MembershipID, &item.UserID, &item.DisplayName, &item.Email, &item.Role, &item.IsActive, &item.IsSystem, &item.CreatedAt, &item.LastSeenAt, &item.DriverID, &item.ActionCount, &item.LastActionAt); err != nil {
			app.log.Error("scan team", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load team"})
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate team", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load team"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (app *application) createTeamMember(w http.ResponseWriter, r *http.Request) {
	actor, ok := identityFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication is required"})
		return
	}
	var input createTeamMemberRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid team member payload"})
		return
	}
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	input.Role = strings.TrimSpace(input.Role)
	input.DriverPhone = normalizePhone(input.DriverPhone)
	parsed, err := mail.ParseAddress(input.Email)
	if input.DisplayName == "" || len([]rune(input.DisplayName)) > 120 || err != nil || parsed.Address != input.Email || !validateTeamRole(input.Role) || !canManageTeamRole(actor.Role, input.Role, input.Role) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "check name, email and role"})
		return
	}
	if input.Role == "driver" && input.DriverPhone == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a driver needs a valid international phone number"})
		return
	}
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.log.Error("start team transaction", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create team member"})
		return
	}
	defer tx.Rollback(r.Context())
	var userID string
	err = tx.QueryRow(r.Context(), `SELECT id::text FROM users WHERE email = $1`, input.Email).Scan(&userID)
	isNewUser := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !isNewUser {
		app.log.Error("find team user", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create team member"})
		return
	}
	if isNewUser {
		if len([]rune(input.Password)) < 12 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password must contain at least 12 characters for a new account"})
			return
		}
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
		if err != nil {
			app.log.Error("hash team password", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create team member"})
			return
		}
		if err := tx.QueryRow(r.Context(), `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id::text`, input.Email, input.DisplayName).Scan(&userID); err != nil {
			app.log.Error("create team user", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create team member"})
			return
		}
		if _, err := tx.Exec(r.Context(), `INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, userID, string(passwordHash)); err != nil {
			app.log.Error("create team credentials", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create team member"})
			return
		}
	}
	var item teamMemberResponse
	err = tx.QueryRow(r.Context(), `
		INSERT INTO memberships (tenant_id, user_id, role, is_active)
		VALUES ($1, $2, $3::membership_role, true)
		RETURNING id::text, user_id::text, (SELECT display_name FROM users WHERE id = user_id), (SELECT email FROM users WHERE id = user_id), role::text, is_active, created_at
	`, tenant.ID, userID, input.Role).Scan(&item.MembershipID, &item.UserID, &item.DisplayName, &item.Email, &item.Role, &item.IsActive, &item.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "this user is already in the company"})
			return
		}
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "this user is already in the company"})
			return
		}
		app.log.Error("create membership", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create team member"})
		return
	}
	if input.Role == "driver" {
		var driverID string
		if err := tx.QueryRow(r.Context(), `
			INSERT INTO drivers (tenant_id, membership_id, full_name, phone_e164, is_active)
			VALUES ($1, $2, $3, $4, true)
			RETURNING id::text
		`, tenant.ID, item.MembershipID, input.DisplayName, input.DriverPhone).Scan(&driverID); err != nil {
			var pgError *pgconn.PgError
			if errors.As(err, &pgError) && pgError.Code == "23505" {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "a driver with this phone already exists"})
				return
			}
			app.log.Error("create driver profile", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create driver profile"})
			return
		}
		item.DriverID = &driverID
	}
	if err := tx.Commit(r.Context()); err != nil {
		app.log.Error("commit team member", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create team member"})
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (app *application) updateTeamMember(w http.ResponseWriter, r *http.Request) {
	actor, ok := identityFromContext(r.Context())
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication is required"})
		return
	}
	var input updateTeamMemberRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || (input.Role == nil && input.IsActive == nil && input.Password == nil) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "provide a role, active status or password"})
		return
	}
	if input.Role != nil {
		role := strings.TrimSpace(*input.Role)
		input.Role = &role
		if !validateTeamRole(role) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid role"})
			return
		}
	}
	if input.Password != nil && (len([]rune(*input.Password)) < 12 || len([]rune(*input.Password)) > 128) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password must contain from 12 to 128 characters"})
		return
	}
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	membershipID := strings.TrimSpace(r.PathValue("membershipID"))
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update team member"})
		return
	}
	defer tx.Rollback(r.Context())
	var current teamMemberResponse
	err = tx.QueryRow(r.Context(), `
		SELECT m.id::text, u.id::text, u.display_name, u.email, m.role::text, m.is_active, u.is_system, m.created_at,
			(SELECT d.id::text FROM drivers d WHERE d.membership_id = m.id)
		FROM memberships m JOIN users u ON u.id = m.user_id
		WHERE m.id = $1 AND m.tenant_id = $2 FOR UPDATE
	`, membershipID, tenant.ID).Scan(&current.MembershipID, &current.UserID, &current.DisplayName, &current.Email, &current.Role, &current.IsActive, &current.IsSystem, &current.CreatedAt, &current.DriverID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "team member not found"})
		return
	}
	if err != nil {
		app.log.Error("load team member", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update team member"})
		return
	}
	nextRole := current.Role
	if input.Role != nil {
		nextRole = *input.Role
	}
	nextActive := current.IsActive
	if input.IsActive != nil {
		nextActive = *input.IsActive
	}
	if current.IsSystem || !canManageTeamRole(actor.Role, current.Role, nextRole) || (current.MembershipID == actor.MembershipID && !nextActive) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "you cannot make this access change"})
		return
	}
	if input.Password != nil && actor.Role != "owner" && actor.Role != "developer" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "only an owner can set a team member password"})
		return
	}
	if nextRole == "driver" && current.DriverID == nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "create a new driver account with a phone number instead of changing this role"})
		return
	}
	if current.Role == "owner" && current.IsActive && (nextRole != "owner" || !nextActive) {
		var owners int
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM memberships WHERE tenant_id = $1 AND role = 'owner' AND is_active`, tenant.ID).Scan(&owners); err != nil {
			app.log.Error("count owners", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update team member"})
			return
		}
		if owners <= 1 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "the company must keep at least one active owner"})
			return
		}
	}
	var item teamMemberResponse
	err = tx.QueryRow(r.Context(), `
		UPDATE memberships SET role = $3::membership_role, is_active = $4
		WHERE id = $1 AND tenant_id = $2
		RETURNING id::text, user_id::text, (SELECT display_name FROM users WHERE id = user_id), (SELECT email FROM users WHERE id = user_id), role::text, is_active, (SELECT is_system FROM users WHERE id = user_id), created_at,
			(SELECT d.id::text FROM drivers d WHERE d.membership_id = memberships.id)
	`, membershipID, tenant.ID, nextRole, nextActive).Scan(&item.MembershipID, &item.UserID, &item.DisplayName, &item.Email, &item.Role, &item.IsActive, &item.IsSystem, &item.CreatedAt, &item.DriverID)
	if err != nil {
		app.log.Error("update team membership", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update team member"})
		return
	}
	if input.Password != nil {
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(*input.Password), bcrypt.DefaultCost)
		if err != nil {
			app.log.Error("hash team password", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update team member"})
			return
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)
			ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()
		`, current.UserID, string(passwordHash)); err != nil {
			app.log.Error("update team password", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update team member"})
			return
		}
	}
	if !nextActive || input.Password != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE user_sessions SET revoked_at = now() WHERE membership_id = $1 AND revoked_at IS NULL`, membershipID); err != nil {
			app.log.Error("revoke member sessions", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update team member"})
			return
		}
	}
	if current.DriverID != nil {
		if _, err := tx.Exec(r.Context(), `UPDATE drivers SET is_active = $2, updated_at = now() WHERE id = $1`, *current.DriverID, nextActive); err != nil {
			app.log.Error("sync driver profile", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update team member"})
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		app.log.Error("commit team change", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update team member"})
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (app *application) deleteTeamMember(w http.ResponseWriter, r *http.Request) {
	actor, authenticated := identityFromContext(r.Context())
	if !authenticated {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication is required"})
		return
	}
	tenant, ok := app.loadTenant(w, r, strings.ToLower(strings.TrimSpace(r.PathValue("slug"))))
	if !ok {
		return
	}
	membershipID := strings.TrimSpace(r.PathValue("membershipID"))
	if membershipID == actor.MembershipID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "you cannot delete your own access"})
		return
	}

	tx, err := app.db.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not delete team member"})
		return
	}
	defer tx.Rollback(r.Context())

	var memberRole string
	var memberActive, memberSystem bool
	err = tx.QueryRow(r.Context(), `
		SELECT membership.role::text, membership.is_active, app_user.is_system
		FROM memberships membership
		JOIN users app_user ON app_user.id = membership.user_id
		WHERE membership.id = $1 AND membership.tenant_id = $2
		FOR UPDATE
	`, membershipID, tenant.ID).Scan(&memberRole, &memberActive, &memberSystem)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "team member not found"})
		return
	}
	if err != nil {
		app.log.Error("load team member for deletion", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not delete team member"})
		return
	}
	if memberSystem || !canDeleteTeamMember(actor.Role, memberRole, memberActive) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "you cannot delete this team member"})
		return
	}
	if memberRole == "owner" && memberActive {
		var activeOwners int
		if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM memberships WHERE tenant_id = $1 AND role = 'owner' AND is_active`, tenant.ID).Scan(&activeOwners); err != nil {
			app.log.Error("count owners before deletion", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not delete team member"})
			return
		}
		if activeOwners <= 1 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "the company must keep at least one active owner"})
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `
		UPDATE drivers SET is_active = false, updated_at = now()
		WHERE tenant_id = $1 AND membership_id = $2
	`, tenant.ID, membershipID); err != nil {
		app.log.Error("deactivate deleted team driver", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not delete team member"})
		return
	}
	command, err := tx.Exec(r.Context(), `DELETE FROM memberships WHERE id = $1 AND tenant_id = $2`, membershipID, tenant.ID)
	if err != nil {
		app.log.Error("delete team membership", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not delete team member"})
		return
	}
	if command.RowsAffected() != 1 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "team member not found"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		app.log.Error("commit team member deletion", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not delete team member"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": membershipID})
}

type tenant struct {
	ID                 string
	Name               string
	Timezone           string
	BaseCurrency       string
	SubscriptionStatus string
}

type tripResponse struct {
	ID          string         `json:"id"`
	Kind        string         `json:"kind"`
	Status      string         `json:"status"`
	Origin      string         `json:"origin"`
	Destination string         `json:"destination"`
	StartsAt    time.Time      `json:"startsAt"`
	EndsAt      time.Time      `json:"endsAt"`
	Capacity    int16          `json:"capacity"`
	PriceMinor  int64          `json:"priceMinor"`
	PricingMode string         `json:"pricingMode"`
	Currency    string         `json:"currency"`
	RouteID     *string        `json:"routeId,omitempty"`
	VehicleID   *string        `json:"vehicleId,omitempty"`
	DriverID    *string        `json:"driverId,omitempty"`
	Notes       string         `json:"notes,omitempty"`
	Vehicle     string         `json:"vehicle"`
	Driver      string         `json:"driver"`
	CustomData  map[string]any `json:"customData,omitempty"`
}

type dashboardTripResponse struct {
	ID          string    `json:"id"`
	Origin      string    `json:"origin"`
	Destination string    `json:"destination"`
	StartsAt    time.Time `json:"startsAt"`
	Status      string    `json:"status"`
	Vehicle     string    `json:"vehicle"`
	Driver      string    `json:"driver"`
	Capacity    int16     `json:"capacity"`
	BookedSeats int64     `json:"bookedSeats"`
}

type dashboardVehicleResponse struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Route            string `json:"route"`
	TripStatus       string `json:"tripStatus,omitempty"`
	Capacity         int16  `json:"capacity"`
	BookedSeats      int64  `json:"bookedSeats"`
	OccupancyPercent int64  `json:"occupancyPercent"`
}

type dashboardResponse struct {
	Date                 string                     `json:"date"`
	Timezone             string                     `json:"timezone"`
	Currency             string                     `json:"currency"`
	TripCount            int64                      `json:"tripCount"`
	PassengerCount       int64                      `json:"passengerCount"`
	VehiclesOnLine       int64                      `json:"vehiclesOnLine"`
	ActiveVehicleCount   int64                      `json:"activeVehicleCount"`
	ExpectedRevenueMinor int64                      `json:"expectedRevenueMinor"`
	Trips                []dashboardTripResponse    `json:"trips"`
	Vehicles             []dashboardVehicleResponse `json:"vehicles"`
}

func (app *application) dashboardSummary(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	location, err := time.LoadLocation(tenant.Timezone)
	if err != nil {
		app.log.Error("load tenant timezone", "error", err, "tenant", slug, "timezone", tenant.Timezone)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load dashboard"})
		return
	}
	now := time.Now().In(location)
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
	dayEnd := dayStart.AddDate(0, 0, 1)
	response := dashboardResponse{
		Date:     dayStart.Format("2006-01-02"),
		Timezone: tenant.Timezone,
		Currency: tenant.BaseCurrency,
		Trips:    make([]dashboardTripResponse, 0),
		Vehicles: make([]dashboardVehicleResponse, 0),
	}

	err = app.db.QueryRow(r.Context(), `
		WITH today_trips AS (
			SELECT id, status FROM trips
			WHERE tenant_id = $1 AND starts_at >= $2 AND starts_at < $3 AND status <> 'cancelled'
		)
		SELECT
			COUNT(DISTINCT tt.id)::bigint,
			COALESCE(SUM(b.seats) FILTER (WHERE b.status IN ('pending', 'cash_on_boarding', 'confirmed', 'completed') OR (b.status = 'awaiting_payment' AND b.payment_hold_expires_at > now())), 0)::bigint,
			COALESCE(SUM(b.price_minor) FILTER (WHERE b.status IN ('pending', 'cash_on_boarding', 'confirmed', 'completed') OR (b.status = 'awaiting_payment' AND b.payment_hold_expires_at > now())), 0)::bigint,
			(SELECT COUNT(DISTINCT t.vehicle_id)::bigint FROM trips t WHERE t.tenant_id = $1 AND t.starts_at >= $2 AND t.starts_at < $3 AND t.status IN ('new', 'assigned', 'in_progress') AND t.vehicle_id IS NOT NULL),
			(SELECT COUNT(*)::bigint FROM vehicles v WHERE v.tenant_id = $1 AND v.is_active)
		FROM today_trips tt
		LEFT JOIN bookings b ON b.trip_id = tt.id AND b.tenant_id = $1
	`, tenant.ID, dayStart, dayEnd).Scan(
		&response.TripCount,
		&response.PassengerCount,
		&response.ExpectedRevenueMinor,
		&response.VehiclesOnLine,
		&response.ActiveVehicleCount,
	)
	if err != nil {
		app.log.Error("load dashboard totals", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load dashboard"})
		return
	}

	trips, err := app.db.Query(r.Context(), `
		SELECT t.id::text, t.origin_name, t.destination_name, t.starts_at, t.status::text,
			COALESCE(v.name, ''), COALESCE(d.full_name, ''), t.capacity,
			COALESCE(SUM(b.seats) FILTER (WHERE b.status IN ('pending', 'cash_on_boarding', 'confirmed', 'completed') OR (b.status = 'awaiting_payment' AND b.payment_hold_expires_at > now())), 0)::bigint
		FROM trips t
		LEFT JOIN vehicles v ON v.id = t.vehicle_id
		LEFT JOIN drivers d ON d.id = t.driver_id
		LEFT JOIN bookings b ON b.trip_id = t.id AND b.tenant_id = t.tenant_id
		WHERE t.tenant_id = $1 AND t.starts_at >= $2 AND t.starts_at < $3 AND t.status <> 'cancelled'
		GROUP BY t.id, v.name, d.full_name
		ORDER BY t.starts_at
		LIMIT 6
	`, tenant.ID, dayStart, dayEnd)
	if err != nil {
		app.log.Error("load dashboard trips", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load dashboard"})
		return
	}
	defer trips.Close()
	for trips.Next() {
		var trip dashboardTripResponse
		if err := trips.Scan(&trip.ID, &trip.Origin, &trip.Destination, &trip.StartsAt, &trip.Status, &trip.Vehicle, &trip.Driver, &trip.Capacity, &trip.BookedSeats); err != nil {
			app.log.Error("scan dashboard trip", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load dashboard"})
			return
		}
		response.Trips = append(response.Trips, trip)
	}
	if err := trips.Err(); err != nil {
		app.log.Error("iterate dashboard trips", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load dashboard"})
		return
	}

	vehicles, err := app.db.Query(r.Context(), `
		SELECT v.id::text, v.name, COALESCE(t.origin_name || ' → ' || t.destination_name, ''),
			COALESCE(t.status::text, ''), v.capacity,
			COALESCE(t.booked_seats, 0)::bigint,
			CASE WHEN v.capacity > 0 THEN LEAST(100, (COALESCE(t.booked_seats, 0) * 100 / v.capacity)) ELSE 0 END::bigint
		FROM vehicles v
		LEFT JOIN LATERAL (
			SELECT trip.origin_name, trip.destination_name, trip.status,
				COALESCE(SUM(b.seats) FILTER (WHERE b.status IN ('pending', 'cash_on_boarding', 'confirmed', 'completed') OR (b.status = 'awaiting_payment' AND b.payment_hold_expires_at > now())), 0)::bigint AS booked_seats
			FROM trips trip
			LEFT JOIN bookings b ON b.trip_id = trip.id AND b.tenant_id = trip.tenant_id
			WHERE trip.vehicle_id = v.id AND trip.tenant_id = v.tenant_id
				AND trip.starts_at >= $2 AND trip.starts_at < $3 AND trip.status <> 'cancelled'
			GROUP BY trip.id
			ORDER BY trip.starts_at
			LIMIT 1
		) t ON true
		WHERE v.tenant_id = $1 AND v.is_active
		ORDER BY (t.status IS NULL), t.status = 'in_progress' DESC, v.name
		LIMIT 5
	`, tenant.ID, dayStart, dayEnd)
	if err != nil {
		app.log.Error("load dashboard vehicles", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load dashboard"})
		return
	}
	defer vehicles.Close()
	for vehicles.Next() {
		var vehicle dashboardVehicleResponse
		if err := vehicles.Scan(&vehicle.ID, &vehicle.Name, &vehicle.Route, &vehicle.TripStatus, &vehicle.Capacity, &vehicle.BookedSeats, &vehicle.OccupancyPercent); err != nil {
			app.log.Error("scan dashboard vehicle", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load dashboard"})
			return
		}
		response.Vehicles = append(response.Vehicles, vehicle)
	}
	if err := vehicles.Err(); err != nil {
		app.log.Error("iterate dashboard vehicles", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load dashboard"})
		return
	}

	writeJSON(w, http.StatusOK, response)
}

func (app *application) listTrips(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	if slug == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant slug is required"})
		return
	}

	day := time.Now().UTC().Truncate(24 * time.Hour)
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	location, err := time.LoadLocation(tenant.Timezone)
	if err != nil {
		app.log.Error("load tenant timezone", "error", err, "tenant", slug, "timezone", tenant.Timezone)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trips"})
		return
	}

	if rawDay := r.URL.Query().Get("date"); rawDay != "" {
		parsedDay, err := time.ParseInLocation("2006-01-02", rawDay, location)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "date must use YYYY-MM-DD"})
			return
		}
		day = parsedDay
	} else {
		now := time.Now().In(location)
		day = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
	}

	rows, err := app.db.Query(r.Context(), `
		SELECT
			t.id::text, t.kind::text, t.status::text, t.origin_name, t.destination_name,
			t.starts_at, t.ends_at, t.capacity, t.price_minor, t.pricing_mode, t.currency, t.custom_data, t.route_id::text, t.vehicle_id::text, t.driver_id::text, COALESCE(t.notes, ''),
			COALESCE(v.name, ''), COALESCE(d.full_name, '')
		FROM trips t
		JOIN tenants tenant ON tenant.id = t.tenant_id
		LEFT JOIN vehicles v ON v.id = t.vehicle_id
		LEFT JOIN drivers d ON d.id = t.driver_id
		WHERE tenant.slug = $1
		  AND t.starts_at >= $2
		  AND t.starts_at < $3
		ORDER BY t.starts_at ASC
	`, slug, day, time.Date(day.Year(), day.Month(), day.Day()+1, 0, 0, 0, 0, location))
	if err != nil {
		app.log.Error("list trips", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trips"})
		return
	}
	defer rows.Close()

	trips := make([]tripResponse, 0)
	for rows.Next() {
		var trip tripResponse
		var customData []byte
		if err := rows.Scan(
			&trip.ID, &trip.Kind, &trip.Status, &trip.Origin, &trip.Destination,
			&trip.StartsAt, &trip.EndsAt, &trip.Capacity, &trip.PriceMinor, &trip.PricingMode, &trip.Currency,
			&customData, &trip.RouteID, &trip.VehicleID, &trip.DriverID, &trip.Notes, &trip.Vehicle, &trip.Driver,
		); err != nil {
			app.log.Error("scan trip", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trips"})
			return
		}
		trip.CustomData, err = decodeCustomData(customData)
		if err != nil {
			app.log.Error("decode trip custom data", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trips"})
			return
		}
		trips = append(trips, trip)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate trips", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trips"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": trips, "timezone": tenant.Timezone})
}

type tripResourceResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Capacity int16  `json:"capacity,omitempty"`
}

type routeResourceResponse struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Origin             string `json:"origin"`
	Destination        string `json:"destination"`
	Currency           string `json:"currency"`
	DefaultPriceMinor  int64  `json:"defaultPriceMinor"`
	DefaultPricingMode string `json:"defaultPricingMode"`
}

type routeResponse struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Origin             string `json:"origin"`
	Destination        string `json:"destination"`
	Currency           string `json:"currency"`
	DefaultPriceMinor  int64  `json:"defaultPriceMinor"`
	DefaultPricingMode string `json:"defaultPricingMode"`
	IsActive           bool   `json:"isActive"`
}

func (app *application) listRoutes(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	rows, err := app.db.Query(r.Context(), `
		SELECT id::text, name, origin_name, destination_name, currency, default_price_minor, default_pricing_mode, is_active
		FROM routes WHERE tenant_id = $1 ORDER BY is_active DESC, name
	`, tenant.ID)
	if err != nil {
		app.log.Error("list routes", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load routes"})
		return
	}
	defer rows.Close()
	items := make([]routeResponse, 0)
	for rows.Next() {
		var item routeResponse
		if err := rows.Scan(&item.ID, &item.Name, &item.Origin, &item.Destination, &item.Currency, &item.DefaultPriceMinor, &item.DefaultPricingMode, &item.IsActive); err != nil {
			app.log.Error("scan route", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load routes"})
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate routes", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load routes"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "currency": tenant.BaseCurrency})
}

type routeInput struct {
	Name               string `json:"name"`
	Origin             string `json:"origin"`
	Destination        string `json:"destination"`
	Currency           string `json:"currency"`
	DefaultPriceMinor  int64  `json:"defaultPriceMinor"`
	DefaultPricingMode string `json:"defaultPricingMode"`
	IsActive           bool   `json:"isActive"`
}

func validateRouteInput(input *routeInput, fallbackCurrency string) bool {
	input.Name = strings.TrimSpace(input.Name)
	input.Origin = strings.TrimSpace(input.Origin)
	input.Destination = strings.TrimSpace(input.Destination)
	input.Currency = strings.ToUpper(strings.TrimSpace(input.Currency))
	input.DefaultPricingMode = normalizePricingMode(input.DefaultPricingMode)
	if input.Currency == "" {
		input.Currency = fallbackCurrency
	}
	return input.Name != "" && input.Origin != "" && input.Destination != "" && len([]rune(input.Name)) <= 160 && len([]rune(input.Origin)) <= 120 && len([]rune(input.Destination)) <= 120 && validBookingCurrency(input.Currency) && input.DefaultPriceMinor >= 0 && input.DefaultPriceMinor <= 10_000_000_000 && isPricingMode(input.DefaultPricingMode)
}

func normalizePricingMode(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "per_passenger"
	}
	return value
}

func isPricingMode(value string) bool {
	return value == "per_passenger" || value == "per_booking"
}

func priceForBooking(unitPrice int64, seats int16, pricingMode string) (int64, bool) {
	if pricingMode == "per_booking" {
		return unitPrice, true
	}
	if unitPrice > (1<<63-1)/int64(seats) {
		return 0, false
	}
	return unitPrice * int64(seats), true
}

func (app *application) createRoute(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input routeInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || !validateRouteInput(&input, tenant.BaseCurrency) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "route name, cities and a UAH or EUR currency are required"})
		return
	}
	var item routeResponse
	err := app.db.QueryRow(r.Context(), `
		INSERT INTO routes (tenant_id, name, origin_name, destination_name, currency, default_price_minor, default_pricing_mode, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id::text, name, origin_name, destination_name, currency, default_price_minor, default_pricing_mode, is_active
	`, tenant.ID, input.Name, input.Origin, input.Destination, input.Currency, input.DefaultPriceMinor, input.DefaultPricingMode, input.IsActive).Scan(&item.ID, &item.Name, &item.Origin, &item.Destination, &item.Currency, &item.DefaultPriceMinor, &item.DefaultPricingMode, &item.IsActive)
	if err != nil {
		app.log.Error("create route", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create route"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"item": item})
}

func (app *application) updateRoute(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	routeID := strings.TrimSpace(r.PathValue("routeID"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input routeInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || !validateRouteInput(&input, tenant.BaseCurrency) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "route name, cities and 3-letter currency are required"})
		return
	}
	var item routeResponse
	err := app.db.QueryRow(r.Context(), `
		UPDATE routes SET name = $1, origin_name = $2, destination_name = $3, currency = $4, default_price_minor = $5, default_pricing_mode = $6, is_active = $7, updated_at = now()
		WHERE id = $8 AND tenant_id = $9
		RETURNING id::text, name, origin_name, destination_name, currency, default_price_minor, default_pricing_mode, is_active
	`, input.Name, input.Origin, input.Destination, input.Currency, input.DefaultPriceMinor, input.DefaultPricingMode, input.IsActive, routeID, tenant.ID).Scan(&item.ID, &item.Name, &item.Origin, &item.Destination, &item.Currency, &item.DefaultPriceMinor, &item.DefaultPricingMode, &item.IsActive)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "route not found"})
		return
	}
	if err != nil {
		app.log.Error("update route", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update route"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}

type availabilityBlockResponse struct {
	ID        string    `json:"id"`
	RouteID   *string   `json:"routeId,omitempty"`
	RouteName string    `json:"routeName,omitempty"`
	StartsAt  time.Time `json:"startsAt"`
	EndsAt    time.Time `json:"endsAt"`
	Reason    string    `json:"reason,omitempty"`
}

type availabilityBlockInput struct {
	RouteID  string `json:"routeId"`
	StartsAt string `json:"startsAt"`
	EndsAt   string `json:"endsAt"`
	Reason   string `json:"reason"`
}

func (app *application) listAvailabilityBlocks(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	location, err := time.LoadLocation(tenant.Timezone)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load availability"})
		return
	}
	from := time.Now().In(location).Truncate(24 * time.Hour)
	to := from.AddDate(0, 2, 0)
	if value := r.URL.Query().Get("from"); value != "" {
		parsed, err := time.ParseInLocation("2006-01-02", value, location)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "from must use YYYY-MM-DD"})
			return
		}
		from = parsed
	}
	if value := r.URL.Query().Get("to"); value != "" {
		parsed, err := time.ParseInLocation("2006-01-02", value, location)
		if err != nil || !parsed.After(from) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to must use YYYY-MM-DD and be after from"})
			return
		}
		to = parsed.AddDate(0, 0, 1)
	}
	rows, err := app.db.Query(r.Context(), `
		SELECT b.id::text, b.route_id::text, COALESCE(route.name, ''), b.starts_at, b.ends_at, COALESCE(b.reason, '')
		FROM availability_blocks b
		LEFT JOIN routes route ON route.id = b.route_id
		WHERE b.tenant_id = $1 AND b.starts_at < $3 AND b.ends_at > $2
		ORDER BY b.starts_at
	`, tenant.ID, from, to)
	if err != nil {
		app.log.Error("list availability blocks", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load availability"})
		return
	}
	defer rows.Close()
	items := make([]availabilityBlockResponse, 0)
	for rows.Next() {
		var item availabilityBlockResponse
		if err := rows.Scan(&item.ID, &item.RouteID, &item.RouteName, &item.StartsAt, &item.EndsAt, &item.Reason); err != nil {
			app.log.Error("scan availability block", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load availability"})
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate availability blocks", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load availability"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "timezone": tenant.Timezone})
}

func (app *application) createAvailabilityBlock(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input availabilityBlockInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid availability block"})
		return
	}
	input.RouteID = strings.TrimSpace(input.RouteID)
	input.Reason = strings.TrimSpace(input.Reason)
	if len([]rune(input.Reason)) > 500 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "reason is too long"})
		return
	}
	location, err := time.LoadLocation(tenant.Timezone)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create availability block"})
		return
	}
	startsAt, err := time.ParseInLocation("2006-01-02T15:04", input.StartsAt, location)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "start time must use local format YYYY-MM-DDTHH:MM"})
		return
	}
	endsAt, err := time.ParseInLocation("2006-01-02T15:04", input.EndsAt, location)
	if err != nil || !endsAt.After(startsAt) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "end time must be later than start time"})
		return
	}
	if input.RouteID != "" {
		if err := app.db.QueryRow(r.Context(), `SELECT id FROM routes WHERE id = $1 AND tenant_id = $2`, input.RouteID, tenant.ID).Scan(new(string)); err != nil {
			app.writeResourceLookupError(w, err, "route")
			return
		}
	}
	var item availabilityBlockResponse
	err = app.db.QueryRow(r.Context(), `
		WITH created AS (
			INSERT INTO availability_blocks (tenant_id, route_id, starts_at, ends_at, reason)
			VALUES ($1, NULLIF($2, '')::uuid, $3, $4, NULLIF($5, ''))
			RETURNING id, route_id, starts_at, ends_at, reason
		)
		SELECT created.id::text, created.route_id::text, COALESCE(route.name, ''), created.starts_at, created.ends_at, COALESCE(created.reason, '')
		FROM created LEFT JOIN routes route ON route.id = created.route_id
	`, tenant.ID, input.RouteID, startsAt, endsAt, input.Reason).Scan(&item.ID, &item.RouteID, &item.RouteName, &item.StartsAt, &item.EndsAt, &item.Reason)
	if err != nil {
		app.log.Error("create availability block", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create availability block"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"item": item, "timezone": tenant.Timezone})
}

func (app *application) deleteAvailabilityBlock(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	blockID := strings.TrimSpace(r.PathValue("blockID"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var deletedID string
	err := app.db.QueryRow(r.Context(), `
		DELETE FROM availability_blocks WHERE id = $1 AND tenant_id = $2 RETURNING id::text
	`, blockID, tenant.ID).Scan(&deletedID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "availability block not found"})
		return
	}
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "22P02" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "availability block id is invalid"})
			return
		}
		app.log.Error("delete availability block", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not delete availability block"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": deletedID})
}

type fleetLocationResponse struct {
	Latitude       float64   `json:"latitude"`
	Longitude      float64   `json:"longitude"`
	AccuracyMeters *float64  `json:"accuracyMeters,omitempty"`
	RecordedAt     time.Time `json:"recordedAt"`
}

type fleetTripResponse struct {
	ID          string    `json:"id"`
	Status      string    `json:"status"`
	Origin      string    `json:"origin"`
	Destination string    `json:"destination"`
	StartsAt    time.Time `json:"startsAt"`
	EndsAt      time.Time `json:"endsAt"`
}

type fleetVehicleResponse struct {
	ID                 string                 `json:"id"`
	Name               string                 `json:"name"`
	RegistrationNumber string                 `json:"registrationNumber"`
	VehicleClass       string                 `json:"vehicleClass"`
	Capacity           int16                  `json:"capacity"`
	IsActive           bool                   `json:"isActive"`
	Driver             string                 `json:"driver,omitempty"`
	ActiveTrip         *fleetTripResponse     `json:"activeTrip,omitempty"`
	LastLocation       *fleetLocationResponse `json:"lastLocation,omitempty"`
}

func (app *application) listFleet(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	driverID := ""
	includeInactive := true
	if actor, authenticated := identityFromContext(r.Context()); authenticated && actor.Role == "driver" {
		includeInactive = false
		var err error
		driverID, err = app.activeDriverID(r.Context(), tenant.ID, actor.MembershipID)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "driver profile is not connected to this account"})
			return
		}
		if err != nil {
			app.log.Error("load driver profile", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load fleet"})
			return
		}
	}

	rows, err := app.db.Query(r.Context(), `
		SELECT
			v.id::text, v.name, v.registration_number, v.vehicle_class, v.capacity, v.is_active,
			COALESCE(active_driver.full_name, ''),
			active_trip.id::text, active_trip.status::text, active_trip.origin_name,
			active_trip.destination_name, active_trip.starts_at, active_trip.ends_at,
			latest.latitude, latest.longitude, latest.accuracy_meters, latest.recorded_at
		FROM vehicles v
		LEFT JOIN LATERAL (
			SELECT t.id, t.status, t.origin_name, t.destination_name, t.starts_at, t.ends_at, t.driver_id
			FROM trips t
			WHERE t.tenant_id = $1 AND t.vehicle_id = v.id
			  AND t.status IN ('assigned', 'in_progress')
			  AND ($2 = '' OR t.driver_id = NULLIF($2, '')::uuid)
			ORDER BY CASE WHEN t.status = 'in_progress' THEN 0 ELSE 1 END, t.starts_at ASC
			LIMIT 1
		) active_trip ON true
		LEFT JOIN drivers active_driver ON active_driver.id = active_trip.driver_id
		LEFT JOIN LATERAL (
			SELECT latitude, longitude, accuracy_meters, recorded_at
			FROM gps_points p
			WHERE p.tenant_id = $1 AND p.vehicle_id = v.id
			ORDER BY p.recorded_at DESC
			LIMIT 1
		) latest ON true
		WHERE v.tenant_id = $1 AND (v.is_active OR $3)
		  AND ($2 = '' OR EXISTS (
			SELECT 1 FROM trips own_trip
			WHERE own_trip.tenant_id = v.tenant_id AND own_trip.vehicle_id = v.id
			  AND own_trip.driver_id = NULLIF($2, '')::uuid
			  AND own_trip.status IN ('assigned', 'in_progress')
		  ))
		ORDER BY v.name
	`, tenant.ID, driverID, includeInactive)
	if err != nil {
		app.log.Error("list fleet", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load fleet"})
		return
	}
	defer rows.Close()

	items := make([]fleetVehicleResponse, 0)
	for rows.Next() {
		var item fleetVehicleResponse
		var tripID, tripStatus, tripOrigin, tripDestination *string
		var tripStartsAt, tripEndsAt *time.Time
		var latitude, longitude *float64
		var accuracy *float64
		var recordedAt *time.Time
		if err := rows.Scan(
			&item.ID, &item.Name, &item.RegistrationNumber, &item.VehicleClass, &item.Capacity, &item.IsActive,
			&item.Driver, &tripID, &tripStatus, &tripOrigin, &tripDestination, &tripStartsAt, &tripEndsAt,
			&latitude, &longitude, &accuracy, &recordedAt,
		); err != nil {
			app.log.Error("scan fleet", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load fleet"})
			return
		}
		if tripID != nil {
			item.ActiveTrip = &fleetTripResponse{
				ID: *tripID, Status: *tripStatus, Origin: *tripOrigin, Destination: *tripDestination,
				StartsAt: *tripStartsAt, EndsAt: *tripEndsAt,
			}
		}
		if latitude != nil && longitude != nil && recordedAt != nil {
			item.LastLocation = &fleetLocationResponse{
				Latitude: *latitude, Longitude: *longitude, AccuracyMeters: accuracy, RecordedAt: *recordedAt,
			}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate fleet", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load fleet"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": items, "timezone": tenant.Timezone})
}

type vehicleInput struct {
	Name               string `json:"name"`
	RegistrationNumber string `json:"registrationNumber"`
	VehicleClass       string `json:"vehicleClass"`
	Capacity           int16  `json:"capacity"`
	IsActive           bool   `json:"isActive"`
}

type vehicleResponse struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	RegistrationNumber string `json:"registrationNumber"`
	VehicleClass       string `json:"vehicleClass"`
	Capacity           int16  `json:"capacity"`
	IsActive           bool   `json:"isActive"`
}

func validateVehicleInput(input *vehicleInput) bool {
	input.Name = strings.TrimSpace(input.Name)
	input.RegistrationNumber = strings.ToUpper(strings.TrimSpace(input.RegistrationNumber))
	input.VehicleClass = strings.TrimSpace(input.VehicleClass)
	return input.Name != "" && input.RegistrationNumber != "" && input.VehicleClass != "" &&
		len([]rune(input.Name)) <= 160 && len([]rune(input.RegistrationNumber)) <= 64 &&
		len([]rune(input.VehicleClass)) <= 80 && input.Capacity > 0 && input.Capacity <= 150
}

func decodeVehicleInput(w http.ResponseWriter, r *http.Request, input *vehicleInput) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(input); err != nil || !validateVehicleInput(input) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "vehicle name, registration number, class and capacity from 1 to 150 are required"})
		return false
	}
	return true
}

func (app *application) createVehicle(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input vehicleInput
	if !decodeVehicleInput(w, r, &input) {
		return
	}
	var item vehicleResponse
	err := app.db.QueryRow(r.Context(), `
		INSERT INTO vehicles (tenant_id, name, registration_number, vehicle_class, capacity, is_active)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id::text, name, registration_number, vehicle_class, capacity, is_active
	`, tenant.ID, input.Name, input.RegistrationNumber, input.VehicleClass, input.Capacity, input.IsActive).Scan(
		&item.ID, &item.Name, &item.RegistrationNumber, &item.VehicleClass, &item.Capacity, &item.IsActive,
	)
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "vehicle registration number already exists"})
			return
		}
		app.log.Error("create vehicle", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create vehicle"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"item": item})
}

func (app *application) updateVehicle(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	vehicleID := strings.TrimSpace(r.PathValue("vehicleID"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input vehicleInput
	if !decodeVehicleInput(w, r, &input) {
		return
	}
	if !input.IsActive {
		var hasActiveTrip bool
		err := app.db.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM trips
				WHERE tenant_id = $1 AND vehicle_id = $2 AND status IN ('assigned', 'in_progress')
			)
		`, tenant.ID, vehicleID).Scan(&hasActiveTrip)
		if err != nil {
			app.log.Error("check vehicle trips", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update vehicle"})
			return
		}
		if hasActiveTrip {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "finish or reassign active trips before deactivating this vehicle"})
			return
		}
	}
	var item vehicleResponse
	err := app.db.QueryRow(r.Context(), `
		UPDATE vehicles
		SET name = $1, registration_number = $2, vehicle_class = $3, capacity = $4, is_active = $5, updated_at = now()
		WHERE id = $6 AND tenant_id = $7
		RETURNING id::text, name, registration_number, vehicle_class, capacity, is_active
	`, input.Name, input.RegistrationNumber, input.VehicleClass, input.Capacity, input.IsActive, vehicleID, tenant.ID).Scan(
		&item.ID, &item.Name, &item.RegistrationNumber, &item.VehicleClass, &item.Capacity, &item.IsActive,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "vehicle not found"})
		return
	}
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "vehicle registration number already exists"})
			return
		}
		app.log.Error("update vehicle", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update vehicle"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}

func (app *application) listTripResources(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	if slug == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant slug is required"})
		return
	}
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	vehicles, err := app.db.Query(r.Context(), `
		SELECT id::text, name, capacity
		FROM vehicles
		WHERE tenant_id = $1 AND is_active
		ORDER BY name
	`, tenant.ID)
	if err != nil {
		app.log.Error("list vehicles", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trip resources"})
		return
	}
	defer vehicles.Close()

	vehicleItems := make([]tripResourceResponse, 0)
	for vehicles.Next() {
		var item tripResourceResponse
		if err := vehicles.Scan(&item.ID, &item.Name, &item.Capacity); err != nil {
			app.log.Error("scan vehicle", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trip resources"})
			return
		}
		vehicleItems = append(vehicleItems, item)
	}
	if err := vehicles.Err(); err != nil {
		app.log.Error("iterate vehicles", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trip resources"})
		return
	}

	drivers, err := app.db.Query(r.Context(), `
		SELECT id::text, full_name
		FROM drivers
		WHERE tenant_id = $1 AND is_active
		ORDER BY full_name
	`, tenant.ID)
	if err != nil {
		app.log.Error("list drivers", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trip resources"})
		return
	}
	defer drivers.Close()

	driverItems := make([]tripResourceResponse, 0)
	for drivers.Next() {
		var item tripResourceResponse
		if err := drivers.Scan(&item.ID, &item.Name); err != nil {
			app.log.Error("scan driver", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trip resources"})
			return
		}
		driverItems = append(driverItems, item)
	}
	if err := drivers.Err(); err != nil {
		app.log.Error("iterate drivers", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trip resources"})
		return
	}

	routes, err := app.db.Query(r.Context(), `
		SELECT id::text, name, origin_name, destination_name, currency, default_price_minor, default_pricing_mode
		FROM routes WHERE tenant_id = $1 AND is_active ORDER BY name
	`, tenant.ID)
	if err != nil {
		app.log.Error("list routes", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trip resources"})
		return
	}
	defer routes.Close()
	routeItems := make([]routeResourceResponse, 0)
	for routes.Next() {
		var item routeResourceResponse
		if err := routes.Scan(&item.ID, &item.Name, &item.Origin, &item.Destination, &item.Currency, &item.DefaultPriceMinor, &item.DefaultPricingMode); err != nil {
			app.log.Error("scan route", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trip resources"})
			return
		}
		routeItems = append(routeItems, item)
	}
	if err := routes.Err(); err != nil {
		app.log.Error("iterate routes", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load trip resources"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"vehicles": vehicleItems, "drivers": driverItems, "routes": routeItems, "currency": tenant.BaseCurrency})
}

type createTripRequest struct {
	Kind        string         `json:"kind"`
	RouteID     string         `json:"routeId"`
	Origin      string         `json:"origin"`
	Destination string         `json:"destination"`
	StartsAt    string         `json:"startsAt"`
	EndsAt      string         `json:"endsAt"`
	VehicleID   string         `json:"vehicleId"`
	DriverID    string         `json:"driverId"`
	Notes       string         `json:"notes"`
	PriceMinor  int64          `json:"priceMinor"`
	PricingMode string         `json:"pricingMode"`
	CustomData  map[string]any `json:"customData"`
}

type createTripScheduleRequest struct {
	createTripRequest
	RepeatUntil string `json:"repeatUntil"`
	Weekdays    []int  `json:"weekdays"`
}

type tripScheduleResponse struct {
	CreatedCount  int       `json:"createdCount"`
	FirstStartsAt time.Time `json:"firstStartsAt"`
	LastStartsAt  time.Time `json:"lastStartsAt"`
}

type scheduledTripInstance struct {
	startsAt time.Time
	endsAt   time.Time
}

func expandWeeklyTripSchedule(startsAt, endsAt, repeatUntil time.Time, weekdays map[time.Weekday]struct{}) []scheduledTripInstance {
	location := startsAt.Location()
	firstDay := time.Date(startsAt.Year(), startsAt.Month(), startsAt.Day(), 0, 0, 0, 0, location)
	instances := make([]scheduledTripInstance, 0, 52)
	for day := firstDay; !day.After(repeatUntil); day = day.AddDate(0, 0, 1) {
		if _, selected := weekdays[day.Weekday()]; !selected {
			continue
		}
		candidateStart := time.Date(day.Year(), day.Month(), day.Day(), startsAt.Hour(), startsAt.Minute(), 0, 0, location)
		instances = append(instances, scheduledTripInstance{
			startsAt: candidateStart,
			endsAt:   candidateStart.Add(endsAt.Sub(startsAt)),
		})
	}
	return instances
}

func (app *application) createTripSchedule(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	var request createTripScheduleRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid trip schedule payload"})
		return
	}
	input := request.createTripRequest
	input.Kind = strings.TrimSpace(input.Kind)
	input.RouteID = strings.TrimSpace(input.RouteID)
	input.Origin = strings.TrimSpace(input.Origin)
	input.Destination = strings.TrimSpace(input.Destination)
	input.VehicleID = strings.TrimSpace(input.VehicleID)
	input.DriverID = strings.TrimSpace(input.DriverID)
	input.Notes = strings.TrimSpace(input.Notes)
	input.PricingMode = strings.TrimSpace(input.PricingMode)
	if input.Kind != "regular" || input.RouteID == "" || input.VehicleID == "" || input.DriverID == "" || input.PriceMinor < 0 || input.PriceMinor > 10_000_000_000 || (input.PricingMode != "" && !isPricingMode(input.PricingMode)) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "fill in a regular route, vehicle and driver"})
		return
	}

	var defaultPriceMinor int64
	var defaultPricingMode string
	var tripCurrency string
	if err := app.db.QueryRow(r.Context(), `SELECT origin_name, destination_name, default_price_minor, default_pricing_mode, currency FROM routes WHERE id = $1 AND tenant_id = $2 AND is_active`, input.RouteID, tenant.ID).Scan(&input.Origin, &input.Destination, &defaultPriceMinor, &defaultPricingMode, &tripCurrency); err != nil {
		app.writeResourceLookupError(w, err, "route")
		return
	}
	if input.PriceMinor == 0 && defaultPriceMinor > 0 {
		input.PriceMinor = defaultPriceMinor
	}
	if input.PricingMode == "" {
		input.PricingMode = defaultPricingMode
	}
	input.PricingMode = normalizePricingMode(input.PricingMode)
	if len([]rune(input.Notes)) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trip notes are too long"})
		return
	}
	customData, err := app.validateCustomData(r.Context(), tenant.ID, "trip", input.CustomData)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	encodedCustomData, err := json.Marshal(customData)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "custom field data are invalid"})
		return
	}

	location, err := time.LoadLocation(tenant.Timezone)
	if err != nil {
		app.log.Error("load tenant timezone", "error", err, "tenant", slug, "timezone", tenant.Timezone)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create trip schedule"})
		return
	}
	startsAt, err := time.ParseInLocation("2006-01-02T15:04", input.StartsAt, location)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "start time must use local format YYYY-MM-DDTHH:MM"})
		return
	}
	endsAt, err := time.ParseInLocation("2006-01-02T15:04", input.EndsAt, location)
	if err != nil || !endsAt.After(startsAt) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "end time must be later than start time"})
		return
	}
	repeatUntil, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(request.RepeatUntil), location)
	if err != nil || repeatUntil.Before(time.Date(startsAt.Year(), startsAt.Month(), startsAt.Day(), 0, 0, 0, 0, location)) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "repeat end date must not be earlier than the first trip"})
		return
	}
	if repeatUntil.After(startsAt.AddDate(1, 0, 0)) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a schedule can cover at most one year"})
		return
	}
	weekdays := make(map[time.Weekday]struct{}, len(request.Weekdays))
	for _, weekday := range request.Weekdays {
		if weekday < int(time.Sunday) || weekday > int(time.Saturday) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "weekdays must use values from 0 to 6"})
			return
		}
		weekdays[time.Weekday(weekday)] = struct{}{}
	}
	if len(weekdays) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "choose at least one weekday"})
		return
	}

	var capacity int16
	if err := app.db.QueryRow(r.Context(), `SELECT capacity FROM vehicles WHERE id = $1 AND tenant_id = $2 AND is_active`, input.VehicleID, tenant.ID).Scan(&capacity); err != nil {
		app.writeResourceLookupError(w, err, "vehicle")
		return
	}
	if err := app.db.QueryRow(r.Context(), `SELECT id FROM drivers WHERE id = $1 AND tenant_id = $2 AND is_active`, input.DriverID, tenant.ID).Scan(new(string)); err != nil {
		app.writeResourceLookupError(w, err, "driver")
		return
	}

	instances := expandWeeklyTripSchedule(startsAt, endsAt, repeatUntil, weekdays)
	if len(instances) == 0 || len(instances) > 90 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the selected period must create from 1 to 90 trips"})
		return
	}

	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.log.Error("begin trip schedule", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create trip schedule"})
		return
	}
	defer tx.Rollback(r.Context())
	for _, instance := range instances {
		var blocked bool
		if err := tx.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM availability_blocks
				WHERE tenant_id = $1 AND starts_at < $3 AND ends_at > $2
					AND (route_id IS NULL OR route_id = $4)
			)
		`, tenant.ID, instance.startsAt, instance.endsAt, input.RouteID).Scan(&blocked); err != nil {
			app.log.Error("check schedule availability", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create trip schedule"})
			return
		}
		if blocked {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "one or more planned departures fall into an unavailable period"})
			return
		}
		_, err := tx.Exec(r.Context(), `
			INSERT INTO trips (
				tenant_id, route_id, vehicle_id, driver_id, kind, status, origin_name, destination_name,
				starts_at, ends_at, capacity, price_minor, currency, pricing_mode, notes, custom_data
			) VALUES ($1, $2, $3, $4, 'regular', 'assigned', $5, $6, $7, $8, $9, $10, $11, $12, NULLIF($13, ''), $14)
		`, tenant.ID, input.RouteID, input.VehicleID, input.DriverID, input.Origin, input.Destination, instance.startsAt, instance.endsAt, capacity, input.PriceMinor, tripCurrency, input.PricingMode, input.Notes, encodedCustomData)
		if err != nil {
			var pgError *pgconn.PgError
			if errors.As(err, &pgError) && pgError.Code == "23P01" {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "one or more departures conflict with the selected vehicle or driver"})
				return
			}
			app.log.Error("insert scheduled trip", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create trip schedule"})
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		app.log.Error("commit trip schedule", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create trip schedule"})
		return
	}

	writeJSON(w, http.StatusCreated, tripScheduleResponse{
		CreatedCount:  len(instances),
		FirstStartsAt: instances[0].startsAt,
		LastStartsAt:  instances[len(instances)-1].startsAt,
	})
}

func (app *application) createTrip(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	if slug == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant slug is required"})
		return
	}
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	var input createTripRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid trip payload"})
		return
	}

	input.Kind = strings.TrimSpace(input.Kind)
	input.RouteID = strings.TrimSpace(input.RouteID)
	input.Origin = strings.TrimSpace(input.Origin)
	input.Destination = strings.TrimSpace(input.Destination)
	input.VehicleID = strings.TrimSpace(input.VehicleID)
	input.DriverID = strings.TrimSpace(input.DriverID)
	input.Notes = strings.TrimSpace(input.Notes)
	input.PricingMode = strings.TrimSpace(input.PricingMode)
	if (input.Kind != "regular" && input.Kind != "individual") || ((input.Origin == "" || input.Destination == "") && input.RouteID == "") || input.VehicleID == "" || input.DriverID == "" || (input.Kind != "regular" && input.RouteID != "") || input.PriceMinor < 0 || input.PriceMinor > 10_000_000_000 || (input.PricingMode != "" && !isPricingMode(input.PricingMode)) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "fill in trip type, route, vehicle and driver"})
		return
	}
	tripCurrency := tenant.BaseCurrency
	if input.RouteID != "" {
		var defaultPriceMinor int64
		var defaultPricingMode string
		if err := app.db.QueryRow(r.Context(), `SELECT origin_name, destination_name, default_price_minor, default_pricing_mode, currency FROM routes WHERE id = $1 AND tenant_id = $2 AND is_active`, input.RouteID, tenant.ID).Scan(&input.Origin, &input.Destination, &defaultPriceMinor, &defaultPricingMode, &tripCurrency); err != nil {
			app.writeResourceLookupError(w, err, "route")
			return
		}
		if input.PriceMinor == 0 && defaultPriceMinor > 0 {
			input.PriceMinor = defaultPriceMinor
		}
		if strings.TrimSpace(input.PricingMode) == "" {
			input.PricingMode = defaultPricingMode
		}
	}
	input.PricingMode = normalizePricingMode(input.PricingMode)
	if len([]rune(input.Origin)) > 120 || len([]rune(input.Destination)) > 120 || len([]rune(input.Notes)) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trip fields are too long"})
		return
	}
	customData, err := app.validateCustomData(r.Context(), tenant.ID, "trip", input.CustomData)
	if err != nil {
		app.log.Warn("invalid trip custom data", "error", err, "tenant", slug)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	encodedCustomData, err := json.Marshal(customData)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "custom field data are invalid"})
		return
	}

	location, err := time.LoadLocation(tenant.Timezone)
	if err != nil {
		app.log.Error("load tenant timezone", "error", err, "tenant", slug, "timezone", tenant.Timezone)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create trip"})
		return
	}
	startsAt, err := time.ParseInLocation("2006-01-02T15:04", input.StartsAt, location)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "start time must use local format YYYY-MM-DDTHH:MM"})
		return
	}
	endsAt, err := time.ParseInLocation("2006-01-02T15:04", input.EndsAt, location)
	if err != nil || !endsAt.After(startsAt) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "end time must be later than start time"})
		return
	}
	var isBlocked bool
	if err := app.db.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM availability_blocks
			WHERE tenant_id = $1
			  AND starts_at < $3 AND ends_at > $2
			  AND (route_id IS NULL OR route_id = NULLIF($4, '')::uuid)
		)
	`, tenant.ID, startsAt, endsAt, input.RouteID).Scan(&isBlocked); err != nil {
		app.log.Error("check availability blocks", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create trip"})
		return
	}
	if isBlocked {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "this time is unavailable for the selected route"})
		return
	}

	var capacity int16
	if err := app.db.QueryRow(r.Context(), `
		SELECT capacity FROM vehicles WHERE id = $1 AND tenant_id = $2 AND is_active
	`, input.VehicleID, tenant.ID).Scan(&capacity); err != nil {
		app.writeResourceLookupError(w, err, "vehicle")
		return
	}
	if err := app.db.QueryRow(r.Context(), `
		SELECT id FROM drivers WHERE id = $1 AND tenant_id = $2 AND is_active
	`, input.DriverID, tenant.ID).Scan(new(string)); err != nil {
		app.writeResourceLookupError(w, err, "driver")
		return
	}

	var trip tripResponse
	err = app.db.QueryRow(r.Context(), `
		WITH created AS (
			INSERT INTO trips (
				tenant_id, route_id, vehicle_id, driver_id, kind, status, origin_name, destination_name,
			starts_at, ends_at, capacity, price_minor, currency, pricing_mode, notes, custom_data
		) VALUES ($1, NULLIF($2, '')::uuid, $3, $4, $5::trip_kind, 'assigned', $6, $7, $8, $9, $10, $11, $12, $13, NULLIF($14, ''), $15)
			RETURNING id, kind::text, status::text, origin_name, destination_name, starts_at, ends_at, capacity, price_minor, pricing_mode, currency, custom_data, vehicle_id, driver_id
		)
		SELECT c.id::text, c.kind, c.status, c.origin_name, c.destination_name,
			c.starts_at, c.ends_at, c.capacity, c.price_minor, c.pricing_mode, c.currency,
			c.custom_data, v.name, d.full_name
		FROM created c
		JOIN vehicles v ON v.id = c.vehicle_id
		JOIN drivers d ON d.id = c.driver_id
	`, tenant.ID, input.RouteID, input.VehicleID, input.DriverID, input.Kind, input.Origin, input.Destination, startsAt, endsAt, capacity, input.PriceMinor, tripCurrency, input.PricingMode, input.Notes, encodedCustomData).Scan(
		&trip.ID, &trip.Kind, &trip.Status, &trip.Origin, &trip.Destination,
		&trip.StartsAt, &trip.EndsAt, &trip.Capacity, &trip.PriceMinor, &trip.PricingMode, &trip.Currency,
		&encodedCustomData, &trip.Vehicle, &trip.Driver,
	)
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23P01" {
			message := "Выбранный транспорт или водитель уже заняты в этот период"
			if pgError.ConstraintName == "trips_vehicle_no_overlap" {
				message = "Выбранный транспорт уже занят в этот период"
			}
			if pgError.ConstraintName == "trips_driver_no_overlap" {
				message = "Выбранный водитель уже занят в этот период"
			}
			writeJSON(w, http.StatusConflict, map[string]string{"error": message})
			return
		}
		app.log.Error("create trip", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create trip"})
		return
	}
	trip.CustomData, err = decodeCustomData(encodedCustomData)
	if err != nil {
		app.log.Error("decode created trip custom data", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create trip"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"item": trip, "timezone": tenant.Timezone})
}

func (app *application) updateTrip(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tripID := strings.TrimSpace(r.PathValue("tripID"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	var input createTripRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid trip payload"})
		return
	}
	input.Kind, input.RouteID = strings.TrimSpace(input.Kind), strings.TrimSpace(input.RouteID)
	input.Origin, input.Destination = strings.TrimSpace(input.Origin), strings.TrimSpace(input.Destination)
	input.VehicleID, input.DriverID, input.Notes = strings.TrimSpace(input.VehicleID), strings.TrimSpace(input.DriverID), strings.TrimSpace(input.Notes)
	input.PricingMode = normalizePricingMode(input.PricingMode)
	if (input.Kind != "regular" && input.Kind != "individual") || ((input.Origin == "" || input.Destination == "") && input.RouteID == "") || input.VehicleID == "" || input.DriverID == "" || (input.Kind != "regular" && input.RouteID != "") || input.PriceMinor < 0 || input.PriceMinor > 10_000_000_000 || !isPricingMode(input.PricingMode) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "fill in trip type, route, vehicle and driver"})
		return
	}
	tripCurrency := tenant.BaseCurrency
	if input.RouteID != "" {
		if err := app.db.QueryRow(r.Context(), `SELECT origin_name, destination_name, currency FROM routes WHERE id = $1 AND tenant_id = $2 AND is_active`, input.RouteID, tenant.ID).Scan(&input.Origin, &input.Destination, &tripCurrency); err != nil {
			app.writeResourceLookupError(w, err, "route")
			return
		}
	}
	if len([]rune(input.Origin)) > 120 || len([]rune(input.Destination)) > 120 || len([]rune(input.Notes)) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trip fields are too long"})
		return
	}
	customData, err := app.validateCustomData(r.Context(), tenant.ID, "trip", input.CustomData)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	encodedCustomData, err := json.Marshal(customData)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "custom field data are invalid"})
		return
	}
	location, err := time.LoadLocation(tenant.Timezone)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update trip"})
		return
	}
	startsAt, err := time.ParseInLocation("2006-01-02T15:04", input.StartsAt, location)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "start time must use local format YYYY-MM-DDTHH:MM"})
		return
	}
	endsAt, err := time.ParseInLocation("2006-01-02T15:04", input.EndsAt, location)
	if err != nil || !endsAt.After(startsAt) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "end time must be later than start time"})
		return
	}
	var isBlocked bool
	if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM availability_blocks WHERE tenant_id = $1 AND starts_at < $3 AND ends_at > $2 AND (route_id IS NULL OR route_id = NULLIF($4, '')::uuid))`, tenant.ID, startsAt, endsAt, input.RouteID).Scan(&isBlocked); err != nil {
		app.log.Error("check availability blocks", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update trip"})
		return
	}
	if isBlocked {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "this time is unavailable for the selected route"})
		return
	}
	var capacity int16
	if err := app.db.QueryRow(r.Context(), `SELECT capacity FROM vehicles WHERE id = $1 AND tenant_id = $2 AND is_active`, input.VehicleID, tenant.ID).Scan(&capacity); err != nil {
		app.writeResourceLookupError(w, err, "vehicle")
		return
	}
	if err := app.db.QueryRow(r.Context(), `SELECT id FROM drivers WHERE id = $1 AND tenant_id = $2 AND is_active`, input.DriverID, tenant.ID).Scan(new(string)); err != nil {
		app.writeResourceLookupError(w, err, "driver")
		return
	}
	var trip tripResponse
	var responseCustomData []byte
	err = app.db.QueryRow(r.Context(), `
		WITH updated AS (
			UPDATE trips SET route_id = NULLIF($1, '')::uuid, vehicle_id = $2, driver_id = $3, kind = $4::trip_kind,
				origin_name = $5, destination_name = $6, starts_at = $7, ends_at = $8, capacity = $9, price_minor = $10, pricing_mode = $11,
				currency = $12, notes = NULLIF($13, ''), custom_data = $14, updated_at = now()
			WHERE id = $15 AND tenant_id = $16 AND status IN ('new', 'assigned')
			RETURNING id, kind::text, status::text, origin_name, destination_name, starts_at, ends_at, capacity, price_minor, pricing_mode, currency, custom_data, vehicle_id, driver_id
		)
		SELECT u.id::text, u.kind, u.status, u.origin_name, u.destination_name, u.starts_at, u.ends_at, u.capacity, u.price_minor, u.pricing_mode, u.currency, u.custom_data, v.name, d.full_name
		FROM updated u JOIN vehicles v ON v.id = u.vehicle_id JOIN drivers d ON d.id = u.driver_id
	`, input.RouteID, input.VehicleID, input.DriverID, input.Kind, input.Origin, input.Destination, startsAt, endsAt, capacity, input.PriceMinor, input.PricingMode, tripCurrency, input.Notes, encodedCustomData, tripID, tenant.ID).Scan(&trip.ID, &trip.Kind, &trip.Status, &trip.Origin, &trip.Destination, &trip.StartsAt, &trip.EndsAt, &trip.Capacity, &trip.PriceMinor, &trip.PricingMode, &trip.Currency, &responseCustomData, &trip.Vehicle, &trip.Driver)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "only new or assigned trips can be edited"})
		return
	}
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23P01" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "selected vehicle or driver is busy during this period"})
			return
		}
		app.log.Error("update trip", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update trip"})
		return
	}
	trip.CustomData, err = decodeCustomData(responseCustomData)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update trip"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": trip, "timezone": tenant.Timezone})
}

type changeTripStatusRequest struct {
	Status string `json:"status"`
}

var allowedTripTransitions = map[string]map[string]bool{
	"draft":       {"new": true, "cancelled": true},
	"new":         {"assigned": true, "cancelled": true},
	"assigned":    {"in_progress": true, "cancelled": true},
	"in_progress": {"completed": true, "cancelled": true},
}

func (app *application) changeTripStatus(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tripID := strings.TrimSpace(r.PathValue("tripID"))
	if slug == "" || tripID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant and trip are required"})
		return
	}
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	var input changeTripStatusRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid status payload"})
		return
	}
	input.Status = strings.TrimSpace(input.Status)
	if input.Status == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "status is required"})
		return
	}
	driverID := ""
	if actor, authenticated := identityFromContext(r.Context()); authenticated && actor.Role == "driver" {
		var err error
		driverID, err = app.activeDriverID(r.Context(), tenant.ID, actor.MembershipID)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "driver profile is not connected to this account"})
			return
		}
		if err != nil {
			app.log.Error("load driver profile", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not change trip status"})
			return
		}
		if input.Status != "in_progress" && input.Status != "completed" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "a driver can only start or complete an assigned trip"})
			return
		}
	}

	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.log.Error("start trip status transaction", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not change trip status"})
		return
	}
	defer tx.Rollback(r.Context())

	var currentStatus string
	if err := tx.QueryRow(r.Context(), `
		SELECT t.status::text
		FROM trips t
		WHERE t.id = $1 AND t.tenant_id = $2
		  AND (NULLIF($3, '')::uuid IS NULL OR t.driver_id = NULLIF($3, '')::uuid)
		FOR UPDATE
	`, tripID, tenant.ID, driverID).Scan(&currentStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "trip not found"})
			return
		}
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "22P02" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trip id is invalid"})
			return
		}
		app.log.Error("load trip status", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not change trip status"})
		return
	}
	if !allowedTripTransitions[currentStatus][input.Status] {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "this status transition is not allowed"})
		return
	}
	if input.Status == "completed" {
		var cashDue, cashCollected int64
		if err := tx.QueryRow(r.Context(), `
			SELECT
				COALESCE((
					SELECT SUM(price_minor) FROM bookings
					WHERE tenant_id = $1 AND trip_id = $2 AND status = 'cash_on_boarding'
				), 0),
				COALESCE((
					SELECT SUM(amount_minor) FROM driver_cash_ledger
					WHERE tenant_id = $1 AND trip_id = $2 AND kind = 'cash_collected'
				), 0)
		`, tenant.ID, tripID).Scan(&cashDue, &cashCollected); err != nil {
			app.log.Error("load trip cash receipt", "error", err, "tenant", slug, "trip", tripID)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not verify trip cash receipt"})
			return
		}
		if cashDue != cashCollected {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "cash payment must be confirmed by the driver before completing this trip"})
			return
		}
	}

	var trip tripResponse
	var driverPhone string
	err = tx.QueryRow(r.Context(), `
		WITH updated AS (
			UPDATE trips
			SET status = $1::trip_status, updated_at = now()
			WHERE id = $2 AND tenant_id = $3 AND status = $4::trip_status
			  AND (NULLIF($5, '')::uuid IS NULL OR driver_id = NULLIF($5, '')::uuid)
			RETURNING id, kind::text, status::text, origin_name, destination_name,
				starts_at, ends_at, capacity, price_minor, currency, vehicle_id, driver_id
		)
		SELECT u.id::text, u.kind, u.status, u.origin_name, u.destination_name,
			u.starts_at, u.ends_at, u.capacity, u.price_minor, u.currency,
			COALESCE(v.name, ''), COALESCE(d.full_name, ''), COALESCE(d.phone_e164, '')
		FROM updated u
		LEFT JOIN vehicles v ON v.id = u.vehicle_id
		LEFT JOIN drivers d ON d.id = u.driver_id
	`, input.Status, tripID, tenant.ID, currentStatus, driverID).Scan(
		&trip.ID, &trip.Kind, &trip.Status, &trip.Origin, &trip.Destination,
		&trip.StartsAt, &trip.EndsAt, &trip.Capacity, &trip.PriceMinor, &trip.Currency,
		&trip.Vehicle, &trip.Driver, &driverPhone,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "trip was changed by another dispatcher; refresh the schedule"})
			return
		}
		app.log.Error("change trip status", "error", err, "tenant", slug, "trip", tripID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not change trip status"})
		return
	}
	payload, err := json.Marshal(telegramoutbox.TripStatusPayload{
		Status:      trip.Status,
		Origin:      trip.Origin,
		Destination: trip.Destination,
		StartsAt:    trip.StartsAt,
		Vehicle:     trip.Vehicle,
		Driver:      trip.Driver,
		DriverPhone: driverPhone,
	})
	if err != nil {
		app.log.Error("encode trip status notification", "error", err, "tenant", slug, "trip", tripID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not change trip status"})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO telegram_notification_outbox (tenant_id, chat_id, kind, payload)
		SELECT $1, customer.telegram_id, $3, $4::jsonb
		FROM bookings booking
		JOIN customers customer ON customer.id = booking.customer_id
		WHERE booking.tenant_id = $1
		  AND booking.trip_id = $2
		  AND customer.telegram_id IS NOT NULL
		  AND booking.status IN ('cash_on_boarding', 'confirmed')
	`, tenant.ID, trip.ID, telegramoutbox.KindTripStatus, payload); err != nil {
		app.log.Error("queue trip status notifications", "error", err, "tenant", slug, "trip", tripID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not change trip status"})
		return
	}
	if input.Status == "completed" {
		if _, err := tx.Exec(r.Context(), `
			UPDATE bookings
			SET status = 'completed', updated_at = now()
			WHERE tenant_id = $1 AND trip_id = $2
			  AND status IN ('cash_on_boarding', 'confirmed')
		`, tenant.ID, trip.ID); err != nil {
			app.log.Error("complete trip bookings", "error", err, "tenant", slug, "trip", tripID)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not complete trip bookings"})
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		app.log.Error("commit trip status transaction", "error", err, "tenant", slug, "trip", tripID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not change trip status"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"item": trip, "timezone": tenant.Timezone})
}

func (app *application) loadTenant(w http.ResponseWriter, r *http.Request, slug string) (tenant, bool) {
	if cached, ok := r.Context().Value(tenantContextKey{}).(tenant); ok {
		return cached, true
	}
	var result tenant
	if err := app.db.QueryRow(r.Context(), `SELECT id::text, name, timezone, base_currency, subscription_status FROM tenants WHERE slug = $1`, slug).Scan(&result.ID, &result.Name, &result.Timezone, &result.BaseCurrency, &result.SubscriptionStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "tenant not found"})
			return tenant{}, false
		}
		app.log.Error("load tenant", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load tenant"})
		return tenant{}, false
	}
	return result, true
}

type updateSubscriptionRequest struct {
	Status          string `json:"status"`
	Reason          string `json:"reason"`
	ExternalEventID string `json:"externalEventId"`
}

type provisionTenantRequest struct {
	Slug               string  `json:"slug"`
	Name               string  `json:"name"`
	Timezone           string  `json:"timezone"`
	BaseCurrency       string  `json:"baseCurrency"`
	SubscriptionStatus string  `json:"subscriptionStatus"`
	OwnerEmail         string  `json:"ownerEmail"`
	OwnerDisplayName   string  `json:"ownerDisplayName"`
	OwnerPassword      string  `json:"ownerPassword"`
	PrimaryColor       string  `json:"primaryColor"`
	DefaultTheme       string  `json:"defaultTheme"`
	LogoURL            *string `json:"logoUrl"`
}

type provisionTenantResponse struct {
	Slug               string `json:"slug"`
	Name               string `json:"name"`
	SubscriptionStatus string `json:"subscriptionStatus"`
	OwnerEmail         string `json:"ownerEmail"`
	Replayed           bool   `json:"replayed"`
}

var tenantSlugPattern = regexp.MustCompile(`^[a-z0-9-]{3,63}$`)

func (app *application) authorizedSaaSControl(r *http.Request) bool {
	return app.saasControlSecret != "" && subtle.ConstantTimeCompare([]byte(app.saasControlSecret), []byte(r.Header.Get("X-SaaS-Control-Token"))) == 1
}

func normalizeProvisionTenantRequest(input *provisionTenantRequest) error {
	input.Slug = strings.ToLower(strings.TrimSpace(input.Slug))
	input.Name = strings.TrimSpace(input.Name)
	input.Timezone = strings.TrimSpace(input.Timezone)
	input.BaseCurrency = strings.ToUpper(strings.TrimSpace(input.BaseCurrency))
	input.SubscriptionStatus = strings.TrimSpace(input.SubscriptionStatus)
	input.OwnerEmail = strings.ToLower(strings.TrimSpace(input.OwnerEmail))
	input.OwnerDisplayName = strings.TrimSpace(input.OwnerDisplayName)
	input.PrimaryColor = strings.ToUpper(strings.TrimSpace(input.PrimaryColor))
	input.DefaultTheme = strings.TrimSpace(input.DefaultTheme)
	if input.SubscriptionStatus == "" {
		input.SubscriptionStatus = "trial"
	}
	if input.BaseCurrency == "" {
		input.BaseCurrency = "EUR"
	}
	if input.PrimaryColor == "" {
		input.PrimaryColor = "#E9B74D"
	}
	if input.DefaultTheme == "" {
		input.DefaultTheme = "dark"
	}
	if !tenantSlugPattern.MatchString(input.Slug) || len([]rune(input.Name)) < 2 || len([]rune(input.Name)) > 160 || input.Timezone == "" || !validFinanceCurrency(input.BaseCurrency) || !isSubscriptionStatus(input.SubscriptionStatus) || len([]rune(input.OwnerDisplayName)) < 2 || len([]rune(input.OwnerDisplayName)) > 160 || !isHexColor(input.PrimaryColor) || (input.DefaultTheme != "light" && input.DefaultTheme != "dark" && input.DefaultTheme != "system") {
		return errors.New("invalid tenant provision request")
	}
	if _, err := time.LoadLocation(input.Timezone); err != nil {
		return errors.New("tenant timezone is invalid")
	}
	parsed, err := mail.ParseAddress(input.OwnerEmail)
	if err != nil || parsed.Address != input.OwnerEmail {
		return errors.New("owner email is invalid")
	}
	if input.LogoURL != nil {
		value := strings.TrimSpace(*input.LogoURL)
		if value == "" {
			input.LogoURL = nil
		} else if len(value) > 2_000 || (!strings.HasPrefix(value, "https://") && !strings.HasPrefix(value, "/")) {
			return errors.New("logo URL is invalid")
		} else {
			input.LogoURL = &value
		}
	}
	return nil
}

func (app *application) provisionTenant(w http.ResponseWriter, r *http.Request) {
	if !app.authorizedSaaSControl(r) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "tenant control is unavailable"})
		return
	}
	var input provisionTenantRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid tenant provision payload"})
		return
	}
	if err := normalizeProvisionTenantRequest(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.log.Error("start tenant provision", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
		return
	}
	defer tx.Rollback(r.Context())

	var tenantID string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO tenants (slug, name, timezone, base_currency, subscription_status)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (slug) DO NOTHING
		RETURNING id::text
	`, input.Slug, input.Name, input.Timezone, input.BaseCurrency, input.SubscriptionStatus).Scan(&tenantID)
	if errors.Is(err, pgx.ErrNoRows) {
		var existingName, existingSubscriptionStatus string
		if err := tx.QueryRow(r.Context(), `SELECT name, subscription_status FROM tenants WHERE slug = $1`, input.Slug).Scan(&existingName, &existingSubscriptionStatus); err != nil {
			app.log.Error("load replayed tenant", "error", err, "tenant", input.Slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
			return
		}
		writeJSON(w, http.StatusOK, provisionTenantResponse{Slug: input.Slug, Name: existingName, SubscriptionStatus: existingSubscriptionStatus, OwnerEmail: input.OwnerEmail, Replayed: true})
		return
	}
	if err != nil {
		app.log.Error("create tenant", "error", err, "tenant", input.Slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO tenant_branding (tenant_id, logo_url, primary_color, default_theme)
		VALUES ($1, $2, $3, $4)
	`, tenantID, input.LogoURL, input.PrimaryColor, input.DefaultTheme); err != nil {
		app.log.Error("create tenant branding", "error", err, "tenant", input.Slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
		return
	}

	var userID string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO users (email, display_name)
		VALUES ($1, $2)
		ON CONFLICT (email) DO NOTHING
		RETURNING id::text
	`, input.OwnerEmail, input.OwnerDisplayName).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		if err := tx.QueryRow(r.Context(), `SELECT id::text FROM users WHERE email = $1`, input.OwnerEmail).Scan(&userID); err != nil {
			app.log.Error("load tenant owner", "error", err, "tenant", input.Slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
			return
		}
	} else if err != nil {
		app.log.Error("create tenant owner", "error", err, "tenant", input.Slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
		return
	} else {
		if len([]rune(input.OwnerPassword)) < 12 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "new tenant owner password must be at least 12 characters"})
			return
		}
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.OwnerPassword), bcrypt.DefaultCost)
		if err != nil {
			app.log.Error("hash tenant owner password", "error", err, "tenant", input.Slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
			return
		}
		if _, err := tx.Exec(r.Context(), `INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, userID, string(passwordHash)); err != nil {
			app.log.Error("create tenant owner credentials", "error", err, "tenant", input.Slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
			return
		}
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`, tenantID, userID); err != nil {
		app.log.Error("create tenant owner membership", "error", err, "tenant", input.Slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
		return
	}
	if _, err := ensureSystemActor(r.Context(), tx, tenantID); err != nil {
		app.log.Error("create tenant system actor", "error", err, "tenant", input.Slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		app.log.Error("commit tenant provision", "error", err, "tenant", input.Slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not provision tenant"})
		return
	}
	writeJSON(w, http.StatusCreated, provisionTenantResponse{Slug: input.Slug, Name: input.Name, SubscriptionStatus: input.SubscriptionStatus, OwnerEmail: input.OwnerEmail})
}

func (app *application) updateSubscription(w http.ResponseWriter, r *http.Request) {
	if !app.authorizedSaaSControl(r) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "subscription control is unavailable"})
		return
	}

	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	var input updateSubscriptionRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid subscription payload"})
		return
	}
	input.Status = strings.TrimSpace(input.Status)
	input.Reason = strings.TrimSpace(input.Reason)
	input.ExternalEventID = strings.TrimSpace(input.ExternalEventID)
	if !isSubscriptionStatus(input.Status) || len([]rune(input.Reason)) > 1_000 || len([]rune(input.ExternalEventID)) > 200 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "valid subscription status, reason and event id are required"})
		return
	}

	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.log.Error("start subscription update", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update subscription"})
		return
	}
	defer tx.Rollback(r.Context())

	if input.ExternalEventID != "" {
		var existingStatus string
		err = tx.QueryRow(r.Context(), `
			SELECT next_status FROM subscription_events
			WHERE tenant_id = $1 AND external_event_id = $2
		`, tenant.ID, input.ExternalEventID).Scan(&existingStatus)
		if err == nil {
			if err := tx.Commit(r.Context()); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update subscription"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"subscriptionStatus": existingStatus, "replayed": true})
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			app.log.Error("check subscription event", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update subscription"})
			return
		}
	}

	if _, err := tx.Exec(r.Context(), `UPDATE tenants SET subscription_status = $1, updated_at = now() WHERE id = $2`, input.Status, tenant.ID); err != nil {
		app.log.Error("set subscription status", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update subscription"})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO subscription_events (tenant_id, external_event_id, previous_status, next_status, reason)
		VALUES ($1, NULLIF($2, ''), $3, $4, NULLIF($5, ''))
	`, tenant.ID, input.ExternalEventID, tenant.SubscriptionStatus, input.Status, input.Reason); err != nil {
		app.log.Error("record subscription event", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update subscription"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		app.log.Error("commit subscription update", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update subscription"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"subscriptionStatus": input.Status, "replayed": false})
}

func isSubscriptionStatus(status string) bool {
	return status == "trial" || status == "active" || status == "past_due" || status == "suspended"
}

func (app *application) writeResourceLookupError(w http.ResponseWriter, err error, resource string) {
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("selected %s is unavailable", resource)})
		return
	}
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "22P02" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("selected %s is invalid", resource)})
		return
	}
	app.log.Error("load trip resource", "error", err, "resource", resource)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create trip"})
}

type customerResponse struct {
	ID            string                    `json:"id"`
	FullName      string                    `json:"fullName"`
	Phone         string                    `json:"phone"`
	Email         string                    `json:"email,omitempty"`
	TelegramID    *int64                    `json:"telegramId,omitempty"`
	Notes         string                    `json:"notes,omitempty"`
	CustomData    map[string]any            `json:"customData,omitempty"`
	CreatedAt     time.Time                 `json:"createdAt"`
	TripCount     int64                     `json:"tripCount"`
	LifetimeValue []customerRevenueResponse `json:"lifetimeValue"`
}

type customerRevenueResponse struct {
	Currency    string `json:"currency"`
	AmountMinor int64  `json:"amountMinor"`
}

type customerBookingHistoryResponse struct {
	ID          string    `json:"id"`
	Status      string    `json:"status"`
	Origin      string    `json:"origin"`
	Destination string    `json:"destination"`
	StartsAt    time.Time `json:"startsAt"`
	Seats       int16     `json:"seats"`
	PriceMinor  int64     `json:"priceMinor"`
	Currency    string    `json:"currency"`
}

type customFieldResponse struct {
	ID         string   `json:"id"`
	EntityType string   `json:"entityType"`
	Key        string   `json:"key"`
	Label      string   `json:"label"`
	FieldType  string   `json:"fieldType"`
	Options    []string `json:"options"`
	IsRequired bool     `json:"isRequired"`
	IsActive   bool     `json:"isActive"`
	Position   int16    `json:"position"`
}

type customFieldInput struct {
	EntityType string   `json:"entityType"`
	Key        string   `json:"key"`
	Label      string   `json:"label"`
	FieldType  string   `json:"fieldType"`
	Options    []string `json:"options"`
	IsRequired bool     `json:"isRequired"`
	IsActive   bool     `json:"isActive"`
}

var customFieldKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{1,62}$`)

var reservedBookingCustomFieldKeys = map[string]struct{}{
	"passenger_name":       {},
	"passenger_phone":      {},
	"passenger_birth_date": {},
	"passengers":           {},
	"payment_method":       {},
}

func isCustomFieldEntity(entity string) bool {
	return entity == "customer" || entity == "trip" || entity == "booking"
}

func isCustomFieldType(fieldType string) bool {
	return fieldType == "text" || fieldType == "number" || fieldType == "date" || fieldType == "boolean" || fieldType == "select"
}

func normalizeCustomFieldInput(input *customFieldInput) bool {
	input.EntityType = strings.TrimSpace(input.EntityType)
	input.Key = strings.ToLower(strings.TrimSpace(input.Key))
	input.Label = strings.TrimSpace(input.Label)
	input.FieldType = strings.TrimSpace(input.FieldType)
	if !isCustomFieldEntity(input.EntityType) || isReservedBookingCustomFieldKey(input.EntityType, input.Key) || !customFieldKeyPattern.MatchString(input.Key) || len([]rune(input.Label)) == 0 || len([]rune(input.Label)) > 120 || !isCustomFieldType(input.FieldType) || len(input.Options) > 40 {
		return false
	}
	seen := make(map[string]struct{}, len(input.Options))
	normalizedOptions := make([]string, 0, len(input.Options))
	for _, option := range input.Options {
		option = strings.TrimSpace(option)
		if option == "" || len([]rune(option)) > 120 {
			return false
		}
		key := strings.ToLower(option)
		if _, exists := seen[key]; exists {
			return false
		}
		seen[key] = struct{}{}
		normalizedOptions = append(normalizedOptions, option)
	}
	input.Options = normalizedOptions
	return (input.FieldType == "select" && len(input.Options) >= 1) || (input.FieldType != "select" && len(input.Options) == 0)
}

func isReservedBookingCustomFieldKey(entity, key string) bool {
	if entity != "booking" {
		return false
	}
	_, reserved := reservedBookingCustomFieldKeys[key]
	return reserved
}

func scanCustomField(row pgx.Row) (customFieldResponse, error) {
	var field customFieldResponse
	var options []byte
	err := row.Scan(&field.ID, &field.EntityType, &field.Key, &field.Label, &field.FieldType, &options, &field.IsRequired, &field.IsActive, &field.Position)
	if err != nil {
		return customFieldResponse{}, err
	}
	if err := json.Unmarshal(options, &field.Options); err != nil {
		return customFieldResponse{}, err
	}
	return field, nil
}

func (app *application) listCustomFields(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	entity := strings.TrimSpace(r.URL.Query().Get("entity"))
	if entity == "" {
		entity = "customer"
	}
	if !isCustomFieldEntity(entity) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "entity must be customer, trip or booking"})
		return
	}

	rows, err := app.db.Query(r.Context(), `
		SELECT id::text, entity_type, field_key, label, field_type, options, is_required, is_active, position
		FROM custom_field_definitions
		WHERE tenant_id = $1 AND entity_type = $2
		ORDER BY position, created_at
	`, tenant.ID, entity)
	if err != nil {
		app.log.Error("list custom fields", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load custom fields"})
		return
	}
	defer rows.Close()
	items := make([]customFieldResponse, 0)
	for rows.Next() {
		field, err := scanCustomField(rows)
		if err != nil {
			app.log.Error("scan custom field", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load custom fields"})
			return
		}
		items = append(items, field)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate custom fields", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load custom fields"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (app *application) createCustomField(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input customFieldInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || !normalizeCustomFieldInput(&input) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "valid custom field data are required"})
		return
	}
	options, _ := json.Marshal(input.Options)
	field, err := scanCustomField(app.db.QueryRow(r.Context(), `
		INSERT INTO custom_field_definitions (tenant_id, entity_type, field_key, label, field_type, options, is_required, is_active, position)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE((SELECT MAX(position) + 1 FROM custom_field_definitions WHERE tenant_id = $1 AND entity_type = $2), 0))
		RETURNING id::text, entity_type, field_key, label, field_type, options, is_required, is_active, position
	`, tenant.ID, input.EntityType, input.Key, input.Label, input.FieldType, options, input.IsRequired, input.IsActive))
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "custom field key already exists for this entity"})
			return
		}
		app.log.Error("create custom field", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create custom field"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"item": field})
}

func (app *application) updateCustomField(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	fieldID := strings.TrimSpace(r.PathValue("fieldID"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input customFieldInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || !normalizeCustomFieldInput(&input) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "valid custom field data are required"})
		return
	}
	var existingType string
	err := app.db.QueryRow(r.Context(), `
		SELECT field_type FROM custom_field_definitions WHERE id = $1 AND tenant_id = $2 AND entity_type = $3 AND field_key = $4
	`, fieldID, tenant.ID, input.EntityType, input.Key).Scan(&existingType)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "custom field not found"})
		return
	}
	if err != nil {
		app.log.Error("load custom field", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update custom field"})
		return
	}
	if existingType != input.FieldType {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "field type cannot change after creation"})
		return
	}
	options, _ := json.Marshal(input.Options)
	field, err := scanCustomField(app.db.QueryRow(r.Context(), `
		UPDATE custom_field_definitions
		SET label = $1, options = $2, is_required = $3, is_active = $4, updated_at = now()
		WHERE id = $5 AND tenant_id = $6
		RETURNING id::text, entity_type, field_key, label, field_type, options, is_required, is_active, position
	`, input.Label, options, input.IsRequired, input.IsActive, fieldID, tenant.ID))
	if err != nil {
		app.log.Error("update custom field", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update custom field"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": field})
}

type customFieldDefinition struct {
	Key        string
	Label      string
	FieldType  string
	Options    []string
	IsRequired bool
}

func normalizeImportHeader(value string) string {
	value = strings.TrimPrefix(value, "\ufeff")
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(value))), " ")
}

func (app *application) loadCustomerImportFields(ctx context.Context, tenantID string) ([]customFieldDefinition, error) {
	rows, err := app.db.Query(ctx, `
		SELECT field_key, label, field_type, options, is_required
		FROM custom_field_definitions
		WHERE tenant_id = $1 AND entity_type = 'customer' AND is_active
		ORDER BY position, created_at
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	definitions := make([]customFieldDefinition, 0)
	for rows.Next() {
		var definition customFieldDefinition
		var options []byte
		if err := rows.Scan(&definition.Key, &definition.Label, &definition.FieldType, &options, &definition.IsRequired); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(options, &definition.Options); err != nil {
			return nil, err
		}
		definitions = append(definitions, definition)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return definitions, nil
}

func importCustomerCustomData(row customerimport.Row, definitions []customFieldDefinition) (map[string]any, error) {
	data := make(map[string]any)
	for _, definition := range definitions {
		value := strings.TrimSpace(row.Columns[normalizeImportHeader(definition.Key)])
		if value == "" {
			value = strings.TrimSpace(row.Columns[normalizeImportHeader(definition.Label)])
		}
		if value == "" {
			if definition.IsRequired {
				return nil, fmt.Errorf("обязательное поле %q не заполнено", definition.Label)
			}
			continue
		}
		switch definition.FieldType {
		case "text":
			if len([]rune(value)) > 4_000 {
				return nil, fmt.Errorf("поле %q длиннее 4000 символов", definition.Label)
			}
			data[definition.Key] = value
		case "number":
			parsed, parseErr := strconv.ParseFloat(strings.ReplaceAll(value, ",", "."), 64)
			if parseErr != nil {
				return nil, fmt.Errorf("поле %q должно быть числом", definition.Label)
			}
			data[definition.Key] = parsed
		case "date":
			parsed, parseErr := time.Parse("2006-01-02", value)
			if parseErr != nil {
				parsed, parseErr = time.Parse("02.01.2006", value)
			}
			if parseErr != nil {
				return nil, fmt.Errorf("поле %q должно быть датой", definition.Label)
			}
			data[definition.Key] = parsed.Format("2006-01-02")
		case "boolean":
			switch strings.ToLower(value) {
			case "true", "1", "да", "yes", "y":
				data[definition.Key] = true
			case "false", "0", "нет", "no", "n":
				data[definition.Key] = false
			default:
				return nil, fmt.Errorf("поле %q должно быть да или нет", definition.Label)
			}
		case "select":
			matched := ""
			for _, option := range definition.Options {
				if strings.EqualFold(value, option) {
					matched = option
					break
				}
			}
			if matched == "" {
				return nil, fmt.Errorf("поле %q содержит недопустимый вариант", definition.Label)
			}
			data[definition.Key] = matched
		}
	}
	return data, nil
}

func (app *application) validateCustomData(ctx context.Context, tenantID, entity string, data map[string]any) (map[string]any, error) {
	if !isCustomFieldEntity(entity) {
		return nil, fmt.Errorf("custom field entity is invalid")
	}
	if data == nil {
		data = map[string]any{}
	}
	rows, err := app.db.Query(ctx, `
		SELECT field_key, label, field_type, options, is_required
		FROM custom_field_definitions
		WHERE tenant_id = $1 AND entity_type = $2 AND is_active
	`, tenantID, entity)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	definitions := make(map[string]customFieldDefinition)
	for rows.Next() {
		var definition customFieldDefinition
		var options []byte
		if err := rows.Scan(&definition.Key, &definition.Label, &definition.FieldType, &options, &definition.IsRequired); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(options, &definition.Options); err != nil {
			return nil, err
		}
		definitions[definition.Key] = definition
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	validated := make(map[string]any, len(data))
	for key, value := range data {
		if isReservedBookingCustomFieldKey(entity, key) {
			return nil, fmt.Errorf("custom field %q is reserved", key)
		}
		definition, exists := definitions[key]
		if !exists {
			return nil, fmt.Errorf("custom field %q is unavailable", key)
		}
		switch definition.FieldType {
		case "text":
			text, ok := value.(string)
			if !ok || len([]rune(strings.TrimSpace(text))) > 4_000 {
				return nil, fmt.Errorf("custom field %q must be text", key)
			}
			validated[key] = strings.TrimSpace(text)
		case "number":
			if _, ok := value.(float64); !ok {
				return nil, fmt.Errorf("custom field %q must be a number", key)
			}
			validated[key] = value
		case "date":
			date, ok := value.(string)
			if !ok {
				return nil, fmt.Errorf("custom field %q must be a date", key)
			}
			if _, err := time.Parse("2006-01-02", date); err != nil {
				return nil, fmt.Errorf("custom field %q must use YYYY-MM-DD", key)
			}
			validated[key] = date
		case "boolean":
			if _, ok := value.(bool); !ok {
				return nil, fmt.Errorf("custom field %q must be true or false", key)
			}
			validated[key] = value
		case "select":
			option, ok := value.(string)
			if !ok {
				return nil, fmt.Errorf("custom field %q must be selected", key)
			}
			matchesOption := false
			for _, available := range definition.Options {
				if option == available {
					matchesOption = true
					break
				}
			}
			if !matchesOption {
				return nil, fmt.Errorf("custom field %q has an invalid option", key)
			}
			validated[key] = option
		}
	}
	for key, definition := range definitions {
		if definition.IsRequired {
			value, exists := validated[key]
			if !exists || (definition.FieldType == "text" && value == "") {
				return nil, fmt.Errorf("custom field %q is required", key)
			}
		}
	}
	return validated, nil
}

func decodeCustomData(raw []byte) (map[string]any, error) {
	result := make(map[string]any)
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func decodeCustomerLifetimeValue(raw []byte) ([]customerRevenueResponse, error) {
	items := make([]customerRevenueResponse, 0)
	if len(raw) == 0 || string(raw) == "null" {
		return items, nil
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	for _, item := range items {
		if !validFinanceCurrency(item.Currency) || item.AmountMinor < 0 {
			return nil, errors.New("customer lifetime value is invalid")
		}
	}
	return items, nil
}

func (app *application) listCustomers(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	if slug == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant slug is required"})
		return
	}
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) > 120 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "search query is too long"})
		return
	}
	limit := boundedQueryInt(r, "limit", 25, 1, 100)
	offset := boundedQueryInt(r, "offset", 0, 0, 100_000)

	var total int
	if err := app.db.QueryRow(r.Context(), `
		SELECT count(*)
		FROM customers
		WHERE tenant_id = $1
		  AND ($2 = '' OR COALESCE(full_name, '') ILIKE '%' || $2 || '%' OR phone_e164 ILIKE '%' || $2 || '%' OR COALESCE(email, '') ILIKE '%' || $2 || '%')
	`, tenant.ID, query).Scan(&total); err != nil {
		app.log.Error("count customers", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customers"})
		return
	}

	rows, err := app.db.Query(r.Context(), `
		SELECT c.id::text, COALESCE(c.full_name, ''), c.phone_e164, COALESCE(c.email, ''), c.telegram_id, COALESCE(c.notes, ''), c.custom_data, c.created_at,
			COALESCE(trips.trip_count, 0), COALESCE(ltv.lifetime_value, '[]'::jsonb)
		FROM customers c
		LEFT JOIN LATERAL (
			SELECT COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'expired'))::bigint AS trip_count
			FROM bookings
			WHERE tenant_id = c.tenant_id AND customer_id = c.id
		) trips ON true
		LEFT JOIN LATERAL (
			SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', totals.currency, 'amountMinor', totals.amount_minor) ORDER BY totals.currency), '[]'::jsonb) AS lifetime_value
			FROM (
				SELECT currency, SUM(price_minor)::bigint AS amount_minor
				FROM bookings
				WHERE tenant_id = c.tenant_id AND customer_id = c.id AND status IN ('confirmed', 'completed')
				GROUP BY currency
			) totals
		) ltv ON true
		WHERE c.tenant_id = $1
		  AND ($2 = '' OR COALESCE(full_name, '') ILIKE '%' || $2 || '%' OR phone_e164 ILIKE '%' || $2 || '%' OR COALESCE(email, '') ILIKE '%' || $2 || '%')
		ORDER BY c.created_at DESC, c.id DESC
		LIMIT $3 OFFSET $4
	`, tenant.ID, query, limit, offset)
	if err != nil {
		app.log.Error("list customers", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customers"})
		return
	}
	defer rows.Close()

	items := make([]customerResponse, 0)
	for rows.Next() {
		var customer customerResponse
		var customData []byte
		var lifetimeValue []byte
		if err := rows.Scan(&customer.ID, &customer.FullName, &customer.Phone, &customer.Email, &customer.TelegramID, &customer.Notes, &customData, &customer.CreatedAt, &customer.TripCount, &lifetimeValue); err != nil {
			app.log.Error("scan customer", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customers"})
			return
		}
		customer.CustomData, err = decodeCustomData(customData)
		if err != nil {
			app.log.Error("decode customer custom data", "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customers"})
			return
		}
		customer.LifetimeValue, err = decodeCustomerLifetimeValue(lifetimeValue)
		if err != nil {
			app.log.Error("decode customer lifetime value", "error", err, "customer", customer.ID)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customers"})
			return
		}
		items = append(items, customer)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate customers", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customers"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "limit": limit, "offset": offset})
}

func (app *application) getCustomer(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	customerID := strings.TrimSpace(r.PathValue("customerID"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	if customerID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "customer is required"})
		return
	}

	var customer customerResponse
	var customData []byte
	err := app.db.QueryRow(r.Context(), `
		SELECT id::text, COALESCE(full_name, ''), phone_e164, COALESCE(email, ''), telegram_id, COALESCE(notes, ''), custom_data, created_at
		FROM customers WHERE id = $1 AND tenant_id = $2
	`, customerID, tenant.ID).Scan(&customer.ID, &customer.FullName, &customer.Phone, &customer.Email, &customer.TelegramID, &customer.Notes, &customData, &customer.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "customer not found"})
		return
	}
	if err != nil {
		app.log.Error("load customer", "error", err, "tenant", slug, "customer", customerID)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "customer is invalid"})
		return
	}
	customer.CustomData, err = decodeCustomData(customData)
	if err != nil {
		app.log.Error("decode customer custom data", "error", err, "tenant", slug, "customer", customerID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customer"})
		return
	}

	if err := app.db.QueryRow(r.Context(), `
		SELECT COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'expired'))::bigint
		FROM bookings WHERE tenant_id = $1 AND customer_id = $2
	`, tenant.ID, customerID).Scan(&customer.TripCount); err != nil {
		app.log.Error("load customer trip count", "error", err, "tenant", slug, "customer", customerID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customer"})
		return
	}
	var lifetimeValue []byte
	if err := app.db.QueryRow(r.Context(), `
		SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', totals.currency, 'amountMinor', totals.amount_minor) ORDER BY totals.currency), '[]'::jsonb)
		FROM (
			SELECT currency, SUM(price_minor)::bigint AS amount_minor
			FROM bookings
			WHERE tenant_id = $1 AND customer_id = $2 AND status IN ('confirmed', 'completed')
			GROUP BY currency
		) totals
	`, tenant.ID, customerID).Scan(&lifetimeValue); err != nil {
		app.log.Error("load customer lifetime value", "error", err, "tenant", slug, "customer", customerID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customer"})
		return
	}
	customer.LifetimeValue, err = decodeCustomerLifetimeValue(lifetimeValue)
	if err != nil {
		app.log.Error("decode customer lifetime value", "error", err, "tenant", slug, "customer", customerID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customer"})
		return
	}

	rows, err := app.db.Query(r.Context(), `
		SELECT b.id::text, b.status::text, t.origin_name, t.destination_name, t.starts_at, b.seats, b.price_minor, b.currency
		FROM bookings b
		JOIN trips t ON t.id = b.trip_id AND t.tenant_id = b.tenant_id
		WHERE b.tenant_id = $1 AND b.customer_id = $2
		ORDER BY t.starts_at DESC, b.created_at DESC
		LIMIT 100
	`, tenant.ID, customerID)
	if err != nil {
		app.log.Error("load customer booking history", "error", err, "tenant", slug, "customer", customerID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customer"})
		return
	}
	defer rows.Close()
	history := make([]customerBookingHistoryResponse, 0)
	for rows.Next() {
		var booking customerBookingHistoryResponse
		if err := rows.Scan(&booking.ID, &booking.Status, &booking.Origin, &booking.Destination, &booking.StartsAt, &booking.Seats, &booking.PriceMinor, &booking.Currency); err != nil {
			app.log.Error("scan customer booking history", "error", err, "tenant", slug, "customer", customerID)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customer"})
			return
		}
		history = append(history, booking)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate customer booking history", "error", err, "tenant", slug, "customer", customerID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load customer"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"item": customer, "bookingHistory": history})
}

func (app *application) exportCustomers(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	if slug == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant slug is required"})
		return
	}
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	fields, err := app.loadCustomerExportFields(r.Context(), tenant.ID)
	if err != nil {
		app.log.Error("load customer export fields", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not prepare customer export"})
		return
	}
	records, err := app.loadCustomerExportRecords(r.Context(), tenant.ID)
	if err != nil {
		app.log.Error("load customer export records", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not prepare customer export"})
		return
	}
	workbook, err := customerexport.XLSX(fields, records)
	if err != nil {
		app.log.Error("build customer export", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not build customer export"})
		return
	}
	filename := fmt.Sprintf("%s-customers-%s.xlsx", slug, time.Now().UTC().Format("20060102"))
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(workbook); err != nil {
		app.log.Warn("write customer export", "error", err, "tenant", slug)
	}
}

func (app *application) loadCustomerExportFields(ctx context.Context, tenantID string) ([]customerexport.Field, error) {
	rows, err := app.db.Query(ctx, `
		SELECT field_key, label
		FROM custom_field_definitions
		WHERE tenant_id = $1 AND entity_type = 'customer'
		ORDER BY position, created_at
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := make([]customerexport.Field, 0)
	for rows.Next() {
		var field customerexport.Field
		if err := rows.Scan(&field.Key, &field.Label); err != nil {
			return nil, err
		}
		fields = append(fields, field)
	}
	return fields, rows.Err()
}

func (app *application) loadCustomerExportRecords(ctx context.Context, tenantID string) ([]customerexport.Record, error) {
	rows, err := app.db.Query(ctx, `
		SELECT COALESCE(full_name, ''), phone_e164, COALESCE(email, ''), COALESCE(telegram_id::text, ''), COALESCE(notes, ''), custom_data, created_at
		FROM customers
		WHERE tenant_id = $1
		ORDER BY created_at DESC, id DESC
	`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := make([]customerexport.Record, 0)
	for rows.Next() {
		var record customerexport.Record
		var customData []byte
		if err := rows.Scan(&record.FullName, &record.Phone, &record.Email, &record.TelegramID, &record.Notes, &customData, &record.CreatedAt); err != nil {
			return nil, err
		}
		data, err := decodeCustomData(customData)
		if err != nil {
			return nil, fmt.Errorf("decode customer custom data: %w", err)
		}
		record.CustomData = data
		records = append(records, record)
	}
	return records, rows.Err()
}

type createCustomerRequest struct {
	FullName   string         `json:"fullName"`
	Phone      string         `json:"phone"`
	Email      string         `json:"email"`
	TelegramID *int64         `json:"telegramId"`
	Notes      string         `json:"notes"`
	CustomData map[string]any `json:"customData"`
}

func (app *application) createCustomer(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	if slug == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant slug is required"})
		return
	}
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	var input createCustomerRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid customer payload"})
		return
	}
	input.FullName = strings.TrimSpace(input.FullName)
	input.Phone = normalizePhone(input.Phone)
	input.Email = strings.TrimSpace(strings.ToLower(input.Email))
	input.Notes = strings.TrimSpace(input.Notes)
	if input.Phone == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "phone must be a valid international number"})
		return
	}
	if len([]rune(input.FullName)) > 160 || len([]rune(input.Email)) > 320 || len([]rune(input.Notes)) > 4000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "customer fields are too long"})
		return
	}
	if input.Email != "" {
		parsed, err := mail.ParseAddress(input.Email)
		if err != nil || parsed.Address != input.Email {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email is invalid"})
			return
		}
	}
	customData, err := app.validateCustomData(r.Context(), tenant.ID, "customer", input.CustomData)
	if err != nil {
		app.log.Warn("invalid customer custom data", "error", err, "tenant", slug)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	encodedCustomData, err := json.Marshal(customData)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "custom field data are invalid"})
		return
	}

	var customer customerResponse
	var responseCustomData []byte
	err = app.db.QueryRow(r.Context(), `
		INSERT INTO customers (tenant_id, full_name, phone_e164, email, telegram_id, notes, custom_data)
		VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, ''), $5, NULLIF($6, ''), $7)
		RETURNING id::text, COALESCE(full_name, ''), phone_e164, COALESCE(email, ''), telegram_id, COALESCE(notes, ''), custom_data, created_at
	`, tenant.ID, input.FullName, input.Phone, input.Email, input.TelegramID, input.Notes, encodedCustomData).Scan(
		&customer.ID, &customer.FullName, &customer.Phone, &customer.Email, &customer.TelegramID, &customer.Notes, &responseCustomData, &customer.CreatedAt,
	)
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "customer with this phone already exists"})
			return
		}
		app.log.Error("create customer", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create customer"})
		return
	}
	customer.CustomData, err = decodeCustomData(responseCustomData)
	if err != nil {
		app.log.Error("decode created customer custom data", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create customer"})
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"item": customer})
}

func (app *application) updateCustomer(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	customerID := strings.TrimSpace(r.PathValue("customerID"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}

	var input createCustomerRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid customer payload"})
		return
	}
	input.FullName = strings.TrimSpace(input.FullName)
	input.Phone = normalizePhone(input.Phone)
	input.Email = strings.TrimSpace(strings.ToLower(input.Email))
	input.Notes = strings.TrimSpace(input.Notes)
	if input.Phone == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "phone must be a valid international number"})
		return
	}
	if len([]rune(input.FullName)) > 160 || len([]rune(input.Email)) > 320 || len([]rune(input.Notes)) > 4000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "customer fields are too long"})
		return
	}
	if input.Email != "" {
		parsed, err := mail.ParseAddress(input.Email)
		if err != nil || parsed.Address != input.Email {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email is invalid"})
			return
		}
	}
	customData, err := app.validateCustomData(r.Context(), tenant.ID, "customer", input.CustomData)
	if err != nil {
		app.log.Warn("invalid customer custom data", "error", err, "tenant", slug)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	encodedCustomData, err := json.Marshal(customData)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "custom field data are invalid"})
		return
	}

	var customer customerResponse
	var responseCustomData []byte
	err = app.db.QueryRow(r.Context(), `
		UPDATE customers
		SET full_name = NULLIF($1, ''), phone_e164 = $2, email = NULLIF($3, ''), telegram_id = $4,
			notes = NULLIF($5, ''), custom_data = $6, updated_at = now()
		WHERE id = $7 AND tenant_id = $8
		RETURNING id::text, COALESCE(full_name, ''), phone_e164, COALESCE(email, ''), telegram_id, COALESCE(notes, ''), custom_data, created_at
	`, input.FullName, input.Phone, input.Email, input.TelegramID, input.Notes, encodedCustomData, customerID, tenant.ID).Scan(
		&customer.ID, &customer.FullName, &customer.Phone, &customer.Email, &customer.TelegramID, &customer.Notes, &responseCustomData, &customer.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "customer not found"})
		return
	}
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "customer with this phone already exists"})
			return
		}
		app.log.Error("update customer", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update customer"})
		return
	}
	customer.CustomData, err = decodeCustomData(responseCustomData)
	if err != nil {
		app.log.Error("decode updated customer custom data", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update customer"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": customer})
}

type importIssue struct {
	Row     int    `json:"row"`
	Message string `json:"message"`
}
type importResult struct {
	Created int           `json:"created"`
	Updated int           `json:"updated"`
	Skipped int           `json:"skipped"`
	Issues  []importIssue `json:"issues"`
}

const maxImportIssues = 100

func (result *importResult) skip(row int, message string) {
	result.Skipped++
	if len(result.Issues) < maxImportIssues {
		result.Issues = append(result.Issues, importIssue{Row: row, Message: message})
	}
}

func (app *application) importCustomers(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file must be smaller than 10 MB"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "attach a CSV or XLSX file in field file"})
		return
	}
	defer file.Close()
	name := strings.ToLower(header.Filename)
	var rows []customerimport.Row
	if strings.HasSuffix(name, ".csv") {
		rows, err = customerimport.ReadCSV(file)
	} else if strings.HasSuffix(name, ".xlsx") {
		rows, err = customerimport.ReadXLSX(file)
	} else {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "only .csv and .xlsx are supported"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if len(rows) > 5000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "import is limited to 5000 rows"})
		return
	}
	customFields, err := app.loadCustomerImportFields(r.Context(), tenant.ID)
	if err != nil {
		app.log.Error("load customer import fields", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not start import"})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not start import"})
		return
	}
	defer tx.Rollback(r.Context())
	result := importResult{Issues: []importIssue{}}
	for _, row := range rows {
		customData, customDataErr := importCustomerCustomData(row, customFields)
		if customDataErr != nil {
			result.skip(row.Number, customDataErr.Error())
			continue
		}
		encodedCustomData, marshalErr := json.Marshal(customData)
		if marshalErr != nil {
			returnImportError(w, marshalErr)
			return
		}
		phone := normalizePhone(row.Phone)
		if phone == "" {
			result.skip(row.Number, "Некорректный международный номер телефона")
			continue
		}
		email := strings.TrimSpace(strings.ToLower(row.Email))
		if email != "" {
			parsed, parseErr := mail.ParseAddress(email)
			if parseErr != nil || parsed.Address != email {
				result.skip(row.Number, "Некорректный email")
				continue
			}
		}
		var telegramID *int64
		if value := strings.TrimSpace(row.TelegramID); value != "" {
			parsed, parseErr := strconv.ParseInt(value, 10, 64)
			if parseErr != nil || parsed <= 0 {
				result.skip(row.Number, "Некорректный Telegram ID")
				continue
			}
			telegramID = &parsed
		}
		var inserted bool
		err = tx.QueryRow(r.Context(), `INSERT INTO customers (tenant_id, full_name, phone_e164, email, telegram_id, notes, custom_data, imported_at) VALUES ($1,NULLIF($2,''),$3,NULLIF($4,''),$5,NULLIF($6,''),$7,now()) ON CONFLICT (tenant_id,phone_e164) DO UPDATE SET full_name=EXCLUDED.full_name,email=EXCLUDED.email,telegram_id=COALESCE(EXCLUDED.telegram_id,customers.telegram_id),notes=EXCLUDED.notes,custom_data=customers.custom_data || EXCLUDED.custom_data,imported_at=now(),updated_at=now() RETURNING (xmax = 0)`, tenant.ID, strings.TrimSpace(row.FullName), phone, email, telegramID, strings.TrimSpace(row.Notes), encodedCustomData).Scan(&inserted)
		if err != nil {
			returnImportError(w, err)
			return
		}
		if inserted {
			result.Created++
		} else {
			result.Updated++
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		returnImportError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func returnImportError(w http.ResponseWriter, err error) {
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not import customers"})
}

type createBookingRequest struct {
	TripID             string         `json:"tripId"`
	CustomerID         string         `json:"customerId"`
	Seats              int16          `json:"seats"`
	PassengerName      string         `json:"passengerName"`
	PassengerPhone     string         `json:"passengerPhone"`
	PassengerBirthDate string         `json:"passengerBirthDate"`
	CustomData         map[string]any `json:"customData"`
}

type bookingPassengerDetails struct {
	Name      string
	Phone     string
	BirthDate string
}

const maximumPassengerAgeYears = 125

func normalizeBookingPassengerDetails(name, phone, birthDate string, now time.Time) (bookingPassengerDetails, error) {
	name = strings.TrimSpace(name)
	phone = normalizePhone(phone)
	birthDate = strings.TrimSpace(birthDate)
	if name == "" || len([]rune(name)) > 160 || phone == "" {
		return bookingPassengerDetails{}, errors.New("passenger name and international phone are required")
	}
	parsedBirthDate, err := time.Parse("2006-01-02", birthDate)
	if err != nil {
		return bookingPassengerDetails{}, errors.New("passenger birth date must use YYYY-MM-DD")
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if parsedBirthDate.After(today) || parsedBirthDate.Before(today.AddDate(-maximumPassengerAgeYears, 0, 0)) {
		return bookingPassengerDetails{}, errors.New("passenger birth date is invalid")
	}
	return bookingPassengerDetails{
		Name:      name,
		Phone:     phone,
		BirthDate: parsedBirthDate.Format("2006-01-02"),
	}, nil
}

type bookingResponse struct {
	ID                   string         `json:"id"`
	TripID               string         `json:"tripId"`
	CustomerID           string         `json:"customerId"`
	Seats                int16          `json:"seats"`
	Status               string         `json:"status"`
	PriceMinor           int64          `json:"priceMinor"`
	Currency             string         `json:"currency"`
	PaymentHoldExpiresAt *time.Time     `json:"paymentHoldExpiresAt,omitempty"`
	CustomData           map[string]any `json:"customData,omitempty"`
}

type bookingListItem struct {
	ID                   string         `json:"id"`
	Status               string         `json:"status"`
	Seats                int16          `json:"seats"`
	PriceMinor           int64          `json:"priceMinor"`
	Currency             string         `json:"currency"`
	Source               string         `json:"source"`
	CreatedAt            time.Time      `json:"createdAt"`
	CustomerName         string         `json:"customerName"`
	CustomerPhone        string         `json:"customerPhone"`
	TripID               string         `json:"tripId"`
	TripStatus           string         `json:"tripStatus"`
	Origin               string         `json:"origin"`
	Destination          string         `json:"destination"`
	StartsAt             time.Time      `json:"startsAt"`
	Capacity             int16          `json:"capacity"`
	AvailableSeats       int            `json:"availableSeats"`
	PaymentID            string         `json:"paymentId,omitempty"`
	PaymentStatus        string         `json:"paymentStatus,omitempty"`
	PaymentMethod        string         `json:"paymentMethod,omitempty"`
	PaymentHoldExpiresAt *time.Time     `json:"paymentHoldExpiresAt,omitempty"`
	CustomData           map[string]any `json:"customData,omitempty"`
}

type updateBookingRequest struct {
	Status string `json:"status"`
}

type individualTransferRequestListItem struct {
	ID                   string    `json:"id"`
	CustomerID           string    `json:"customerId"`
	TelegramID           *int64    `json:"telegramId,omitempty"`
	Status               string    `json:"status"`
	Origin               string    `json:"origin"`
	Destination          string    `json:"destination"`
	RequestedDepartureAt time.Time `json:"requestedDepartureAt"`
	PassengerName        string    `json:"passengerName"`
	PassengerPhone       string    `json:"passengerPhone"`
	PassengerBirthDate   time.Time `json:"passengerBirthDate"`
	Seats                int16     `json:"seats"`
	Comment              string    `json:"comment,omitempty"`
	OperatorNote         string    `json:"operatorNote,omitempty"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type updateIndividualTransferRequestRequest struct {
	Status       string `json:"status"`
	OperatorNote string `json:"operatorNote"`
}

func validIndividualTransferRequestStatus(status string) bool {
	return status == "new" || status == "in_progress" || status == "closed" || status == "cancelled"
}

func canTransitionIndividualTransferRequest(current, next string) bool {
	if current == next {
		return true
	}
	return (current == "new" && (next == "in_progress" || next == "cancelled")) ||
		(current == "in_progress" && (next == "closed" || next == "cancelled"))
}

func (app *application) listIndividualTransferRequests(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && !validIndividualTransferRequestStatus(status) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "transfer request status is invalid"})
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) > 120 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "search query is too long"})
		return
	}
	limit := 100
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 200 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "limit must be between 1 and 200"})
			return
		}
		limit = parsed
	}
	rows, err := app.db.Query(r.Context(), `
		SELECT id::text, customer_id::text, telegram_id, status, origin_name, destination_name,
			requested_departure_at, passenger_name, passenger_phone_e164, passenger_birth_date,
			seats, COALESCE(comment, ''), COALESCE(operator_note, ''), created_at, updated_at, count(*) OVER()
		FROM individual_transfer_requests
		WHERE tenant_id = $1
		  AND ($2 = '' OR status = $2)
		  AND ($3 = '' OR origin_name ILIKE '%' || $3 || '%' OR destination_name ILIKE '%' || $3 || '%' OR passenger_name ILIKE '%' || $3 || '%' OR passenger_phone_e164 ILIKE '%' || $3 || '%')
		ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, requested_departure_at ASC, created_at DESC
		LIMIT $4
	`, tenant.ID, status, query, limit)
	if err != nil {
		app.log.Error("list individual transfer requests", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load individual transfer requests"})
		return
	}
	defer rows.Close()
	items := make([]individualTransferRequestListItem, 0)
	total := 0
	for rows.Next() {
		var item individualTransferRequestListItem
		if err := rows.Scan(&item.ID, &item.CustomerID, &item.TelegramID, &item.Status, &item.Origin, &item.Destination, &item.RequestedDepartureAt, &item.PassengerName, &item.PassengerPhone, &item.PassengerBirthDate, &item.Seats, &item.Comment, &item.OperatorNote, &item.CreatedAt, &item.UpdatedAt, &total); err != nil {
			app.log.Error("scan individual transfer request", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load individual transfer requests"})
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate individual transfer requests", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load individual transfer requests"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total, "timezone": tenant.Timezone})
}

func (app *application) updateIndividualTransferRequest(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	requestID := strings.TrimSpace(r.PathValue("requestID"))
	if requestID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "transfer request is required"})
		return
	}
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input updateIndividualTransferRequestRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "transfer request payload is invalid"})
		return
	}
	input.Status = strings.TrimSpace(input.Status)
	input.OperatorNote = strings.TrimSpace(input.OperatorNote)
	if !validIndividualTransferRequestStatus(input.Status) || len([]rune(input.OperatorNote)) > 2000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "transfer request update is invalid"})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update transfer request"})
		return
	}
	defer tx.Rollback(r.Context())
	var currentStatus string
	if err := tx.QueryRow(r.Context(), `SELECT status FROM individual_transfer_requests WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, requestID, tenant.ID).Scan(&currentStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "transfer request not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "transfer request id is invalid"})
		return
	}
	if !canTransitionIndividualTransferRequest(currentStatus, input.Status) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "transfer request status cannot be changed this way"})
		return
	}
	statusChanged := currentStatus != input.Status
	var item individualTransferRequestListItem
	err = tx.QueryRow(r.Context(), `
		UPDATE individual_transfer_requests
		SET status = $1, operator_note = NULLIF($2, ''),
			processed_at = CASE WHEN $1 IN ('closed', 'cancelled') THEN now() ELSE processed_at END,
			updated_at = now()
		WHERE id = $3 AND tenant_id = $4
		RETURNING id::text, customer_id::text, telegram_id, status, origin_name, destination_name,
			requested_departure_at, passenger_name, passenger_phone_e164, passenger_birth_date,
			seats, COALESCE(comment, ''), COALESCE(operator_note, ''), created_at, updated_at
	`, input.Status, input.OperatorNote, requestID, tenant.ID).Scan(&item.ID, &item.CustomerID, &item.TelegramID, &item.Status, &item.Origin, &item.Destination, &item.RequestedDepartureAt, &item.PassengerName, &item.PassengerPhone, &item.PassengerBirthDate, &item.Seats, &item.Comment, &item.OperatorNote, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		app.log.Error("update individual transfer request", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update transfer request"})
		return
	}
	if statusChanged && item.TelegramID != nil {
		payload, err := json.Marshal(telegramoutbox.IndividualTransferRequestPayload{
			Status:               item.Status,
			Origin:               item.Origin,
			Destination:          item.Destination,
			RequestedDepartureAt: item.RequestedDepartureAt,
		})
		if err != nil {
			app.log.Error("encode individual transfer request notification", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update transfer request"})
			return
		}
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO telegram_notification_outbox (tenant_id, chat_id, kind, payload)
			VALUES ($1, $2, $3, $4::jsonb)
		`, tenant.ID, *item.TelegramID, telegramoutbox.KindIndividualTransferRequest, payload); err != nil {
			app.log.Error("queue individual transfer request notification", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update transfer request"})
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		app.log.Error("commit individual transfer request", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update transfer request"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}

func (app *application) listBookings(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && status != "pending" && status != "awaiting_payment" && status != "cash_on_boarding" && status != "confirmed" && status != "cancelled" && status != "completed" && status != "expired" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "booking status is invalid"})
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) > 120 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "search query is too long"})
		return
	}
	day := strings.TrimSpace(r.URL.Query().Get("date"))
	if day != "" {
		if _, err := time.Parse("2006-01-02", day); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "date must use YYYY-MM-DD"})
			return
		}
	}
	limit := 100
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 200 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "limit must be between 1 and 200"})
			return
		}
		limit = parsed
	}
	if _, err := app.db.Exec(r.Context(), `UPDATE bookings SET status = 'expired', updated_at = now() WHERE tenant_id = $1 AND status = 'awaiting_payment' AND payment_hold_expires_at <= now()`, tenant.ID); err != nil {
		app.log.Error("expire booking holds", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load bookings"})
		return
	}
	rows, err := app.db.Query(r.Context(), `
		SELECT b.id::text, b.status::text, b.seats, b.price_minor, b.currency, b.source, b.created_at, b.custom_data,
			COALESCE(c.full_name, ''), c.phone_e164,
			t.id::text, t.status::text, t.origin_name, t.destination_name, t.starts_at, t.capacity,
			GREATEST(t.capacity - COALESCE((SELECT sum(occupied.seats) FROM bookings occupied WHERE occupied.trip_id = t.id AND (occupied.status IN ('pending', 'cash_on_boarding', 'confirmed') OR (occupied.status = 'awaiting_payment' AND occupied.payment_hold_expires_at > now()))), 0), 0),
			COALESCE(payment.id::text, ''), COALESCE(payment.status::text, ''), COALESCE(payment.payment_method, ''), b.payment_hold_expires_at, count(*) OVER()
		FROM bookings b
		JOIN customers c ON c.id = b.customer_id
		JOIN trips t ON t.id = b.trip_id
		LEFT JOIN LATERAL (
			SELECT id, status, payment_method FROM payments
			WHERE booking_id = b.id ORDER BY created_at DESC LIMIT 1
		) payment ON true
		WHERE b.tenant_id = $1
		  AND ($2 = '' OR b.status::text = $2)
		  AND ($3 = '' OR b.id::text ILIKE '%' || $3 || '%' OR COALESCE(c.full_name, '') ILIKE '%' || $3 || '%' OR c.phone_e164 ILIKE '%' || $3 || '%' OR t.origin_name ILIKE '%' || $3 || '%' OR t.destination_name ILIKE '%' || $3 || '%'
		    OR COALESCE(b.custom_data->>'passenger_name','') ILIKE '%' || $3 || '%' OR COALESCE(b.custom_data->>'passenger_phone','') ILIKE '%' || $3 || '%'
		    OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.custom_data->'passengers')='array' THEN b.custom_data->'passengers' ELSE '[]'::jsonb END) person WHERE concat_ws(' ',person->>'firstName',person->>'lastName') ILIKE '%' || $3 || '%'))
		  AND ($4 = '' OR (t.starts_at AT TIME ZONE $5)::date = $4::date)
		ORDER BY t.starts_at DESC, b.created_at DESC
		LIMIT $6
	`, tenant.ID, status, query, day, tenant.Timezone, limit)
	if err != nil {
		app.log.Error("list bookings", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load bookings"})
		return
	}
	defer rows.Close()
	items := make([]bookingListItem, 0)
	var total int
	for rows.Next() {
		var item bookingListItem
		var customData []byte
		if err := rows.Scan(&item.ID, &item.Status, &item.Seats, &item.PriceMinor, &item.Currency, &item.Source, &item.CreatedAt, &customData, &item.CustomerName, &item.CustomerPhone, &item.TripID, &item.TripStatus, &item.Origin, &item.Destination, &item.StartsAt, &item.Capacity, &item.AvailableSeats, &item.PaymentID, &item.PaymentStatus, &item.PaymentMethod, &item.PaymentHoldExpiresAt, &total); err != nil {
			app.log.Error("scan booking", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load bookings"})
			return
		}
		item.CustomData, err = decodeCustomData(customData)
		if err != nil {
			app.log.Error("decode booking custom data", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load bookings"})
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate bookings", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load bookings"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "timezone": tenant.Timezone, "total": total})
}

func (app *application) createBooking(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input createBookingRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || strings.TrimSpace(input.TripID) == "" || strings.TrimSpace(input.CustomerID) == "" || input.Seats < 1 || input.Seats > 20 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trip, customer and seats are required"})
		return
	}
	passenger, err := normalizeBookingPassengerDetails(input.PassengerName, input.PassengerPhone, input.PassengerBirthDate, time.Now().UTC())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	customData, err := app.validateCustomData(r.Context(), tenant.ID, "booking", input.CustomData)
	if err != nil {
		app.log.Warn("invalid booking custom data", "error", err, "tenant", slug)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	customData["passenger_name"] = passenger.Name
	customData["passenger_phone"] = passenger.Phone
	customData["passenger_birth_date"] = passenger.BirthDate
	encodedCustomData, err := json.Marshal(customData)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "custom field data are invalid"})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create booking"})
		return
	}
	defer tx.Rollback(r.Context())
	var capacity int16
	var status string
	var priceMinor int64
	var pricingMode string
	var currency string
	err = tx.QueryRow(r.Context(), `SELECT capacity, status::text, price_minor, currency, pricing_mode FROM trips WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, input.TripID, tenant.ID).Scan(&capacity, &status, &priceMinor, &currency, &pricingMode)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "trip not found"})
		} else {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trip id is invalid"})
		}
		return
	}
	if !canCreateBookingForTripStatus(status) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "booking is unavailable for this trip"})
		return
	}
	var customerExists bool
	if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM customers WHERE id=$1 AND tenant_id=$2)`, input.CustomerID, tenant.ID).Scan(&customerExists); err != nil || !customerExists {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "customer is unavailable"})
		return
	}
	var occupied int
	if err := tx.QueryRow(r.Context(), `SELECT COALESCE(sum(seats),0) FROM bookings WHERE trip_id=$1 AND (status IN ('pending','cash_on_boarding','confirmed') OR (status = 'awaiting_payment' AND payment_hold_expires_at > now()))`, input.TripID).Scan(&occupied); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create booking"})
		return
	}
	if occupied+int(input.Seats) > int(capacity) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "not enough available seats"})
		return
	}
	bookingPrice, ok := priceForBooking(priceMinor, input.Seats, pricingMode)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "booking price is too large"})
		return
	}
	var booking bookingResponse
	var responseCustomData []byte
	err = tx.QueryRow(r.Context(), `INSERT INTO bookings (tenant_id,trip_id,customer_id,status,seats,price_minor,currency,source,custom_data) VALUES ($1,$2,$3,'cash_on_boarding',$4,$5,$6,'dispatcher',$7) RETURNING id::text,trip_id::text,customer_id::text,seats,status::text,price_minor,currency,custom_data`, tenant.ID, input.TripID, input.CustomerID, input.Seats, bookingPrice, currency, encodedCustomData).Scan(&booking.ID, &booking.TripID, &booking.CustomerID, &booking.Seats, &booking.Status, &booking.PriceMinor, &booking.Currency, &responseCustomData)
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" && pgError.ConstraintName == "bookings_one_active_per_customer_trip_idx" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "customer already has an active booking for this trip"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create booking"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create booking"})
		return
	}
	booking.CustomData, err = decodeCustomData(responseCustomData)
	if err != nil {
		app.log.Error("decode created booking custom data", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create booking"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"item": booking, "availableSeats": int(capacity) - occupied - int(input.Seats)})
}

func canCreateBookingForTripStatus(status string) bool {
	return status == "new" || status == "assigned"
}

func (app *application) updateBooking(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	bookingID := strings.TrimSpace(r.PathValue("bookingID"))
	if bookingID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "booking is required"})
		return
	}
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input updateBookingRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || strings.TrimSpace(input.Status) != "cancelled" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "only cancellation is supported for a booking"})
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update booking"})
		return
	}
	defer tx.Rollback(r.Context())
	var currentStatus, tripStatus, tripID string
	var capacity int16
	err = tx.QueryRow(r.Context(), `
		SELECT b.status::text, t.status::text, t.id::text, t.capacity
		FROM bookings b JOIN trips t ON t.id = b.trip_id
		WHERE b.id = $1 AND b.tenant_id = $2
		FOR UPDATE OF b, t
	`, bookingID, tenant.ID).Scan(&currentStatus, &tripStatus, &tripID, &capacity)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "booking not found"})
		return
	}
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "22P02" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "booking id is invalid"})
		} else {
			app.log.Error("load booking", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update booking"})
		}
		return
	}
	if currentStatus == "cancelled" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "booking is already cancelled"})
		return
	}
	if currentStatus == "completed" || tripStatus == "in_progress" || tripStatus == "completed" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "booking cannot be cancelled after the trip has started"})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		UPDATE payments SET status = 'cancelled', updated_at = now()
		WHERE booking_id = $1 AND tenant_id = $2 AND status IN ('pending', 'authorized')
	`, bookingID, tenant.ID); err != nil {
		app.log.Error("cancel pending booking payments", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update booking"})
		return
	}
	var booking bookingResponse
	err = tx.QueryRow(r.Context(), `
		UPDATE bookings SET status = 'cancelled', payment_hold_expires_at = NULL, updated_at = now()
		WHERE id = $1 AND tenant_id = $2
		RETURNING id::text, trip_id::text, customer_id::text, seats, status::text, price_minor, currency
	`, bookingID, tenant.ID).Scan(&booking.ID, &booking.TripID, &booking.CustomerID, &booking.Seats, &booking.Status, &booking.PriceMinor, &booking.Currency)
	if err != nil {
		app.log.Error("cancel booking", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update booking"})
		return
	}
	var occupied int
	if err := tx.QueryRow(r.Context(), `SELECT COALESCE(sum(seats), 0) FROM bookings WHERE trip_id = $1 AND (status IN ('pending', 'cash_on_boarding', 'confirmed') OR (status = 'awaiting_payment' AND payment_hold_expires_at > now()))`, tripID).Scan(&occupied); err != nil {
		app.log.Error("count booking seats", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update booking"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		app.log.Error("commit cancelled booking", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update booking"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": booking, "availableSeats": int(capacity) - occupied})
}

func (app *application) confirmBookingPayment(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	bookingID := strings.TrimSpace(r.PathValue("bookingID"))
	if bookingID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "booking is required"})
		return
	}
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	tx, err := app.db.Begin(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm payment"})
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `
		UPDATE bookings SET status = 'expired', updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND status = 'awaiting_payment' AND payment_hold_expires_at <= now()
	`, bookingID, tenant.ID); err != nil {
		app.log.Error("expire booking payment hold", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm payment"})
		return
	}
	var status string
	if err := tx.QueryRow(r.Context(), `SELECT status::text FROM bookings WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, bookingID, tenant.ID).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "booking not found"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "booking id is invalid"})
		return
	}
	if status != "awaiting_payment" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "only an active bank-transfer hold can be confirmed"})
		return
	}
	var paymentID string
	err = tx.QueryRow(r.Context(), `
		UPDATE payments
		SET status = 'paid', paid_at = now(), updated_at = now()
		WHERE booking_id = $1 AND tenant_id = $2 AND provider = 'internal'
		  AND status = 'pending' AND payment_method = 'bank_transfer'
		RETURNING id::text
	`, bookingID, tenant.ID).Scan(&paymentID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "a pending bank transfer was not found for this booking"})
		return
	}
	if err != nil {
		app.log.Error("mark booking payment paid", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm payment"})
		return
	}
	var booking bookingResponse
	err = tx.QueryRow(r.Context(), `
		UPDATE bookings SET status = 'confirmed', payment_hold_expires_at = NULL, updated_at = now()
		WHERE id = $1 AND tenant_id = $2
		RETURNING id::text, trip_id::text, customer_id::text, seats, status::text, price_minor, currency, payment_hold_expires_at
	`, bookingID, tenant.ID).Scan(&booking.ID, &booking.TripID, &booking.CustomerID, &booking.Seats, &booking.Status, &booking.PriceMinor, &booking.Currency, &booking.PaymentHoldExpiresAt)
	if err != nil {
		app.log.Error("confirm booking", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm payment"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm payment"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": booking, "paymentId": paymentID})
}

type gpsPointRequest struct {
	ClientPointID  string     `json:"clientPointId"`
	MembershipID   string     `json:"membershipId"`
	VehicleID      string     `json:"vehicleId"`
	TripID         string     `json:"tripId"`
	Latitude       float64    `json:"latitude"`
	Longitude      float64    `json:"longitude"`
	AccuracyMeters *float64   `json:"accuracyMeters"`
	RecordedAt     *time.Time `json:"recordedAt"`
}

func (app *application) recordGPSPoint(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input gpsPointRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || !validGPSPoint(input, time.Now()) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "vehicle and valid coordinates are required"})
		return
	}
	actor, _ := identityFromContext(r.Context())
	if input.MembershipID != "" && input.MembershipID != actor.MembershipID {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "GPS membership no longer matches the session"})
		return
	}
	var vehicleExists bool
	if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM vehicles WHERE id=$1 AND tenant_id=$2 AND is_active)`, input.VehicleID, tenant.ID).Scan(&vehicleExists); err != nil {
		app.log.Error("check GPS vehicle", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "could not check GPS vehicle; retry later"})
		return
	}
	if !vehicleExists {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "vehicle is unavailable"})
		return
	}
	driverID := ""
	if actor, authenticated := identityFromContext(r.Context()); authenticated && actor.Role == "driver" {
		var err error
		driverID, err = app.activeDriverID(r.Context(), tenant.ID, actor.MembershipID)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "driver profile is not connected to this account"})
			return
		}
		if err != nil {
			app.log.Error("load driver profile", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not record location"})
			return
		}
		if strings.TrimSpace(input.TripID) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a driver must transmit GPS for an assigned trip"})
			return
		}
	}
	if input.TripID != "" {
		var tripExists bool
		if err := app.db.QueryRow(r.Context(), `
			SELECT EXISTS(
				SELECT 1 FROM trips
				WHERE id=$1 AND tenant_id=$2 AND vehicle_id=$3
				  AND (NULLIF($4, '')::uuid IS NULL OR (driver_id = NULLIF($4, '')::uuid AND status IN ('assigned', 'in_progress')))
			)
		`, input.TripID, tenant.ID, input.VehicleID, driverID).Scan(&tripExists); err != nil {
			app.log.Error("check GPS trip", "error", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "could not check GPS trip; retry later"})
			return
		}
		if !tripExists {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trip is unavailable for this vehicle"})
			return
		}
	}
	recordedAt := time.Now().UTC()
	if input.RecordedAt != nil {
		recordedAt = input.RecordedAt.UTC()
		if recordedAt.After(time.Now().Add(5 * time.Minute)) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "recorded time cannot be in the future"})
			return
		}
	}
	var id int64
	err := app.db.QueryRow(r.Context(), `
		INSERT INTO gps_points (tenant_id,vehicle_id,trip_id,recorded_at,latitude,longitude,accuracy_meters,client_point_id,membership_id)
		VALUES ($1,$2,NULLIF($3,'')::uuid,$4,$5,$6,$7,NULLIF($8,'')::uuid,NULLIF($9,'')::uuid)
		ON CONFLICT (tenant_id, client_point_id) WHERE client_point_id IS NOT NULL
		DO UPDATE SET client_point_id = EXCLUDED.client_point_id
		WHERE gps_points.vehicle_id = EXCLUDED.vehicle_id
		  AND gps_points.trip_id IS NOT DISTINCT FROM EXCLUDED.trip_id
		  AND gps_points.membership_id IS NOT DISTINCT FROM EXCLUDED.membership_id
		  AND gps_points.recorded_at = EXCLUDED.recorded_at
		  AND gps_points.latitude = EXCLUDED.latitude AND gps_points.longitude = EXCLUDED.longitude
		  AND gps_points.accuracy_meters IS NOT DISTINCT FROM EXCLUDED.accuracy_meters
		RETURNING id
	`, tenant.ID, input.VehicleID, input.TripID, recordedAt, input.Latitude, input.Longitude, input.AccuracyMeters, input.ClientPointID, actor.MembershipID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "GPS point identifier was already used for different data"})
		return
	}
	if err != nil {
		app.log.Error("record gps", "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not record location"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "recordedAt": recordedAt})
}

type brandingResponse struct {
	CompanyName        string  `json:"companyName"`
	LogoURL            *string `json:"logoUrl,omitempty"`
	PrimaryColor       string  `json:"primaryColor"`
	DefaultTheme       string  `json:"defaultTheme"`
	DispatcherContact  string  `json:"dispatcherContact"`
	SubscriptionStatus string  `json:"subscriptionStatus"`
}

func (app *application) getBranding(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	response := brandingResponse{CompanyName: tenant.Name, SubscriptionStatus: tenant.SubscriptionStatus}
	err := app.db.QueryRow(r.Context(), `
		SELECT logo_url, primary_color, default_theme, dispatcher_contact
		FROM tenant_branding WHERE tenant_id = $1
	`, tenant.ID).Scan(&response.LogoURL, &response.PrimaryColor, &response.DefaultTheme, &response.DispatcherContact)
	if errors.Is(err, pgx.ErrNoRows) {
		response.PrimaryColor, response.DefaultTheme = "#E9B74D", "dark"
	} else if err != nil {
		app.log.Error("load branding", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load branding"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

type updateBrandingRequest struct {
	LogoURL           *string `json:"logoUrl"`
	PrimaryColor      string  `json:"primaryColor"`
	DefaultTheme      string  `json:"defaultTheme"`
	DispatcherContact string  `json:"dispatcherContact"`
}

func (app *application) updateBranding(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input updateBrandingRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || !isHexColor(input.PrimaryColor) || (input.DefaultTheme != "light" && input.DefaultTheme != "dark" && input.DefaultTheme != "system") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "valid primary color and default theme are required"})
		return
	}
	if input.LogoURL != nil {
		value := strings.TrimSpace(*input.LogoURL)
		if value == "" {
			input.LogoURL = nil
		} else if len(value) > 2_000 || (!strings.HasPrefix(value, "https://") && !strings.HasPrefix(value, "/")) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "logo URL must be an HTTPS URL or local path"})
			return
		} else {
			input.LogoURL = &value
		}
	}
	input.DispatcherContact = strings.TrimSpace(input.DispatcherContact)
	if len([]rune(input.DispatcherContact)) > 160 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "dispatcher contact is too long"})
		return
	}
	response := brandingResponse{CompanyName: tenant.Name, SubscriptionStatus: tenant.SubscriptionStatus}
	err := app.db.QueryRow(r.Context(), `
		INSERT INTO tenant_branding (tenant_id, logo_url, primary_color, default_theme, dispatcher_contact)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (tenant_id) DO UPDATE SET logo_url = EXCLUDED.logo_url, primary_color = EXCLUDED.primary_color, default_theme = EXCLUDED.default_theme, dispatcher_contact = EXCLUDED.dispatcher_contact, updated_at = now()
		RETURNING logo_url, primary_color, default_theme, dispatcher_contact
	`, tenant.ID, input.LogoURL, strings.ToUpper(input.PrimaryColor), input.DefaultTheme, input.DispatcherContact).Scan(&response.LogoURL, &response.PrimaryColor, &response.DefaultTheme, &response.DispatcherContact)
	if err != nil {
		app.log.Error("update branding", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not update branding"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func isHexColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, character := range value[1:] {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')) {
			return false
		}
	}
	return true
}

type paymentConfigResponse struct {
	Provider     string `json:"provider"`
	MerchantName string `json:"merchantName"`
	IBAN         string `json:"iban"`
	EDRPOU       string `json:"edrpou"`
	BankName     string `json:"bankName"`
	LogoURL      string `json:"logoUrl"`
	IsEnabled    bool   `json:"isEnabled"`
}

type updatePaymentConfigRequest struct {
	MerchantName string `json:"merchantName"`
	IBAN         string `json:"iban"`
	EDRPOU       string `json:"edrpou"`
	BankName     string `json:"bankName"`
	LogoURL      string `json:"logoUrl"`
	IsEnabled    bool   `json:"isEnabled"`
}

func validatePaymentConfigInput(input *updatePaymentConfigRequest) error {
	input.MerchantName = strings.TrimSpace(input.MerchantName)
	input.IBAN = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(input.IBAN), " ", ""))
	input.EDRPOU = strings.TrimSpace(input.EDRPOU)
	input.BankName = strings.TrimSpace(input.BankName)
	input.LogoURL = strings.TrimSpace(input.LogoURL)
	if len([]rune(input.MerchantName)) < 2 || len([]rune(input.MerchantName)) > 160 {
		return errors.New("merchant name must be between 2 and 160 characters")
	}
	if !regexp.MustCompile(`^UA[0-9]{27}$`).MatchString(input.IBAN) {
		return errors.New("IBAN must use the Ukrainian UA format")
	}
	if !regexp.MustCompile(`^[0-9]{8,10}$`).MatchString(input.EDRPOU) {
		return errors.New("EDRPOU must contain 8 to 10 digits")
	}
	if len([]rune(input.BankName)) < 2 || len([]rune(input.BankName)) > 120 {
		return errors.New("bank name must be between 2 and 120 characters")
	}
	if input.LogoURL != "" && (len(input.LogoURL) > 2_000 || !strings.HasPrefix(input.LogoURL, "https://")) {
		return errors.New("logo URL must be an HTTPS URL")
	}
	return nil
}

func (app *application) getPaymentConfig(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	response := paymentConfigResponse{Provider: "internal"}
	err := app.db.QueryRow(r.Context(), `
		SELECT provider, merchant_name, iban, edrpou, bank_name, COALESCE(logo_url, ''), is_enabled
		FROM tenant_payment_configs WHERE tenant_id = $1
	`, tenant.ID).Scan(&response.Provider, &response.MerchantName, &response.IBAN, &response.EDRPOU, &response.BankName, &response.LogoURL, &response.IsEnabled)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, response)
		return
	}
	if err != nil {
		app.log.Error("load payment config", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load payment settings"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (app *application) updatePaymentConfig(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(strings.TrimSpace(r.PathValue("slug")))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input updatePaymentConfigRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid payment settings payload"})
		return
	}
	if err := validatePaymentConfigInput(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	response := paymentConfigResponse{Provider: "internal"}
	err := app.db.QueryRow(r.Context(), `
		INSERT INTO tenant_payment_configs (tenant_id, provider, merchant_name, iban, edrpou, bank_name, logo_url, is_enabled)
		VALUES ($1, 'internal', $2, $3, $4, $5, NULLIF($6, ''), $7)
		ON CONFLICT (tenant_id) DO UPDATE SET
			provider = 'internal', merchant_name = EXCLUDED.merchant_name, iban = EXCLUDED.iban, edrpou = EXCLUDED.edrpou,
			bank_name = EXCLUDED.bank_name, logo_url = EXCLUDED.logo_url, is_enabled = EXCLUDED.is_enabled, updated_at = now()
		RETURNING provider, merchant_name, iban, edrpou, bank_name, COALESCE(logo_url, ''), is_enabled
	`, tenant.ID, input.MerchantName, input.IBAN, input.EDRPOU, input.BankName, input.LogoURL, input.IsEnabled).Scan(&response.Provider, &response.MerchantName, &response.IBAN, &response.EDRPOU, &response.BankName, &response.LogoURL, &response.IsEnabled)
	if err != nil {
		app.log.Error("update payment config", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not save payment settings"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

type financeSummaryResponse struct {
	From                     string                   `json:"from"`
	To                       string                   `json:"to"`
	Timezone                 string                   `json:"timezone"`
	Currency                 string                   `json:"currency"`
	ConfirmedRevenueMinor    int64                    `json:"confirmedRevenueMinor"`
	PendingRevenueMinor      int64                    `json:"pendingRevenueMinor"`
	ConfirmedBookings        int                      `json:"confirmedBookings"`
	CashCollectedMinor       int64                    `json:"cashCollectedMinor"`
	CashHandedInMinor        int64                    `json:"cashHandedInMinor"`
	DriverCashBalanceMinor   int64                    `json:"driverCashBalanceMinor"`
	OperationalExpensesMinor int64                    `json:"operationalExpensesMinor"`
	NetProfitMinor           int64                    `json:"netProfitMinor"`
	Currencies               []financeCurrencySummary `json:"currencies"`
	DriverCashBalances       []driverCashBalance      `json:"driverCashBalances"`
}

type financeCurrencySummary struct {
	Currency                 string `json:"currency"`
	ConfirmedRevenueMinor    int64  `json:"confirmedRevenueMinor"`
	PendingRevenueMinor      int64  `json:"pendingRevenueMinor"`
	ConfirmedBookings        int    `json:"confirmedBookings"`
	CashCollectedMinor       int64  `json:"cashCollectedMinor"`
	CashHandedInMinor        int64  `json:"cashHandedInMinor"`
	DriverCashBalanceMinor   int64  `json:"driverCashBalanceMinor"`
	OperationalExpensesMinor int64  `json:"operationalExpensesMinor"`
	NetProfitMinor           int64  `json:"netProfitMinor"`
}

type driverCashBalance struct {
	DriverID     string `json:"driverId"`
	DriverName   string `json:"driverName"`
	Currency     string `json:"currency"`
	BalanceMinor int64  `json:"balanceMinor"`
}

func (app *application) financeSummary(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	location, err := time.LoadLocation(tenant.Timezone)
	if err != nil {
		app.log.Error("load finance timezone", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load finance summary"})
		return
	}
	from, to, ok := financeRange(w, r, location)
	if !ok {
		return
	}
	response := financeSummaryResponse{
		From:               from.Format("2006-01-02"),
		To:                 to.AddDate(0, 0, -1).Format("2006-01-02"),
		Timezone:           tenant.Timezone,
		Currency:           tenant.BaseCurrency,
		DriverCashBalances: make([]driverCashBalance, 0),
	}
	rows, err := app.db.Query(r.Context(), `
		WITH currencies AS (
			SELECT $4::text AS currency
			UNION
			SELECT currency FROM bookings WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
			UNION
			SELECT currency FROM driver_cash_ledger WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3
			UNION
			SELECT currency FROM operational_expenses WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3
		), booking_totals AS (
			SELECT currency,
				COALESCE(SUM(price_minor) FILTER (WHERE status IN ('confirmed', 'completed')), 0) AS confirmed_revenue_minor,
				COALESCE(SUM(price_minor) FILTER (WHERE status = 'pending'), 0) AS pending_revenue_minor,
				COUNT(*) FILTER (WHERE status IN ('confirmed', 'completed')) AS confirmed_bookings
			FROM bookings
			WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
			GROUP BY currency
		), cash_totals AS (
			SELECT currency,
				COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'cash_collected'), 0) AS cash_collected_minor,
				COALESCE(SUM(amount_minor) FILTER (WHERE kind = 'collection'), 0) AS cash_handed_in_minor
			FROM driver_cash_ledger
			WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3
			GROUP BY currency
		), expense_totals AS (
			SELECT currency, COALESCE(SUM(amount_minor), 0) AS operational_expenses_minor
			FROM operational_expenses
			WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3
			GROUP BY currency
		)
		SELECT c.currency,
			COALESCE(b.confirmed_revenue_minor, 0), COALESCE(b.pending_revenue_minor, 0), COALESCE(b.confirmed_bookings, 0),
			COALESCE(cash.cash_collected_minor, 0), COALESCE(cash.cash_handed_in_minor, 0),
			COALESCE(exp.operational_expenses_minor, 0)
		FROM currencies c
		LEFT JOIN booking_totals b ON b.currency = c.currency
		LEFT JOIN cash_totals cash ON cash.currency = c.currency
		LEFT JOIN expense_totals exp ON exp.currency = c.currency
		ORDER BY c.currency
	`, tenant.ID, from, to, tenant.BaseCurrency)
	if err != nil {
		app.log.Error("load finance summary", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load finance summary"})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var item financeCurrencySummary
		if err := rows.Scan(&item.Currency, &item.ConfirmedRevenueMinor, &item.PendingRevenueMinor, &item.ConfirmedBookings, &item.CashCollectedMinor, &item.CashHandedInMinor, &item.OperationalExpensesMinor); err != nil {
			app.log.Error("scan finance summary", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load finance summary"})
			return
		}
		item.DriverCashBalanceMinor = item.CashCollectedMinor - item.CashHandedInMinor
		item.NetProfitMinor = item.ConfirmedRevenueMinor - item.OperationalExpensesMinor
		response.Currencies = append(response.Currencies, item)
		if item.Currency == tenant.BaseCurrency {
			response.ConfirmedRevenueMinor = item.ConfirmedRevenueMinor
			response.PendingRevenueMinor = item.PendingRevenueMinor
			response.ConfirmedBookings = item.ConfirmedBookings
			response.CashCollectedMinor = item.CashCollectedMinor
			response.CashHandedInMinor = item.CashHandedInMinor
			response.DriverCashBalanceMinor = item.DriverCashBalanceMinor
			response.OperationalExpensesMinor = item.OperationalExpensesMinor
			response.NetProfitMinor = item.NetProfitMinor
		}
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate finance summary", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load finance summary"})
		return
	}
	balanceRows, err := app.db.Query(r.Context(), `
		SELECT driver.id::text, driver.full_name, ledger.currency,
			SUM(CASE WHEN ledger.kind = 'cash_collected' THEN ledger.amount_minor ELSE -ledger.amount_minor END)::bigint
		FROM driver_cash_ledger ledger
		JOIN drivers driver ON driver.id = ledger.driver_id
		WHERE ledger.tenant_id = $1
		GROUP BY driver.id, driver.full_name, ledger.currency
		HAVING SUM(CASE WHEN ledger.kind = 'cash_collected' THEN ledger.amount_minor ELSE -ledger.amount_minor END) <> 0
		ORDER BY driver.full_name, ledger.currency
	`, tenant.ID)
	if err != nil {
		app.log.Error("load driver cash balances", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load finance summary"})
		return
	}
	defer balanceRows.Close()
	for balanceRows.Next() {
		var item driverCashBalance
		if err := balanceRows.Scan(&item.DriverID, &item.DriverName, &item.Currency, &item.BalanceMinor); err != nil {
			app.log.Error("scan driver cash balance", "error", err, "tenant", slug)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load finance summary"})
			return
		}
		response.DriverCashBalances = append(response.DriverCashBalances, item)
	}
	if err := balanceRows.Err(); err != nil {
		app.log.Error("iterate driver cash balances", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load finance summary"})
		return
	}
	writeJSON(w, http.StatusOK, response)
}

type recordDriverCashRequest struct {
	DriverID    string `json:"driverId"`
	TripID      string `json:"tripId"`
	AmountMinor int64  `json:"amountMinor"`
	Kind        string `json:"kind"`
	Currency    string `json:"currency"`
}

type driverCashSummaryItem struct {
	TripID         string `json:"tripId"`
	AmountMinor    int64  `json:"amountMinor"`
	Currency       string `json:"currency"`
	CollectedMinor int64  `json:"collectedMinor"`
}

type confirmDriverCashReceivedRequest struct {
	TripID string `json:"tripId"`
}

func (app *application) driverCashSummary(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	actor, authenticated := identityFromContext(r.Context())
	if !authenticated {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication is required"})
		return
	}
	driverID, err := app.activeDriverID(r.Context(), tenant.ID, actor.MembershipID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "driver profile is not connected to this account"})
		return
	}
	if err != nil {
		app.log.Error("load driver cash summary", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load driver cash summary"})
		return
	}

	var item driverCashSummaryItem
	err = app.db.QueryRow(r.Context(), `
		SELECT t.id::text, t.currency,
			COALESCE((
				SELECT SUM(price_minor) FROM bookings b
				WHERE b.tenant_id = t.tenant_id AND b.trip_id = t.id AND b.status = 'cash_on_boarding'
			), 0),
			COALESCE((
				SELECT SUM(amount_minor) FROM driver_cash_ledger ledger
				WHERE ledger.tenant_id = t.tenant_id AND ledger.trip_id = t.id AND ledger.kind = 'cash_collected'
			), 0)
		FROM trips t
		WHERE t.tenant_id = $1 AND t.driver_id = $2 AND t.status = 'in_progress'
		ORDER BY t.starts_at DESC
		LIMIT 1
	`, tenant.ID, driverID).Scan(&item.TripID, &item.Currency, &item.AmountMinor, &item.CollectedMinor)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, map[string]any{"item": nil})
		return
	}
	if err != nil {
		app.log.Error("query driver cash summary", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not load driver cash summary"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"item": item})
}

func (app *application) confirmDriverCashReceived(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input confirmDriverCashReceivedRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || strings.TrimSpace(input.TripID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trip is required"})
		return
	}
	actor, authenticated := identityFromContext(r.Context())
	if !authenticated {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authentication is required"})
		return
	}
	driverID, err := app.activeDriverID(r.Context(), tenant.ID, actor.MembershipID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "driver profile is not connected to this account"})
		return
	}
	if err != nil {
		app.log.Error("load driver for cash receipt", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm cash receipt"})
		return
	}

	tx, err := app.db.Begin(r.Context())
	if err != nil {
		app.log.Error("start cash receipt transaction", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm cash receipt"})
		return
	}
	defer tx.Rollback(r.Context())

	var currency string
	if err := tx.QueryRow(r.Context(), `
		SELECT currency FROM trips
		WHERE id = $1 AND tenant_id = $2 AND driver_id = $3 AND status = 'in_progress'
		FOR UPDATE
	`, input.TripID, tenant.ID, driverID).Scan(&currency); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "only an active assigned trip can receive cash"})
			return
		}
		app.log.Error("lock trip cash receipt", "error", err, "tenant", slug, "trip", input.TripID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm cash receipt"})
		return
	}
	var amountMinor int64
	if err := tx.QueryRow(r.Context(), `
		SELECT COALESCE(SUM(price_minor), 0)
		FROM bookings
		WHERE tenant_id = $1 AND trip_id = $2 AND status = 'cash_on_boarding'
	`, tenant.ID, input.TripID).Scan(&amountMinor); err != nil {
		app.log.Error("sum trip cash due", "error", err, "tenant", slug, "trip", input.TripID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm cash receipt"})
		return
	}
	if amountMinor < 1 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "there are no cash payments to confirm for this trip"})
		return
	}

	var ledgerID string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO driver_cash_ledger (tenant_id, driver_id, trip_id, amount_minor, currency, kind)
		VALUES ($1, $2, $3, $4, $5, 'cash_collected')
		ON CONFLICT (tenant_id, trip_id, currency) WHERE kind = 'cash_collected' AND trip_id IS NOT NULL
		DO NOTHING
		RETURNING id::text
	`, tenant.ID, driverID, input.TripID, amountMinor, currency).Scan(&ledgerID)
	if errors.Is(err, pgx.ErrNoRows) {
		var recordedAmount int64
		err = tx.QueryRow(r.Context(), `
			SELECT amount_minor FROM driver_cash_ledger
			WHERE tenant_id = $1 AND trip_id = $2 AND currency = $3 AND kind = 'cash_collected'
		`, tenant.ID, input.TripID, currency).Scan(&recordedAmount)
		if err != nil {
			app.log.Error("load existing trip cash receipt", "error", err, "tenant", slug, "trip", input.TripID)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm cash receipt"})
			return
		}
		if recordedAmount != amountMinor {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "the existing cash amount differs from the amount due; ask the dispatcher to reconcile it"})
			return
		}
	} else if err != nil {
		app.log.Error("record trip cash receipt", "error", err, "tenant", slug, "trip", input.TripID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm cash receipt"})
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		app.log.Error("commit trip cash receipt", "error", err, "tenant", slug, "trip", input.TripID)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not confirm cash receipt"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"item": driverCashSummaryItem{
			TripID:         input.TripID,
			AmountMinor:    amountMinor,
			Currency:       currency,
			CollectedMinor: amountMinor,
		},
	})
}

func (app *application) recordDriverCash(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input recordDriverCashRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid cash operation payload"})
		return
	}
	input.Currency = normalizedFinanceCurrency(input.Currency, tenant.BaseCurrency)
	if strings.TrimSpace(input.DriverID) == "" || input.AmountMinor < 1 || input.AmountMinor > 1_000_000_000 || (input.Kind != "cash_collected" && input.Kind != "collection") || !validBookingCurrency(input.Currency) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "driver, positive amount, cash operation and UAH or EUR currency are required"})
		return
	}
	var driverExists bool
	if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM drivers WHERE id = $1 AND tenant_id = $2 AND is_active)`, input.DriverID, tenant.ID).Scan(&driverExists); err != nil || !driverExists {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "driver is unavailable"})
		return
	}
	if input.TripID != "" {
		var tripMatchesDriver bool
		if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM trips WHERE id = $1 AND tenant_id = $2 AND driver_id = $3)`, input.TripID, tenant.ID, input.DriverID).Scan(&tripMatchesDriver); err != nil || !tripMatchesDriver {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trip is unavailable for this driver"})
			return
		}
	}
	var id string
	err := app.db.QueryRow(r.Context(), `
		INSERT INTO driver_cash_ledger (tenant_id, driver_id, trip_id, amount_minor, currency, kind)
		VALUES ($1, $2, NULLIF($3, '')::uuid, $4, $5, $6) RETURNING id::text
	`, tenant.ID, input.DriverID, input.TripID, input.AmountMinor, input.Currency, input.Kind).Scan(&id)
	if err != nil {
		app.log.Error("record driver cash", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not record cash operation"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "currency": input.Currency})
}

type recordOperationalExpenseRequest struct {
	TripID      string `json:"tripId"`
	Category    string `json:"category"`
	AmountMinor int64  `json:"amountMinor"`
	Description string `json:"description"`
	Currency    string `json:"currency"`
}

func validExpenseCategory(category string) bool {
	switch category {
	case "fuel", "driver_pay", "amortization", "marketing", "other":
		return true
	default:
		return false
	}
}

func (app *application) recordOperationalExpense(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	tenant, ok := app.loadTenant(w, r, slug)
	if !ok {
		return
	}
	var input recordOperationalExpenseRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid expense payload"})
		return
	}
	input.TripID = strings.TrimSpace(input.TripID)
	input.Category = strings.TrimSpace(input.Category)
	input.Description = strings.TrimSpace(input.Description)
	input.Currency = normalizedFinanceCurrency(input.Currency, tenant.BaseCurrency)
	if !validExpenseCategory(input.Category) || input.AmountMinor < 1 || input.AmountMinor > 1_000_000_000 || len([]rune(input.Description)) > 500 || !validFinanceCurrency(input.Currency) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "category, amount and description are invalid"})
		return
	}
	if input.TripID != "" {
		var tripExists bool
		if err := app.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM trips WHERE id = $1 AND tenant_id = $2)`, input.TripID, tenant.ID).Scan(&tripExists); err != nil || !tripExists {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "trip is unavailable for this expense"})
			return
		}
	}
	var id string
	err := app.db.QueryRow(r.Context(), `
		INSERT INTO operational_expenses (tenant_id, trip_id, category, amount_minor, currency, description)
		VALUES ($1, NULLIF($2, '')::uuid, $3, $4, $5, $6)
		RETURNING id::text
	`, tenant.ID, input.TripID, input.Category, input.AmountMinor, input.Currency, input.Description).Scan(&id)
	if err != nil {
		app.log.Error("record operational expense", "error", err, "tenant", slug)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not record expense"})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id, "currency": input.Currency})
}

var financeCurrencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

func normalizedFinanceCurrency(value, fallback string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if value == "" {
		return fallback
	}
	return value
}

func validFinanceCurrency(value string) bool {
	return financeCurrencyPattern.MatchString(value)
}

func validBookingCurrency(value string) bool {
	return value == "UAH" || value == "EUR"
}

func financeRange(w http.ResponseWriter, r *http.Request, location *time.Location) (time.Time, time.Time, bool) {
	now := time.Now().In(location)
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, location)
	to := from.AddDate(0, 1, 0)
	if value := r.URL.Query().Get("from"); value != "" {
		parsed, err := time.ParseInLocation("2006-01-02", value, location)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "from must use YYYY-MM-DD"})
			return time.Time{}, time.Time{}, false
		}
		from = parsed
	}
	if value := r.URL.Query().Get("to"); value != "" {
		parsed, err := time.ParseInLocation("2006-01-02", value, location)
		if err != nil || !parsed.After(from) && !parsed.Equal(from) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "to must use YYYY-MM-DD and not be before from"})
			return time.Time{}, time.Time{}, false
		}
		to = parsed.AddDate(0, 0, 1)
	}
	if to.Sub(from) > 366*24*time.Hour {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "finance range cannot exceed 366 days"})
		return time.Time{}, time.Time{}, false
	}
	return from, to, true
}

func boundedQueryInt(r *http.Request, key string, fallback, minimum, maximum int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

func normalizePhone(value string) string {
	value = strings.TrimSpace(value)
	var digits strings.Builder
	for _, character := range value {
		if unicode.IsDigit(character) {
			digits.WriteRune(character)
		}
	}
	number := digits.String()
	if strings.HasPrefix(number, "00") {
		number = number[2:]
	}
	if !strings.HasPrefix(value, "+") && !strings.HasPrefix(value, "00") {
		return ""
	}
	if len(number) < 7 || len(number) > 15 || strings.HasPrefix(number, "0") {
		return ""
	}
	return "+" + number
}

func (app *application) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (app *application) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	if err := app.db.Ping(ctx); err != nil {
		app.log.Error("postgres readiness failed", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not ready"})
		return
	}
	if err := app.redis.Ping(ctx).Err(); err != nil {
		app.log.Error("redis readiness failed", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not ready"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (app *application) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", os.Getenv("CORS_ORIGIN"))
		w.Header().Add("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (app *application) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "geolocation=(self), camera=(), microphone=()")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-site")
		if r.TLS != nil {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func (app *application) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				app.log.Error("panic", "error", recovered)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func requiredEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		panic(key + " must be set")
	}
	return value
}

func optionalEnv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		return
	}
}
