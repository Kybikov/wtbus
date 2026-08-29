package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	_ "time/tzdata"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	qrcode "github.com/skip2/go-qrcode"
	"github.com/vivat-bus/tms/internal/telegramoutbox"
)

const (
	stateTTL                 = 20 * time.Minute
	notificationPollInterval = 2 * time.Second
	holdExpiryPollInterval   = time.Minute
	maximumPassengerAgeYears = 125
)

type app struct {
	db                 *pgxpool.Pool
	redis              *redis.Client
	bot                *tgbotapi.BotAPI
	log                *slog.Logger
	tenantID           string
	tenantName         string
	tenantSlug         string
	dispatcherContact  string
	subscriptionStatus string
	timezone           *time.Location
}

// botBinding connects one Telegram bot to one isolated tenant. Tokens are read
// only from the environment and are never written to application logs.
type botBinding struct {
	Token      string `json:"token"`
	TenantSlug string `json:"tenantSlug"`
}

type bookingState struct {
	Step               string         `json:"step"`
	Origin             string         `json:"origin,omitempty"`
	Destination        string         `json:"destination,omitempty"`
	Date               string         `json:"date,omitempty"`
	CalendarMonth      string         `json:"calendarMonth,omitempty"`
	PendingTripID      string         `json:"pendingTripId,omitempty"`
	PendingCustomerID  string         `json:"pendingCustomerId,omitempty"`
	PendingSeats       int16          `json:"pendingSeats,omitempty"`
	PassengerName      string         `json:"passengerName,omitempty"`
	PassengerPhone     string         `json:"passengerPhone,omitempty"`
	PassengerBirthDate string         `json:"passengerBirthDate,omitempty"`
	RequestedTime      string         `json:"requestedTime,omitempty"`
	RequestComment     string         `json:"requestComment,omitempty"`
	BookingFields      []bookingField `json:"bookingFields,omitempty"`
	BookingFieldIndex  int            `json:"bookingFieldIndex,omitempty"`
	CustomData         map[string]any `json:"customData,omitempty"`
}

type bookingField struct {
	Key       string   `json:"key"`
	Label     string   `json:"label"`
	FieldType string   `json:"fieldType"`
	Options   []string `json:"options,omitempty"`
}

type tripOption struct {
	ID          string
	Origin      string
	Destination string
	StartsAt    time.Time
	EndsAt      time.Time
	PriceMinor  int64
	Currency    string
	PricingMode string
	Available   int
}

type customerTrip struct {
	ID            string
	Status        string
	TripStatus    string
	Seats         int16
	PriceMinor    int64
	Currency      string
	Origin        string
	Destination   string
	StartsAt      time.Time
	PaymentMethod string
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	databaseURL := requiredEnv("DATABASE_URL")
	redisURL := requiredEnv("REDIS_URL")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		logger.Error("open postgres", "error", err)
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
	bindings, err := parseBotBindings(optionalEnv("TELEGRAM_BOTS_JSON", ""), botBinding{
		Token:      optionalEnv("TELEGRAM_BOT_TOKEN", ""),
		TenantSlug: optionalEnv("TENANT_SLUG", "vivat-bus"),
	})
	if err != nil {
		logger.Error("load bot bindings", "error", err)
		os.Exit(1)
	}

	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	var workers sync.WaitGroup
	for _, binding := range bindings {
		bot, err := tgbotapi.NewBotAPI(binding.Token)
		if err != nil {
			logger.Error("connect telegram", "tenant", binding.TenantSlug, "error", err)
			os.Exit(1)
		}
		application := &app{db: db, redis: redisClient, bot: bot, log: logger, tenantSlug: binding.TenantSlug}
		if err := application.loadTenant(ctx); err != nil {
			logger.Error("load tenant", "tenant", binding.TenantSlug, "error", err)
			os.Exit(1)
		}
		logger.Info("telegram bot started", "username", bot.Self.UserName, "tenant", application.tenantSlug)
		workers.Add(1)
		go func(application *app) {
			defer workers.Done()
			application.run(signalContext)
		}(application)
	}
	workers.Wait()
}

func parseBotBindings(raw string, fallback botBinding) ([]botBinding, error) {
	var bindings []botBinding
	if strings.TrimSpace(raw) == "" {
		bindings = []botBinding{fallback}
	} else if err := json.Unmarshal([]byte(raw), &bindings); err != nil {
		return nil, fmt.Errorf("decode TELEGRAM_BOTS_JSON: %w", err)
	}
	if len(bindings) == 0 {
		return nil, errors.New("at least one Telegram bot binding is required")
	}

	tenants := make(map[string]struct{}, len(bindings))
	tokens := make(map[string]struct{}, len(bindings))
	for index := range bindings {
		binding := &bindings[index]
		binding.Token = strings.TrimSpace(binding.Token)
		binding.TenantSlug = strings.TrimSpace(binding.TenantSlug)
		if binding.Token == "" {
			return nil, fmt.Errorf("Telegram bot binding %d has no token", index+1)
		}
		if binding.TenantSlug == "" {
			return nil, fmt.Errorf("Telegram bot binding %d has no tenant slug", index+1)
		}
		if _, exists := tenants[binding.TenantSlug]; exists {
			return nil, fmt.Errorf("Telegram bot binding %d repeats a tenant slug", index+1)
		}
		if _, exists := tokens[binding.Token]; exists {
			return nil, fmt.Errorf("Telegram bot binding %d repeats a token", index+1)
		}
		tenants[binding.TenantSlug] = struct{}{}
		tokens[binding.Token] = struct{}{}
	}
	return bindings, nil
}

func (app *app) loadTenant(ctx context.Context) error {
	var timezone string
	if err := app.db.QueryRow(ctx, `
		SELECT tenant.id::text, tenant.name, tenant.timezone, tenant.subscription_status, COALESCE(branding.dispatcher_contact, '')
		FROM tenants tenant
		LEFT JOIN tenant_branding branding ON branding.tenant_id = tenant.id
		WHERE tenant.slug = $1
	`, app.tenantSlug).Scan(&app.tenantID, &app.tenantName, &timezone, &app.subscriptionStatus, &app.dispatcherContact); err != nil {
		return err
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return err
	}
	app.timezone = location
	return nil
}

func (app *app) run(signalContext context.Context) {
	updateConfig := tgbotapi.NewUpdate(0)
	updateConfig.Timeout = 30
	updates := app.bot.GetUpdatesChan(updateConfig)
	go app.deliverTelegramNotifications(signalContext)
	go app.expireBookingHoldsLoop(signalContext)
	for {
		select {
		case <-signalContext.Done():
			app.log.Info("telegram bot stopping")
			return
		case update, ok := <-updates:
			if !ok {
				app.log.Warn("telegram update channel closed")
				return
			}
			if update.Message != nil {
				app.handleMessage(update.Message)
			}
			if update.CallbackQuery != nil {
				app.handleCallback(update.CallbackQuery)
			}
		}
	}
}

type pendingTelegramNotification struct {
	ID      string
	ChatID  int64
	Kind    string
	Payload []byte
}

func (app *app) deliverTelegramNotifications(ctx context.Context) {
	ticker := time.NewTicker(notificationPollInterval)
	defer ticker.Stop()
	for {
		if err := app.deliverPendingTelegramNotifications(ctx); err != nil && !errors.Is(err, context.Canceled) {
			app.log.Error("deliver pending telegram notifications", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (app *app) expireBookingHoldsLoop(ctx context.Context) {
	ticker := time.NewTicker(holdExpiryPollInterval)
	defer ticker.Stop()
	for {
		if err := app.expireBookingHolds(ctx); err != nil && !errors.Is(err, context.Canceled) {
			app.log.Error("expire booking holds", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (app *app) deliverPendingTelegramNotifications(ctx context.Context) error {
	rows, err := app.db.Query(ctx, `
		WITH next AS (
			SELECT id
			FROM telegram_notification_outbox
			WHERE tenant_id = $1
			  AND delivered_at IS NULL
			  AND available_at <= now()
			  AND (locked_until IS NULL OR locked_until <= now())
			ORDER BY created_at, id
			LIMIT 20
			FOR UPDATE SKIP LOCKED
		)
		UPDATE telegram_notification_outbox notification
		SET locked_until = now() + interval '2 minutes', attempt_count = notification.attempt_count + 1
		FROM next
		WHERE notification.id = next.id
		RETURNING notification.id::text, notification.chat_id, notification.kind, notification.payload
	`, app.tenantID)
	if err != nil {
		return err
	}
	defer rows.Close()
	notifications := make([]pendingTelegramNotification, 0)
	for rows.Next() {
		var notification pendingTelegramNotification
		if err := rows.Scan(&notification.ID, &notification.ChatID, &notification.Kind, &notification.Payload); err != nil {
			return err
		}
		notifications = append(notifications, notification)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, notification := range notifications {
		var text string
		switch notification.Kind {
		case telegramoutbox.KindTripStatus:
			var payload telegramoutbox.TripStatusPayload
			if err := json.Unmarshal(notification.Payload, &payload); err != nil {
				app.log.Error("decode trip status notification", "error", err, "notification", notification.ID)
				if err := app.retryTelegramNotification(ctx, notification.ID); err != nil {
					return err
				}
				continue
			}
			text = formatTripStatusNotification(payload, app.timezone)
		case telegramoutbox.KindIndividualTransferRequest:
			var payload telegramoutbox.IndividualTransferRequestPayload
			if err := json.Unmarshal(notification.Payload, &payload); err != nil {
				app.log.Error("decode individual transfer request notification", "error", err, "notification", notification.ID)
				if err := app.retryTelegramNotification(ctx, notification.ID); err != nil {
					return err
				}
				continue
			}
			text = formatIndividualTransferRequestStatusNotification(payload, app.timezone)
		default:
			app.log.Error("unsupported telegram notification kind", "kind", notification.Kind, "notification", notification.ID)
			if err := app.retryTelegramNotification(ctx, notification.ID); err != nil {
				return err
			}
			continue
		}
		if err := app.sendNotification(notification.ChatID, text); err != nil {
			app.log.Warn("send telegram notification", "error", err, "notification", notification.ID)
			if err := app.retryTelegramNotification(ctx, notification.ID); err != nil {
				return err
			}
			continue
		}
		if _, err := app.db.Exec(ctx, `
			UPDATE telegram_notification_outbox
			SET delivered_at = now(), locked_until = NULL
			WHERE id = $1 AND tenant_id = $2 AND delivered_at IS NULL
		`, notification.ID, app.tenantID); err != nil {
			return err
		}
	}
	return nil
}

func (app *app) retryTelegramNotification(ctx context.Context, notificationID string) error {
	_, err := app.db.Exec(ctx, `
		UPDATE telegram_notification_outbox
		SET locked_until = NULL, available_at = now() + interval '30 seconds'
		WHERE id = $1 AND tenant_id = $2 AND delivered_at IS NULL
	`, notificationID, app.tenantID)
	return err
}

func (app *app) handleMessage(message *tgbotapi.Message) {
	if message.From == nil || message.Chat == nil || message.Chat.ID != message.From.ID {
		return
	}
	if message.IsCommand() {
		switch message.Command() {
		case "start":
			app.clearState(message.Chat.ID)
			app.sendWelcome(message.Chat.ID)
		default:
			app.send(message.Chat.ID, "Используйте кнопку «Найти рейс».")
		}
		return
	}
	if message.Text == "Найти рейс" {
		app.saveState(message.Chat.ID, bookingState{Step: "origin"})
		app.send(message.Chat.ID, "Откуда отправляетесь? Напишите город.")
		return
	}
	if message.Text == "Индивидуальный трансфер" {
		app.saveState(message.Chat.ID, bookingState{Step: "request_origin"})
		app.send(message.Chat.ID, "Откуда нужна индивидуальная поездка? Укажите город или точку отправления.")
		return
	}
	if message.Text == "Мои поездки" {
		app.showMyTrips(message.Chat.ID, message.From.ID)
		return
	}
	if message.Text == "Связь с диспетчером" {
		if app.dispatcherContact == "" {
			app.send(message.Chat.ID, "Контакт диспетчера пока не настроен. Пожалуйста, попробуйте позже.")
		} else {
			app.send(message.Chat.ID, "Связь с диспетчером: "+app.dispatcherContact)
		}
		return
	}

	state, ok := app.getState(message.Chat.ID)
	if !ok {
		app.sendWelcome(message.Chat.ID)
		return
	}
	if message.Contact != nil && (state.Step == "contact" || state.Step == "passenger_phone" || state.Step == "request_passenger_phone") {
		app.handleContact(message, state)
		return
	}
	text := strings.TrimSpace(message.Text)
	switch state.Step {
	case "origin":
		if !validPlace(text) {
			app.send(message.Chat.ID, "Укажите город: от 2 до 120 символов.")
			return
		}
		state.Origin, state.Step = text, "destination"
		app.saveState(message.Chat.ID, state)
		app.send(message.Chat.ID, "Куда едете? Напишите город назначения.")
	case "destination":
		if !validPlace(text) {
			app.send(message.Chat.ID, "Укажите город: от 2 до 120 символов.")
			return
		}
		state.Destination = text
		app.askBookingDate(message.Chat.ID, state)
	case "date":
		day, err := time.ParseInLocation("02.01.2006", text, app.timezone)
		if err != nil || day.Before(startOfDay(time.Now().In(app.timezone))) {
			app.send(message.Chat.ID, "Нужна будущая дата в формате ДД.ММ.ГГГГ.")
			return
		}
		state.Date = day.Format("2006-01-02")
		app.showTrips(message.Chat.ID, state)
	case "request_origin":
		if !validPlace(text) {
			app.send(message.Chat.ID, "Укажите точку отправления: от 2 до 120 символов.")
			return
		}
		state.Origin, state.Step = text, "request_destination"
		app.saveState(message.Chat.ID, state)
		app.send(message.Chat.ID, "Куда нужна поездка? Укажите город или точку назначения.")
	case "request_destination":
		if !validPlace(text) {
			app.send(message.Chat.ID, "Укажите точку назначения: от 2 до 120 символов.")
			return
		}
		state.Destination = text
		app.askIndividualRequestDate(message.Chat.ID, state)
	case "request_date":
		day, err := time.ParseInLocation("02.01.2006", text, app.timezone)
		if err != nil || day.Before(startOfDay(time.Now().In(app.timezone))) {
			app.send(message.Chat.ID, "Нужна будущая дата в формате ДД.ММ.ГГГГ.")
			return
		}
		state.Date, state.Step = day.Format("2006-01-02"), "request_time"
		app.saveState(message.Chat.ID, state)
		app.send(message.Chat.ID, "Во сколько нужна поездка? Укажите время в формате ЧЧ:ММ, например 09:30.")
	case "request_time":
		if _, ok := parseRequestDeparture(state.Date, text, app.timezone, time.Now()); !ok {
			app.send(message.Chat.ID, "Укажите будущее время в формате ЧЧ:ММ.")
			return
		}
		state.RequestedTime, state.Step = text, "request_passenger_name"
		app.saveState(message.Chat.ID, state)
		app.send(message.Chat.ID, "На кого оформить заявку? Укажите имя и фамилию пассажира.")
	case "request_passenger_name":
		if len([]rune(text)) < 2 || len([]rune(text)) > 160 {
			app.send(message.Chat.ID, "Укажите имя пассажира: от 2 до 160 символов.")
			return
		}
		state.PassengerName, state.Step = text, "request_passenger_phone"
		app.saveState(message.Chat.ID, state)
		keyboard := tgbotapi.NewReplyKeyboard(tgbotapi.NewKeyboardButtonRow(tgbotapi.NewKeyboardButtonContact("Отправить свой номер телефона")))
		keyboard.OneTimeKeyboard = true
		keyboard.ResizeKeyboard = true
		app.sendWithMarkup(message.Chat.ID, "Введите номер пассажира в международном формате или нажмите кнопку, если едет владелец Telegram.", keyboard)
	case "request_passenger_phone":
		phone := normalizePhone(text)
		if phone == "" {
			app.send(message.Chat.ID, "Введите номер в международном формате или отправьте его кнопкой Telegram.")
			return
		}
		state.PassengerPhone = phone
		app.sendWithMarkup(message.Chat.ID, "Номер пассажира сохранён.", tgbotapi.NewRemoveKeyboard(true))
		app.askIndividualRequestBirthDate(message.Chat.ID, state)
	case "request_passenger_birth_date":
		birthDate, ok := parsePassengerBirthDate(text, app.timezone, time.Now())
		if !ok {
			app.send(message.Chat.ID, "Укажите корректную дату рождения в формате ДД.ММ.ГГГГ.")
			return
		}
		state.PassengerBirthDate = birthDate
		app.askIndividualRequestSeats(message.Chat.ID, state)
	case "request_seats":
		seats, err := strconv.ParseInt(text, 10, 16)
		if err != nil || seats < 1 || seats > 20 {
			app.send(message.Chat.ID, "Укажите количество пассажиров от 1 до 20.")
			return
		}
		state.PendingSeats = int16(seats)
		state.Step = "request_comment"
		app.saveState(message.Chat.ID, state)
		keyboard := tgbotapi.NewReplyKeyboard(tgbotapi.NewKeyboardButtonRow(tgbotapi.NewKeyboardButton("Без комментария")))
		keyboard.OneTimeKeyboard = true
		keyboard.ResizeKeyboard = true
		app.sendWithMarkup(message.Chat.ID, "Добавьте комментарий для диспетчера или нажмите «Без комментария».", keyboard)
	case "request_comment":
		if len([]rune(text)) > 2000 {
			app.send(message.Chat.ID, "Комментарий слишком длинный. Укажите до 2000 символов.")
			return
		}
		if text == "Без комментария" {
			text = ""
		}
		state.RequestComment = text
		app.showIndividualRequestConfirmation(message.Chat.ID, state)
	case "booking_field":
		app.handleBookingFieldText(message.Chat.ID, text, state)
	case "passenger_name":
		if len([]rune(text)) < 2 || len([]rune(text)) > 160 {
			app.send(message.Chat.ID, "Укажите имя пассажира: от 2 до 160 символов.")
			return
		}
		state.PassengerName = text
		state.Step = "passenger_phone"
		app.saveState(message.Chat.ID, state)
		keyboard := tgbotapi.NewReplyKeyboard(tgbotapi.NewKeyboardButtonRow(tgbotapi.NewKeyboardButtonContact("Отправить свой номер телефона")))
		keyboard.OneTimeKeyboard = true
		keyboard.ResizeKeyboard = true
		app.sendWithMarkup(message.Chat.ID, "Введите номер пассажира или нажмите кнопку, если едет владелец Telegram.", keyboard)
	case "passenger_phone":
		phone := normalizePhone(text)
		if phone == "" {
			app.send(message.Chat.ID, "Введите номер в международном формате или отправьте его кнопкой Telegram.")
			return
		}
		state.PassengerPhone = phone
		app.sendWithMarkup(message.Chat.ID, "Номер пассажира сохранён.", tgbotapi.NewRemoveKeyboard(true))
		app.askPassengerBirthDate(message.Chat.ID, state)
	case "passenger_birth_date":
		birthDate, ok := parsePassengerBirthDate(text, app.timezone, time.Now())
		if !ok {
			app.send(message.Chat.ID, "Укажите корректную дату рождения в формате ДД.ММ.ГГГГ.")
			return
		}
		state.PassengerBirthDate = birthDate
		app.askSeats(message.Chat.ID, state)
	case "seats":
		seats, err := strconv.ParseInt(text, 10, 16)
		if err != nil || seats < 1 || seats > 20 {
			app.send(message.Chat.ID, "Укажите количество пассажиров от 1 до 20.")
			return
		}
		state.PendingSeats = int16(seats)
		app.beginBookingFields(message.Chat.ID, state)
	default:
		app.sendWelcome(message.Chat.ID)
	}
}

func (app *app) showTrips(chatID int64, state bookingState) {
	day, _ := time.ParseInLocation("2006-01-02", state.Date, app.timezone)
	trips, err := app.findTrips(context.Background(), state.Origin, state.Destination, day)
	if err != nil {
		app.log.Error("find booking trips", "error", err)
		app.send(chatID, "Не удалось найти рейсы. Попробуйте ещё раз.")
		return
	}
	if len(trips) == 0 {
		alternatives, lookupErr := app.findAlternativeDates(context.Background(), state.Origin, state.Destination, day)
		if lookupErr != nil {
			app.log.Error("find alternative dates", "error", lookupErr)
		}
		if len(alternatives) == 0 {
			app.send(chatID, "На эту дату рейсов нет. Нажмите «Найти рейс», чтобы изменить маршрут или дату.")
		} else {
			app.send(chatID, "На эту дату рейсов нет. Ближайшие даты: "+strings.Join(alternatives, ", ")+". Нажмите «Найти рейс» и выберите подходящую дату.")
		}
		app.clearState(chatID)
		return
	}

	var text strings.Builder
	text.WriteString("Доступные варианты:\n\n")
	rows := make([][]tgbotapi.InlineKeyboardButton, 0, len(trips))
	for _, trip := range trips {
		fmt.Fprintf(&text, "%s → %s\n%s · %d мест · %s\n\n", trip.Origin, trip.Destination, trip.StartsAt.In(app.timezone).Format("02.01 15:04"), trip.Available, formatMoney(trip.PriceMinor, trip.Currency))
		label := fmt.Sprintf("%s · %s", trip.StartsAt.In(app.timezone).Format("15:04"), formatMoney(trip.PriceMinor, trip.Currency))
		rows = append(rows, tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData(label, "book:"+trip.ID)))
	}
	app.sendWithMarkup(chatID, text.String(), tgbotapi.NewInlineKeyboardMarkup(rows...))
	app.saveState(chatID, state)
}

const calendarMonthsAhead = 12

func (app *app) askBookingDate(chatID int64, state bookingState) {
	state.Step = "calendar_regular"
	state.CalendarMonth = calendarFirstMonth(time.Now().In(app.timezone)).Format("2006-01")
	app.saveState(chatID, state)
	text, markup := app.calendarMarkup(state, "r")
	app.sendWithMarkup(chatID, text, markup)
}

func (app *app) askIndividualRequestDate(chatID int64, state bookingState) {
	state.Step = "calendar_individual"
	state.CalendarMonth = calendarFirstMonth(time.Now().In(app.timezone)).Format("2006-01")
	app.saveState(chatID, state)
	text, markup := app.calendarMarkup(state, "i")
	app.sendWithMarkup(chatID, text, markup)
}

func (app *app) calendarMarkup(state bookingState, flow string) (string, tgbotapi.InlineKeyboardMarkup) {
	month, ok := parseCalendarMonth(state.CalendarMonth, app.timezone, time.Now())
	if !ok {
		month = calendarFirstMonth(time.Now().In(app.timezone))
	}
	rows := make([][]tgbotapi.InlineKeyboardButton, 0, 9)
	rows = append(rows, tgbotapi.NewInlineKeyboardRow(
		tgbotapi.NewInlineKeyboardButtonData("Пн", "cal:x"),
		tgbotapi.NewInlineKeyboardButtonData("Вт", "cal:x"),
		tgbotapi.NewInlineKeyboardButtonData("Ср", "cal:x"),
		tgbotapi.NewInlineKeyboardButtonData("Чт", "cal:x"),
		tgbotapi.NewInlineKeyboardButtonData("Пт", "cal:x"),
		tgbotapi.NewInlineKeyboardButtonData("Сб", "cal:x"),
		tgbotapi.NewInlineKeyboardButtonData("Вс", "cal:x"),
	))

	today := startOfDay(time.Now().In(app.timezone))
	lastAllowedDay := today.AddDate(0, calendarMonthsAhead, 0)
	firstWeekday := (int(month.Weekday()) + 6) % 7
	days := month.AddDate(0, 1, -1).Day()
	week := make([]tgbotapi.InlineKeyboardButton, 0, 7)
	for column := 0; column < firstWeekday; column++ {
		week = append(week, tgbotapi.NewInlineKeyboardButtonData("·", "cal:x"))
	}
	for day := 1; day <= days; day++ {
		date := month.AddDate(0, 0, day-1)
		label := strconv.Itoa(day)
		data := "cal:x"
		if !date.Before(today) && !date.After(lastAllowedDay) {
			data = "cal:d:" + flow + ":" + date.Format("20060102")
		}
		week = append(week, tgbotapi.NewInlineKeyboardButtonData(label, data))
		if len(week) == 7 {
			rows = append(rows, week)
			week = make([]tgbotapi.InlineKeyboardButton, 0, 7)
		}
	}
	if len(week) > 0 {
		for len(week) < 7 {
			week = append(week, tgbotapi.NewInlineKeyboardButtonData("·", "cal:x"))
		}
		rows = append(rows, week)
	}

	previousData := "cal:x"
	if month.After(calendarFirstMonth(today)) {
		previousData = "cal:m:" + flow + ":" + month.AddDate(0, -1, 0).Format("200601")
	}
	nextData := "cal:x"
	if month.Before(calendarFirstMonth(lastAllowedDay)) {
		nextData = "cal:m:" + flow + ":" + month.AddDate(0, 1, 0).Format("200601")
	}
	rows = append(rows, tgbotapi.NewInlineKeyboardRow(
		tgbotapi.NewInlineKeyboardButtonData("‹", previousData),
		tgbotapi.NewInlineKeyboardButtonData(monthNameRU(month.Month())+" "+strconv.Itoa(month.Year()), "cal:x"),
		tgbotapi.NewInlineKeyboardButtonData("›", nextData),
	))

	text := "Выберите дату поездки:"
	if flow == "i" {
		text = "Выберите дату индивидуальной поездки:"
	}
	return text, tgbotapi.NewInlineKeyboardMarkup(rows...)
}

func (app *app) handleCalendarCallback(callback *tgbotapi.CallbackQuery) {
	if callback.Message == nil || callback.From == nil {
		return
	}
	chatID := callback.Message.Chat.ID
	state, ok := app.getState(chatID)
	if !ok || (state.Step != "calendar_regular" && state.Step != "calendar_individual") {
		app.send(chatID, "Сессия выбора даты истекла. Начните заново через кнопку «Найти рейс».")
		return
	}
	kind, flow, value, ok := parseCalendarCallback(callback.Data)
	if !ok || (flow == "r" && state.Step != "calendar_regular") || (flow == "i" && state.Step != "calendar_individual") {
		return
	}
	switch kind {
	case "m":
		month, valid := parseCalendarMonth(value, app.timezone, time.Now())
		if !valid {
			return
		}
		state.CalendarMonth = month.Format("2006-01")
		app.saveState(chatID, state)
		text, markup := app.calendarMarkup(state, flow)
		message := tgbotapi.NewEditMessageTextAndMarkup(chatID, callback.Message.MessageID, text, markup)
		if _, err := app.bot.Send(message); err != nil {
			app.log.Error("update calendar", "error", err)
		}
	case "d":
		day, valid := parseCalendarDate(value, app.timezone, time.Now())
		if !valid {
			return
		}
		state.Date = day.Format("2006-01-02")
		state.CalendarMonth = ""
		if flow == "r" {
			app.showTrips(chatID, state)
			return
		}
		state.Step = "request_time"
		app.saveState(chatID, state)
		app.send(chatID, "Во сколько нужна поездка? Укажите время в формате ЧЧ:ММ, например 09:30.")
	}
}

func parseCalendarCallback(value string) (kind, flow, date string, ok bool) {
	parts := strings.Split(value, ":")
	if len(parts) != 4 || parts[0] != "cal" || (parts[1] != "d" && parts[1] != "m") || (parts[2] != "r" && parts[2] != "i") {
		return "", "", "", false
	}
	return parts[1], parts[2], parts[3], true
}

func calendarFirstMonth(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), 1, 0, 0, 0, 0, value.Location())
}

func parseCalendarMonth(value string, location *time.Location, now time.Time) (time.Time, bool) {
	month, err := time.ParseInLocation("2006-01", value, location)
	if err != nil || month.Day() != 1 {
		return time.Time{}, false
	}
	firstAllowed := calendarFirstMonth(now.In(location))
	lastAllowed := calendarFirstMonth(now.In(location).AddDate(0, calendarMonthsAhead, 0))
	if month.Before(firstAllowed) || month.After(lastAllowed) {
		return time.Time{}, false
	}
	return month, true
}

func parseCalendarDate(value string, location *time.Location, now time.Time) (time.Time, bool) {
	day, err := time.ParseInLocation("20060102", value, location)
	if err != nil {
		return time.Time{}, false
	}
	today := startOfDay(now.In(location))
	if day.Before(today) || day.After(today.AddDate(0, calendarMonthsAhead, 0)) {
		return time.Time{}, false
	}
	return day, true
}

func monthNameRU(month time.Month) string {
	return []string{"", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"}[month]
}

func parseRequestDeparture(date, timeValue string, location *time.Location, now time.Time) (time.Time, bool) {
	if len(timeValue) != 5 || timeValue[2] != ':' || timeValue[0] < '0' || timeValue[0] > '9' || timeValue[1] < '0' || timeValue[1] > '9' || timeValue[3] < '0' || timeValue[3] > '9' || timeValue[4] < '0' || timeValue[4] > '9' {
		return time.Time{}, false
	}
	parsed, err := time.ParseInLocation("2006-01-02 15:04", strings.TrimSpace(date)+" "+strings.TrimSpace(timeValue), location)
	if err != nil || !parsed.After(now.In(location)) {
		return time.Time{}, false
	}
	return parsed, true
}

func (app *app) showIndividualRequestConfirmation(chatID int64, state bookingState) {
	departure, ok := parseRequestDeparture(state.Date, state.RequestedTime, app.timezone, time.Now())
	if !ok || !validPlace(state.Origin) || !validPlace(state.Destination) || state.PendingSeats < 1 || strings.TrimSpace(state.PassengerName) == "" || normalizePhone(state.PassengerPhone) == "" || state.PassengerBirthDate == "" {
		app.clearState(chatID)
		app.send(chatID, "Не удалось проверить заявку. Начните заново через кнопку «Индивидуальный трансфер».")
		return
	}
	state.Step = "request_confirmation"
	app.saveState(chatID, state)
	comment := "—"
	if strings.TrimSpace(state.RequestComment) != "" {
		comment = state.RequestComment
	}
	text := fmt.Sprintf("Проверьте заявку на индивидуальный трансфер:\n\n%s → %s\n%s\nПассажир: %s\nТелефон: %s\nДата рождения: %s\nПассажиров: %d\nКомментарий: %s\n\nДиспетчер подтвердит возможность, время и стоимость.", state.Origin, state.Destination, departure.In(app.timezone).Format("02.01.2006 в 15:04"), state.PassengerName, normalizePhone(state.PassengerPhone), formatBirthDate(state.PassengerBirthDate), state.PendingSeats, comment)
	markup := tgbotapi.NewInlineKeyboardMarkup(
		tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData("Подтвердить заявку", "request:confirm")),
		tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData("Отменить", "request:cancel")),
	)
	app.sendWithMarkup(chatID, text, markup)
}

func (app *app) confirmIndividualTransferRequest(chatID, telegramID int64) {
	state, ok := app.getState(chatID)
	if !ok || state.Step != "request_confirmation" {
		app.send(chatID, "Сессия заявки истекла. Начните заново через кнопку «Индивидуальный трансфер».")
		return
	}
	departure, err := app.createIndividualTransferRequest(context.Background(), telegramID, state)
	if err != nil {
		app.log.Error("create individual transfer request", "error", err)
		app.send(chatID, "Не удалось сохранить заявку. Попробуйте ещё раз.")
		return
	}
	app.clearState(chatID)
	app.send(chatID, fmt.Sprintf("Заявка принята. Диспетчер свяжется с вами после расчёта.\n\n%s → %s\n%s", state.Origin, state.Destination, departure.In(app.timezone).Format("02.01.2006 в 15:04")))
	app.sendWelcome(chatID)
}

func (app *app) createIndividualTransferRequest(ctx context.Context, telegramID int64, state bookingState) (time.Time, error) {
	if !validPlace(state.Origin) || !validPlace(state.Destination) || state.PendingSeats < 1 || state.PendingSeats > 20 || len([]rune(strings.TrimSpace(state.RequestComment))) > 2000 {
		return time.Time{}, errors.New("individual transfer request is invalid")
	}
	passengerName := strings.TrimSpace(state.PassengerName)
	passengerPhone := normalizePhone(state.PassengerPhone)
	if len([]rune(passengerName)) < 2 || len([]rune(passengerName)) > 160 || passengerPhone == "" {
		return time.Time{}, errors.New("individual transfer passenger is invalid")
	}
	birthDate, ok := parsePassengerBirthDate(state.PassengerBirthDate, app.timezone, time.Now())
	if !ok {
		return time.Time{}, errors.New("individual transfer birth date is invalid")
	}
	departure, ok := parseRequestDeparture(state.Date, state.RequestedTime, app.timezone, time.Now())
	if !ok {
		return time.Time{}, errors.New("individual transfer departure is invalid")
	}
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return time.Time{}, err
	}
	defer tx.Rollback(ctx)
	var customerID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO customers (tenant_id, full_name, phone_e164)
		VALUES ($1, $2, $3)
		ON CONFLICT (tenant_id, phone_e164) DO UPDATE
		SET full_name = EXCLUDED.full_name, updated_at = now()
		RETURNING id::text
	`, app.tenantID, passengerName, passengerPhone).Scan(&customerID); err != nil {
		return time.Time{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO individual_transfer_requests (
			tenant_id, customer_id, telegram_id, origin_name, destination_name, requested_departure_at,
			passenger_name, passenger_phone_e164, passenger_birth_date, seats, comment
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, NULLIF($11, ''))
	`, app.tenantID, customerID, telegramID, strings.TrimSpace(state.Origin), strings.TrimSpace(state.Destination), departure, passengerName, passengerPhone, birthDate, state.PendingSeats, strings.TrimSpace(state.RequestComment)); err != nil {
		return time.Time{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return time.Time{}, err
	}
	return departure, nil
}

func (app *app) showMyTrips(chatID, telegramID int64) {
	rows, err := app.db.Query(context.Background(), `
		SELECT b.id::text, b.status::text, t.status::text, b.seats, b.price_minor, b.currency,
			t.origin_name, t.destination_name, t.starts_at,
			COALESCE(payment.payment_method, '')
		FROM bookings b
		JOIN customers c ON c.id = b.customer_id
		JOIN trips t ON t.id = b.trip_id
		LEFT JOIN LATERAL (
			SELECT payment_method FROM payments
			WHERE booking_id = b.id
			ORDER BY created_at DESC
			LIMIT 1
		) payment ON true
		WHERE b.tenant_id = $1
		  AND c.telegram_id = $2
		  AND b.status IN ('pending', 'awaiting_payment', 'cash_on_boarding', 'confirmed', 'completed')
		  AND t.starts_at >= now() - interval '14 days'
		ORDER BY t.starts_at
		LIMIT 10
	`, app.tenantID, telegramID)
	if err != nil {
		app.log.Error("list telegram customer trips", "error", err, "telegram", telegramID)
		app.send(chatID, "Не удалось загрузить поездки. Попробуйте ещё раз позже.")
		return
	}
	defer rows.Close()

	items := make([]customerTrip, 0, 10)
	for rows.Next() {
		var item customerTrip
		if err := rows.Scan(&item.ID, &item.Status, &item.TripStatus, &item.Seats, &item.PriceMinor, &item.Currency, &item.Origin, &item.Destination, &item.StartsAt, &item.PaymentMethod); err != nil {
			app.log.Error("read telegram customer trip", "error", err, "telegram", telegramID)
			app.send(chatID, "Не удалось загрузить поездки. Попробуйте ещё раз позже.")
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate telegram customer trips", "error", err, "telegram", telegramID)
		app.send(chatID, "Не удалось загрузить поездки. Попробуйте ещё раз позже.")
		return
	}
	if len(items) == 0 {
		app.send(chatID, "У вас пока нет активных или недавних поездок.")
		return
	}

	var message strings.Builder
	cancellationRows := make([][]tgbotapi.InlineKeyboardButton, 0, len(items))
	message.WriteString("Мои поездки:\n")
	for index, item := range items {
		fmt.Fprintf(&message, "\n%d. %s → %s\n%s · %d пассаж. · %s\nСтатус: %s", index+1, item.Origin, item.Destination, item.StartsAt.In(app.timezone).Format("02.01.2006 в 15:04"), item.Seats, formatMoney(item.PriceMinor, item.Currency), bookingStatusLabel(item.Status))
		if item.PaymentMethod == "cash" {
			message.WriteString(" · наличными при посадке")
		}
		if canCancelTelegramBooking(item, time.Now()) {
			cancellationRows = append(cancellationRows, tgbotapi.NewInlineKeyboardRow(
				tgbotapi.NewInlineKeyboardButtonData("Отменить поездку №"+strconv.Itoa(index+1), "cancel:ask:"+item.ID),
			))
		}
	}
	if len(cancellationRows) == 0 {
		app.send(chatID, message.String())
		return
	}
	app.sendWithMarkup(chatID, message.String(), tgbotapi.NewInlineKeyboardMarkup(cancellationRows...))
}

func canCancelTelegramBooking(item customerTrip, now time.Time) bool {
	if item.TripStatus != "new" && item.TripStatus != "assigned" {
		return false
	}
	if !item.StartsAt.After(now) {
		return false
	}
	switch item.Status {
	case "pending", "awaiting_payment", "cash_on_boarding", "confirmed":
		return true
	default:
		return false
	}
}

func (app *app) showTelegramCancellationConfirmation(chatID, telegramID int64, bookingID string) {
	booking, err := app.loadCancellableTelegramBooking(context.Background(), telegramID, bookingID)
	if err != nil {
		app.send(chatID, "Эту поездку уже нельзя отменить. Обновите список через «Мои поездки».")
		return
	}
	text := fmt.Sprintf("Отменить бронирование?\n\n%s → %s\n%s · %d пассаж.\n\nМеста снова станут доступны.", booking.Origin, booking.Destination, booking.StartsAt.In(app.timezone).Format("02.01.2006 в 15:04"), booking.Seats)
	if booking.Status == "confirmed" {
		text += "\n\nПеревод уже подтверждён: возврат согласует диспетчер."
	}
	keyboard := tgbotapi.NewInlineKeyboardMarkup(
		tgbotapi.NewInlineKeyboardRow(
			tgbotapi.NewInlineKeyboardButtonData("Да, отменить", "cancel:yes:"+booking.ID),
			tgbotapi.NewInlineKeyboardButtonData("Нет", "cancel:no"),
		),
	)
	app.sendWithMarkup(chatID, text, keyboard)
}

func (app *app) loadCancellableTelegramBooking(ctx context.Context, telegramID int64, bookingID string) (customerTrip, error) {
	if !validBookingID(bookingID) {
		return customerTrip{}, pgx.ErrNoRows
	}
	var item customerTrip
	err := app.db.QueryRow(ctx, `
		SELECT b.id::text, b.status::text, t.status::text, b.seats, b.price_minor, b.currency,
			t.origin_name, t.destination_name, t.starts_at, COALESCE(payment.payment_method, '')
		FROM bookings b
		JOIN customers c ON c.id = b.customer_id
		JOIN trips t ON t.id = b.trip_id
		LEFT JOIN LATERAL (
			SELECT payment_method FROM payments WHERE booking_id = b.id ORDER BY created_at DESC LIMIT 1
		) payment ON true
		WHERE b.id = $1 AND b.tenant_id = $2 AND c.telegram_id = $3
	`, bookingID, app.tenantID, telegramID).Scan(&item.ID, &item.Status, &item.TripStatus, &item.Seats, &item.PriceMinor, &item.Currency, &item.Origin, &item.Destination, &item.StartsAt, &item.PaymentMethod)
	if err != nil {
		return customerTrip{}, err
	}
	if !canCancelTelegramBooking(item, time.Now()) {
		return customerTrip{}, pgx.ErrNoRows
	}
	return item, nil
}

func (app *app) cancelTelegramBooking(ctx context.Context, telegramID int64, bookingID string) (customerTrip, error) {
	if !validBookingID(bookingID) {
		return customerTrip{}, pgx.ErrNoRows
	}
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return customerTrip{}, err
	}
	defer tx.Rollback(ctx)
	var item customerTrip
	err = tx.QueryRow(ctx, `
		SELECT b.id::text, b.status::text, t.status::text, b.seats, b.price_minor, b.currency,
			t.origin_name, t.destination_name, t.starts_at, COALESCE(payment.payment_method, '')
		FROM bookings b
		JOIN customers c ON c.id = b.customer_id
		JOIN trips t ON t.id = b.trip_id
		LEFT JOIN LATERAL (
			SELECT payment_method FROM payments WHERE booking_id = b.id ORDER BY created_at DESC LIMIT 1
		) payment ON true
		WHERE b.id = $1 AND b.tenant_id = $2 AND c.telegram_id = $3
		FOR UPDATE OF b, t
	`, bookingID, app.tenantID, telegramID).Scan(&item.ID, &item.Status, &item.TripStatus, &item.Seats, &item.PriceMinor, &item.Currency, &item.Origin, &item.Destination, &item.StartsAt, &item.PaymentMethod)
	if err != nil {
		return customerTrip{}, err
	}
	if !canCancelTelegramBooking(item, time.Now()) {
		return customerTrip{}, pgx.ErrNoRows
	}
	if _, err := tx.Exec(ctx, `
		UPDATE payments SET status = 'cancelled', updated_at = now()
		WHERE booking_id = $1 AND tenant_id = $2 AND status IN ('pending', 'authorized')
	`, bookingID, app.tenantID); err != nil {
		return customerTrip{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE bookings SET status = 'cancelled', payment_hold_expires_at = NULL, updated_at = now()
		WHERE id = $1 AND tenant_id = $2
	`, bookingID, app.tenantID); err != nil {
		return customerTrip{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return customerTrip{}, err
	}
	return item, nil
}

func validBookingID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if character != '-' {
				return false
			}
			continue
		}
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')) {
			return false
		}
	}
	return true
}

func (app *app) handleCallback(callback *tgbotapi.CallbackQuery) {
	if callback.Message == nil || callback.From == nil || callback.Message.Chat.ID != callback.From.ID {
		return
	}
	chatID := callback.Message.Chat.ID
	defer app.bot.Request(tgbotapi.NewCallback(callback.ID, ""))
	if strings.HasPrefix(callback.Data, "cal:") {
		app.handleCalendarCallback(callback)
		return
	}
	if strings.HasPrefix(callback.Data, "field:") {
		app.handleBookingFieldCallback(chatID, callback.Data)
		return
	}
	if strings.HasPrefix(callback.Data, "pay:") {
		app.handlePaymentCallback(chatID, callback.From.ID, callback.Data)
		return
	}
	if strings.HasPrefix(callback.Data, "cancel:") {
		app.handleTelegramCancellationCallback(chatID, callback.From.ID, callback.Data)
		return
	}
	if callback.Data == "request:confirm" {
		app.confirmIndividualTransferRequest(chatID, callback.From.ID)
		return
	}
	if callback.Data == "request:cancel" {
		app.clearState(chatID)
		app.send(chatID, "Заявка отменена.")
		app.sendWelcome(chatID)
		return
	}
	if !strings.HasPrefix(callback.Data, "book:") {
		return
	}
	tripID := strings.TrimPrefix(callback.Data, "book:")
	if strings.TrimSpace(tripID) == "" {
		return
	}
	state, ok := app.getState(chatID)
	if !ok || state.Origin == "" || state.Destination == "" {
		app.send(chatID, "Сессия поиска истекла. Нажмите «Найти рейс».")
		return
	}
	customerID, err := app.findCustomerByTelegram(context.Background(), callback.From.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		app.log.Error("find telegram customer", "error", err)
		app.send(chatID, "Не удалось оформить бронь. Попробуйте ещё раз.")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		state.Step, state.PendingTripID = "contact", tripID
		app.saveState(chatID, state)
		keyboard := tgbotapi.NewReplyKeyboard(tgbotapi.NewKeyboardButtonRow(tgbotapi.NewKeyboardButtonContact("Отправить номер телефона")))
		keyboard.OneTimeKeyboard = true
		keyboard.ResizeKeyboard = true
		app.sendWithMarkup(chatID, "Чтобы оформить первое бронирование, отправьте свой номер телефона через кнопку ниже.", keyboard)
		return
	}
	state.PendingTripID, state.PendingCustomerID = tripID, customerID
	app.beginPassengerDetails(chatID, state)
}

func (app *app) handleTelegramCancellationCallback(chatID, telegramID int64, data string) {
	parts := strings.Split(data, ":")
	if len(parts) == 2 && parts[1] == "no" {
		app.send(chatID, "Бронирование не отменено.")
		return
	}
	if len(parts) != 3 || (parts[1] != "ask" && parts[1] != "yes") || !validBookingID(parts[2]) {
		return
	}
	if parts[1] == "ask" {
		app.showTelegramCancellationConfirmation(chatID, telegramID, parts[2])
		return
	}
	booking, err := app.cancelTelegramBooking(context.Background(), telegramID, parts[2])
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			app.log.Error("cancel telegram booking", "error", err, "telegram", telegramID)
			app.send(chatID, "Не удалось отменить бронирование. Попробуйте ещё раз позже.")
			return
		}
		app.send(chatID, "Эту поездку уже нельзя отменить. Обновите список через «Мои поездки».")
		return
	}
	message := fmt.Sprintf("Бронирование отменено: %s → %s, %s. Места снова доступны.", booking.Origin, booking.Destination, booking.StartsAt.In(app.timezone).Format("02.01.2006 в 15:04"))
	if booking.Status == "confirmed" {
		message += " Перевод был подтверждён — возврат согласует диспетчер."
	}
	app.send(chatID, message)
}

func (app *app) handleContact(message *tgbotapi.Message, state bookingState) {
	if message.Contact.UserID != message.From.ID {
		app.send(message.Chat.ID, "Отправьте, пожалуйста, свой номер с помощью кнопки.")
		return
	}
	phone := normalizePhone(message.Contact.PhoneNumber)
	if phone == "" {
		app.send(message.Chat.ID, "Не удалось распознать номер. Попробуйте ещё раз.")
		return
	}
	if state.Step == "passenger_phone" {
		state.PassengerPhone = phone
		app.sendWithMarkup(message.Chat.ID, "Номер пассажира сохранён.", tgbotapi.NewRemoveKeyboard(true))
		app.askPassengerBirthDate(message.Chat.ID, state)
		return
	}
	if state.Step == "request_passenger_phone" {
		state.PassengerPhone = phone
		app.sendWithMarkup(message.Chat.ID, "Номер пассажира сохранён.", tgbotapi.NewRemoveKeyboard(true))
		app.askIndividualRequestBirthDate(message.Chat.ID, state)
		return
	}
	if state.PendingTripID == "" {
		app.send(message.Chat.ID, "Сессия заявки истекла. Начните заново через кнопку «Индивидуальный трансфер».")
		return
	}
	if allowed, err := app.canAcceptBookings(context.Background()); err != nil || !allowed {
		app.clearState(message.Chat.ID)
		app.send(message.Chat.ID, "Онлайн-бронирование временно недоступно. Обратитесь к перевозчику.")
		return
	}
	name := strings.TrimSpace(strings.Join([]string{message.From.FirstName, message.From.LastName}, " "))
	if name == "" {
		name = "Пассажир Telegram"
	}
	var customerID string
	err := app.db.QueryRow(context.Background(), `
		INSERT INTO customers (tenant_id, full_name, phone_e164, telegram_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (tenant_id, phone_e164) DO UPDATE
		SET telegram_id = EXCLUDED.telegram_id, full_name = COALESCE(customers.full_name, EXCLUDED.full_name), updated_at = now()
		RETURNING id::text
	`, app.tenantID, name, phone, message.From.ID).Scan(&customerID)
	if err != nil {
		app.log.Error("create telegram customer", "error", err)
		app.send(message.Chat.ID, "Не удалось сохранить контакт. Попробуйте позже.")
		return
	}
	app.sendWithMarkup(message.Chat.ID, "Контакт сохранён.", tgbotapi.NewRemoveKeyboard(true))
	state.PendingCustomerID = customerID
	app.beginPassengerDetails(message.Chat.ID, state)
}

func (app *app) beginPassengerDetails(chatID int64, state bookingState) {
	state.Step = "passenger_name"
	state.PassengerName = ""
	state.PassengerPhone = ""
	state.PassengerBirthDate = ""
	state.PendingSeats = 0
	app.saveState(chatID, state)
	app.send(chatID, "На кого оформляем бронь? Укажите имя и фамилию пассажира.")
}

func (app *app) askSeats(chatID int64, state bookingState) {
	state.Step = "seats"
	app.saveState(chatID, state)
	app.send(chatID, "Сколько пассажиров бронируем? Укажите число от 1 до 20.")
}

func (app *app) askPassengerBirthDate(chatID int64, state bookingState) {
	state.Step = "passenger_birth_date"
	app.saveState(chatID, state)
	app.send(chatID, "Укажите дату рождения пассажира в формате ДД.ММ.ГГГГ.")
}

func (app *app) askIndividualRequestBirthDate(chatID int64, state bookingState) {
	state.Step = "request_passenger_birth_date"
	app.saveState(chatID, state)
	app.send(chatID, "Укажите дату рождения пассажира в формате ДД.ММ.ГГГГ.")
}

func (app *app) askIndividualRequestSeats(chatID int64, state bookingState) {
	state.Step = "request_seats"
	app.saveState(chatID, state)
	app.send(chatID, "Сколько пассажиров поедет? Укажите число от 1 до 20.")
}

func parsePassengerBirthDate(value string, location *time.Location, now time.Time) (string, bool) {
	birthDate, err := time.ParseInLocation("02.01.2006", strings.TrimSpace(value), location)
	localNow := now.In(location)
	today := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, location)
	if err != nil || birthDate.After(today) || birthDate.Before(today.AddDate(-maximumPassengerAgeYears, 0, 0)) {
		return "", false
	}
	return birthDate.Format("2006-01-02"), true
}

func formatBirthDate(value string) string {
	birthDate, err := time.Parse("2006-01-02", value)
	if err != nil {
		return value
	}
	return birthDate.Format("02.01.2006")
}

func (app *app) beginBookingFields(chatID int64, state bookingState) {
	rows, err := app.db.Query(context.Background(), `
		SELECT field_key, label, field_type, options
		FROM custom_field_definitions
		WHERE tenant_id = $1 AND entity_type = 'booking' AND is_active AND is_required
		ORDER BY position, created_at
	`, app.tenantID)
	if err != nil {
		app.log.Error("load required booking fields", "error", err)
		app.send(chatID, "Не удалось подготовить бронирование. Попробуйте ещё раз.")
		return
	}
	defer rows.Close()
	fields := make([]bookingField, 0)
	for rows.Next() {
		var field bookingField
		var rawOptions []byte
		if err := rows.Scan(&field.Key, &field.Label, &field.FieldType, &rawOptions); err != nil {
			app.log.Error("read required booking field", "error", err)
			app.send(chatID, "Не удалось подготовить бронирование. Попробуйте ещё раз.")
			return
		}
		if err := json.Unmarshal(rawOptions, &field.Options); err != nil {
			app.log.Error("decode required booking field options", "error", err)
			app.send(chatID, "Не удалось подготовить бронирование. Попробуйте ещё раз.")
			return
		}
		fields = append(fields, field)
	}
	if err := rows.Err(); err != nil {
		app.log.Error("iterate required booking fields", "error", err)
		app.send(chatID, "Не удалось подготовить бронирование. Попробуйте ещё раз.")
		return
	}
	state.BookingFields = fields
	state.BookingFieldIndex = 0
	state.CustomData = make(map[string]any)
	app.askNextBookingField(chatID, state)
}

func (app *app) askNextBookingField(chatID int64, state bookingState) {
	if state.BookingFieldIndex >= len(state.BookingFields) {
		app.confirmBooking(chatID, state.PendingCustomerID, state.PendingTripID, state)
		return
	}
	field := state.BookingFields[state.BookingFieldIndex]
	state.Step = "booking_field"
	app.saveState(chatID, state)
	if field.FieldType == "select" || field.FieldType == "boolean" {
		options := field.Options
		if field.FieldType == "boolean" {
			options = []string{"Да", "Нет"}
		}
		rows := make([][]tgbotapi.InlineKeyboardButton, 0, len(options))
		for index, option := range options {
			rows = append(rows, tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData(option, fmt.Sprintf("field:%d:%d", state.BookingFieldIndex, index))))
		}
		app.sendWithMarkup(chatID, "Укажите: "+field.Label, tgbotapi.NewInlineKeyboardMarkup(rows...))
		return
	}
	hint := "Введите значение"
	if field.FieldType == "number" {
		hint = "Введите число"
	}
	if field.FieldType == "date" {
		hint = "Введите дату в формате ДД.ММ.ГГГГ"
	}
	app.send(chatID, field.Label+". "+hint+".")
}

func (app *app) handleBookingFieldCallback(chatID int64, callbackData string) {
	parts := strings.Split(callbackData, ":")
	if len(parts) != 3 {
		return
	}
	fieldIndex, fieldErr := strconv.Atoi(parts[1])
	optionIndex, optionErr := strconv.Atoi(parts[2])
	state, ok := app.getState(chatID)
	if !ok || state.Step != "booking_field" || fieldErr != nil || optionErr != nil || fieldIndex != state.BookingFieldIndex || fieldIndex >= len(state.BookingFields) {
		return
	}
	field := state.BookingFields[fieldIndex]
	options := field.Options
	if field.FieldType == "boolean" {
		options = []string{"Да", "Нет"}
	}
	if optionIndex < 0 || optionIndex >= len(options) {
		return
	}
	if state.CustomData == nil {
		state.CustomData = make(map[string]any)
	}
	if field.FieldType == "boolean" {
		state.CustomData[field.Key] = optionIndex == 0
	} else {
		state.CustomData[field.Key] = options[optionIndex]
	}
	state.BookingFieldIndex++
	app.askNextBookingField(chatID, state)
}

func (app *app) handleBookingFieldText(chatID int64, text string, state bookingState) {
	if state.BookingFieldIndex >= len(state.BookingFields) {
		app.sendWelcome(chatID)
		return
	}
	field := state.BookingFields[state.BookingFieldIndex]
	value := strings.TrimSpace(text)
	if value == "" {
		app.send(chatID, "Поле «"+field.Label+"» обязательно. Повторите ввод.")
		return
	}
	if field.FieldType == "text" && len([]rune(value)) > 4_000 {
		app.send(chatID, "Слишком длинное значение. Укажите до 4000 символов.")
		return
	}
	if field.FieldType == "number" {
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil {
			app.send(chatID, "Нужно указать число. Повторите ввод.")
			return
		}
		if state.CustomData == nil {
			state.CustomData = make(map[string]any)
		}
		state.CustomData[field.Key] = parsed
	} else if field.FieldType == "date" {
		parsed, err := time.ParseInLocation("02.01.2006", value, app.timezone)
		if err != nil {
			app.send(chatID, "Нужна дата в формате ДД.ММ.ГГГГ. Повторите ввод.")
			return
		}
		if state.CustomData == nil {
			state.CustomData = make(map[string]any)
		}
		state.CustomData[field.Key] = parsed.Format("2006-01-02")
	} else {
		if state.CustomData == nil {
			state.CustomData = make(map[string]any)
		}
		state.CustomData[field.Key] = value
	}
	state.BookingFieldIndex++
	app.askNextBookingField(chatID, state)
}

func (app *app) confirmBooking(chatID int64, customerID, tripID string, state bookingState) {
	created, err := app.createBooking(context.Background(), customerID, tripID, state)
	if err != nil {
		switch {
		case errors.Is(err, errNoSeats):
			app.send(chatID, "К сожалению, свободные места уже закончились. Найдите другой вариант.")
		case errors.Is(err, errUnavailableTrip):
			app.send(chatID, "Этот рейс больше недоступен. Найдите другой вариант.")
		case errors.Is(err, errAlreadyBooked):
			app.send(chatID, "У вас уже есть активная бронь на этот рейс.")
		case errors.Is(err, errSubscriptionInactive):
			app.send(chatID, "Онлайн-бронирование временно недоступно. Обратитесь к перевозчику.")
		default:
			app.log.Error("create telegram booking", "error", err)
			app.send(chatID, "Не удалось оформить бронь. Попробуйте ещё раз.")
		}
		return
	}
	app.clearState(chatID)
	message := fmt.Sprintf("Бронь создана и удерживается 30 минут.\n\nПассажир: %s\nТелефон: %s\nДата рождения: %s\n%s → %s\n%s\nПассажиров: %d\nСтоимость: %s\nСвободно мест: %d", state.PassengerName, state.PassengerPhone, formatBirthDate(state.PassengerBirthDate), created.Trip.Origin, created.Trip.Destination, created.Trip.StartsAt.In(app.timezone).Format("02.01.2006 в 15:04"), state.PendingSeats, formatMoney(created.Trip.PriceMinor, created.Trip.Currency), created.Available)
	if created.Trip.Currency != "UAH" {
		app.sendWithMarkup(chatID, message+"\n\nДля этого рейса доступна оплата наличными в валюте рейса.", paymentCashMarkup(created.PaymentID))
		return
	}
	markup := tgbotapi.NewInlineKeyboardMarkup(
		tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData("Оплатить сейчас", "pay:now:"+created.PaymentID)),
		tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData("Оплатить при посадке", "pay:cash:"+created.PaymentID)),
	)
	app.sendWithMarkup(chatID, message+"\n\nВыберите способ оплаты:", markup)
}

var (
	errNoSeats              = errors.New("no seats")
	errUnavailableTrip      = errors.New("unavailable trip")
	errAlreadyBooked        = errors.New("already booked")
	errSubscriptionInactive = errors.New("subscription inactive")
)

type createdBooking struct {
	ID        string
	PaymentID string
	Trip      tripOption
	Available int
}

func (app *app) createBooking(ctx context.Context, customerID, tripID string, state bookingState) (createdBooking, error) {
	allowed, err := app.canAcceptBookings(ctx)
	if err != nil {
		return createdBooking{}, err
	}
	if !allowed {
		return createdBooking{}, errSubscriptionInactive
	}
	if state.PendingSeats < 1 || state.PendingSeats > 20 || strings.TrimSpace(state.PassengerName) == "" || strings.TrimSpace(state.PassengerPhone) == "" || state.PassengerBirthDate == "" {
		return createdBooking{}, errUnavailableTrip
	}
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return createdBooking{}, err
	}
	defer tx.Rollback(ctx)
	if err := expireBookingHoldsWith(ctx, tx, app.tenantID); err != nil {
		return createdBooking{}, fmt.Errorf("expire booking holds: %w", err)
	}
	day, err := time.ParseInLocation("2006-01-02", state.Date, app.timezone)
	if err != nil {
		return createdBooking{}, errUnavailableTrip
	}
	var trip tripOption
	var capacity int
	err = tx.QueryRow(ctx, `
		SELECT id::text, origin_name, destination_name, starts_at, ends_at, price_minor, currency, pricing_mode, capacity
		FROM trips
		WHERE id = $1 AND tenant_id = $2 AND status IN ('new', 'assigned')
			AND origin_name ILIKE '%' || $3 || '%' AND destination_name ILIKE '%' || $4 || '%'
			AND starts_at >= $5 AND starts_at < $6
			AND NOT EXISTS (
				SELECT 1 FROM availability_blocks block
				WHERE block.tenant_id = trips.tenant_id
				  AND block.starts_at < trips.ends_at AND block.ends_at > trips.starts_at
				  AND (block.route_id IS NULL OR block.route_id = trips.route_id)
			)
		FOR UPDATE
	`, tripID, app.tenantID, state.Origin, state.Destination, day, day.AddDate(0, 0, 1)).Scan(&trip.ID, &trip.Origin, &trip.Destination, &trip.StartsAt, &trip.EndsAt, &trip.PriceMinor, &trip.Currency, &trip.PricingMode, &capacity)
	if errors.Is(err, pgx.ErrNoRows) {
		return createdBooking{}, errUnavailableTrip
	}
	if err != nil {
		return createdBooking{}, err
	}
	var customerExists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM customers WHERE id = $1 AND tenant_id = $2)`, customerID, app.tenantID).Scan(&customerExists); err != nil || !customerExists {
		return createdBooking{}, errUnavailableTrip
	}
	var alreadyBooked bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM bookings WHERE trip_id = $1 AND customer_id = $2 AND status IN ('pending', 'awaiting_payment', 'cash_on_boarding', 'confirmed'))`, tripID, customerID).Scan(&alreadyBooked); err != nil {
		return createdBooking{}, err
	}
	if alreadyBooked {
		return createdBooking{}, errAlreadyBooked
	}
	var occupied int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(sum(seats), 0) FROM bookings WHERE trip_id = $1 AND (status IN ('pending', 'cash_on_boarding', 'confirmed') OR (status = 'awaiting_payment' AND payment_hold_expires_at > now()))`, tripID).Scan(&occupied); err != nil {
		return createdBooking{}, err
	}
	if occupied+int(state.PendingSeats) > capacity {
		return createdBooking{}, errNoSeats
	}
	if state.CustomData == nil {
		state.CustomData = make(map[string]any)
	}
	state.CustomData["passenger_name"] = state.PassengerName
	state.CustomData["passenger_phone"] = state.PassengerPhone
	state.CustomData["passenger_birth_date"] = state.PassengerBirthDate
	customData, err := json.Marshal(state.CustomData)
	if err != nil {
		return createdBooking{}, err
	}
	var bookingID string
	bookingPrice, ok := priceForBooking(trip.PriceMinor, state.PendingSeats, trip.PricingMode)
	if !ok {
		return createdBooking{}, fmt.Errorf("booking price exceeds supported amount")
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO bookings (tenant_id, trip_id, customer_id, status, seats, price_minor, currency, source, custom_data, payment_hold_expires_at)
		VALUES ($1, $2, $3, 'awaiting_payment', $4, $5, $6, 'telegram', $7, now() + interval '30 minutes') RETURNING id::text
	`, app.tenantID, tripID, customerID, state.PendingSeats, bookingPrice, trip.Currency, customData).Scan(&bookingID); err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" && pgError.ConstraintName == "bookings_one_active_per_customer_trip_idx" {
			return createdBooking{}, errAlreadyBooked
		}
		return createdBooking{}, err
	}
	payload, err := json.Marshal(map[string]string{"checkout": "telegram"})
	if err != nil {
		return createdBooking{}, err
	}
	var paymentID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO payments (tenant_id, booking_id, provider, status, amount_minor, currency, idempotency_key, provider_payload)
		VALUES ($1, $2, 'internal', 'pending', $3, $4, $5, $6)
		RETURNING id::text
	`, app.tenantID, bookingID, bookingPrice, trip.Currency, "internal:"+bookingID, payload).Scan(&paymentID); err != nil {
		return createdBooking{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return createdBooking{}, err
	}
	trip.PriceMinor = bookingPrice
	return createdBooking{ID: bookingID, PaymentID: paymentID, Trip: trip, Available: capacity - occupied - int(state.PendingSeats)}, nil
}

type telegramPayment struct {
	ID           string
	MerchantName string
	IBAN         string
	EDRPOU       string
	BankName     string
	AmountMinor  int64
	Currency     string
	Route        string
}

type supportedBank struct {
	Code  string
	Label string
}

var primaryBanks = []supportedBank{
	{Code: "mono", Label: "monobank"},
	{Code: "privat", Label: "Приват24"},
	{Code: "pumb", Label: "ПУМБ"},
	{Code: "abank", Label: "А-Банк"},
}

var otherBanks = []supportedBank{
	{Code: "sense", Label: "Sense Bank"},
	{Code: "grant", Label: "Грант"},
	{Code: "ukrgas", Label: "Укргазбанк"},
	{Code: "izi", Label: "izibank"},
	{Code: "credit-dnipro", Label: "Банк Кредит Дніпро"},
	{Code: "globus", Label: "Глобус Банк"},
	{Code: "rada", Label: "РАДАБАНК"},
	{Code: "credit-agricole", Label: "Креді Агріколь"},
	{Code: "otp", Label: "ОТП Банк"},
	{Code: "vst", Label: "VST bank"},
	{Code: "idea", Label: "Ідея Банк"},
	{Code: "pravex", Label: "ПРАВЕКС БАНК"},
	{Code: "mtb", Label: "МТБ Банк"},
	{Code: "piraeus", Label: "Піреус Банк"},
	{Code: "altbank", Label: "Альтбанк"},
	{Code: "ukrsib", Label: "UKRSIBBANK"},
	{Code: "kredo", Label: "KredoBank"},
	{Code: "raif", Label: "Raiffeisen"},
	{Code: "unex", Label: "Unex Bank"},
	{Code: "accord", Label: "Акордбанк"},
	{Code: "threequarters", Label: "Банк 3/4"},
	{Code: "pivdennyi", Label: "Банк Південний"},
}

func (app *app) handlePaymentCallback(chatID, telegramID int64, data string) {
	parts := strings.Split(data, ":")
	if len(parts) < 3 || parts[0] != "pay" {
		return
	}
	paymentID := parts[len(parts)-1]
	if !validUUID(paymentID) {
		return
	}
	switch parts[1] {
	case "now":
		if len(parts) == 3 {
			app.showBankChoices(chatID, telegramID, paymentID)
		}
	case "more":
		if len(parts) == 3 {
			app.showOtherBankChoices(chatID, telegramID, paymentID)
		}
	case "cash":
		if len(parts) == 3 {
			app.chooseCashPayment(chatID, telegramID, paymentID)
		}
	case "bank":
		if len(parts) == 4 {
			app.sendBankPayment(chatID, telegramID, parts[2], paymentID)
		}
	}
}

func (app *app) showBankChoices(chatID, telegramID int64, paymentID string) {
	payment, err := app.loadTelegramPayment(context.Background(), paymentID, telegramID)
	if err != nil {
		app.log.Warn("load telegram payment", "error", err, "payment", paymentID)
		app.send(chatID, "Не удалось открыть оплату. Выберите оплату наличными при посадке или обратитесь к перевозчику.")
		return
	}
	if !validUAIBAN(payment.IBAN) || payment.MerchantName == "" || payment.EDRPOU == "" {
		app.sendWithMarkup(chatID, "Перевод по реквизитам пока не настроен. Можно оплатить наличными при посадке.", paymentCashMarkup(paymentID))
		return
	}
	if payment.Currency != "UAH" {
		app.sendWithMarkup(chatID, "Оплата по IBAN доступна только для рейсов в гривнах. Для этого рейса выберите оплату наличными.", paymentCashMarkup(paymentID))
		return
	}
	rows := make([][]tgbotapi.InlineKeyboardButton, 0, 4)
	for _, bank := range primaryBanks {
		rows = append(rows, tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData(bank.Label, "pay:bank:"+bank.Code+":"+paymentID)))
	}
	rows = append(rows,
		tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData("Другой банк", "pay:more:"+paymentID)),
		tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData("Оплатить при посадке", "pay:cash:"+paymentID)),
	)
	app.sendWithMarkup(chatID, "Выберите свой банк. После выбора я пришлю QR-код и реквизиты для перевода.", tgbotapi.NewInlineKeyboardMarkup(rows...))
}

func (app *app) showOtherBankChoices(chatID, telegramID int64, paymentID string) {
	if _, err := app.loadTelegramPayment(context.Background(), paymentID, telegramID); err != nil {
		app.log.Warn("load telegram payment", "error", err, "payment", paymentID)
		app.send(chatID, "Оплата больше недоступна. Выберите оплату при посадке.")
		return
	}
	rows := make([][]tgbotapi.InlineKeyboardButton, 0, len(otherBanks)+2)
	for _, bank := range otherBanks {
		rows = append(rows, tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData(bank.Label, "pay:bank:"+bank.Code+":"+paymentID)))
	}
	rows = append(rows,
		tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData("← Популярные банки", "pay:now:"+paymentID)),
		tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData("Оплатить при посадке", "pay:cash:"+paymentID)),
	)
	app.sendWithMarkup(chatID, "Выберите банк или используйте QR-код / реквизиты — они работают в любом банке с оплатой по IBAN.", tgbotapi.NewInlineKeyboardMarkup(rows...))
}

func (app *app) sendBankPayment(chatID, telegramID int64, bankCode, paymentID string) {
	bank, ok := findBank(bankCode)
	if !ok {
		return
	}
	payment, err := app.loadTelegramPayment(context.Background(), paymentID, telegramID)
	if err != nil {
		app.log.Warn("load telegram payment", "error", err, "payment", paymentID)
		app.send(chatID, "Оплата больше недоступна. Выберите оплату при посадке.")
		return
	}
	if !validUAIBAN(payment.IBAN) || payment.MerchantName == "" || payment.EDRPOU == "" {
		app.sendWithMarkup(chatID, "Реквізити для переказу ще не налаштовані. Можна оплатити при посадці.", paymentCashMarkup(paymentID))
		return
	}
	if payment.Currency != "UAH" {
		app.sendWithMarkup(chatID, "Оплата по IBAN доступна только для рейсов в гривнах. Для этого рейса выберите оплату наличными.", paymentCashMarkup(paymentID))
		return
	}
	if err := app.setTelegramPaymentMethod(context.Background(), paymentID, "bank_transfer", bank.Code); err != nil {
		app.log.Warn("set telegram payment method", "error", err, "payment", paymentID)
	}
	qrData := nbuPaymentQR(payment)
	png, err := qrcode.Encode(qrData, qrcode.Medium, 512)
	if err != nil {
		app.log.Error("generate payment qr", "error", err, "payment", paymentID)
		app.send(chatID, paymentDetailsText(payment)+"\n\nQR-код временно недоступен. Используйте реквизиты выше или выберите оплату при посадке.")
		return
	}
	caption := "Оплата через " + bank.Label + "\n\n" + paymentDetailsText(payment) + "\n\nОткройте " + bank.Label + ", выберите сканер QR-кода и отсканируйте изображение выше: IBAN, сумма и назначение уже заполнены. Кнопка ниже открывает универсальный QR НБУ как запасной вариант."
	photo := tgbotapi.NewPhoto(chatID, tgbotapi.FileBytes{Name: "vivat-payment-qr.png", Bytes: png})
	photo.Caption = caption
	photo.ReplyMarkup = tgbotapi.NewInlineKeyboardMarkup(
		tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonURL("Открыть QR НБУ", qrData)),
		tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData("Оплатить при посадке", "pay:cash:"+paymentID)),
	)
	if _, err := app.bot.Send(photo); err != nil {
		app.log.Error("send payment qr", "error", err, "payment", paymentID)
		app.sendWithMarkup(chatID, paymentDetailsText(payment), paymentCashMarkup(paymentID))
	}
}

func (app *app) chooseCashPayment(chatID, telegramID int64, paymentID string) {
	if _, err := app.loadTelegramPayment(context.Background(), paymentID, telegramID); err != nil {
		app.log.Warn("load telegram payment", "error", err, "payment", paymentID)
		app.send(chatID, "Оплата больше недоступна. Обратитесь к перевозчику.")
		return
	}
	if err := app.chooseCashBooking(context.Background(), paymentID); err != nil {
		app.log.Error("set cash payment method", "error", err, "payment", paymentID)
		app.send(chatID, "Не удалось сохранить способ оплаты. Обратитесь к перевозчику.")
		return
	}
	app.send(chatID, "Оплата при посадке выбрана. Подготовьте сумму наличными и сообщите водителю о бронировании.")
}

func (app *app) loadTelegramPayment(ctx context.Context, paymentID string, telegramID int64) (telegramPayment, error) {
	var payment telegramPayment
	err := app.db.QueryRow(ctx, `
		SELECT p.id::text, COALESCE(config.merchant_name, ''), COALESCE(config.iban, ''), COALESCE(config.edrpou, ''), COALESCE(config.bank_name, ''),
			p.amount_minor, p.currency, t.origin_name || ' → ' || t.destination_name
		FROM payments p
		JOIN bookings b ON b.id = p.booking_id
		JOIN customers c ON c.id = b.customer_id
		JOIN trips t ON t.id = b.trip_id
		LEFT JOIN tenant_payment_configs config ON config.tenant_id = p.tenant_id AND config.provider = 'internal' AND config.is_enabled
		WHERE p.id = $1 AND p.tenant_id = $2 AND p.provider = 'internal' AND p.status = 'pending' AND c.telegram_id = $3
		  AND b.status = 'awaiting_payment' AND b.payment_hold_expires_at > now()
	`, paymentID, app.tenantID, telegramID).Scan(&payment.ID, &payment.MerchantName, &payment.IBAN, &payment.EDRPOU, &payment.BankName, &payment.AmountMinor, &payment.Currency, &payment.Route)
	return payment, err
}

func (app *app) chooseCashBooking(ctx context.Context, paymentID string) error {
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var bookingID string
	if err := tx.QueryRow(ctx, `
		UPDATE payments
		SET payment_method = 'cash', provider_payload = provider_payload || jsonb_build_object('method', 'cash'), updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND provider = 'internal' AND status = 'pending'
		RETURNING booking_id::text
	`, paymentID, app.tenantID).Scan(&bookingID); err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `
		UPDATE bookings SET status = 'cash_on_boarding', payment_hold_expires_at = NULL, updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND status = 'awaiting_payment' AND payment_hold_expires_at > now()
	`, bookingID, app.tenantID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return tx.Commit(ctx)
}

func (app *app) setTelegramPaymentMethod(ctx context.Context, paymentID, method, bankCode string) error {
	result, err := app.db.Exec(ctx, `
		UPDATE payments
		SET payment_method = $3::text,
			provider_payload = provider_payload || jsonb_build_object('method', $3::text, 'bank', NULLIF($4::text, '')),
			updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND provider = 'internal' AND status = 'pending'
	`, paymentID, app.tenantID, method, bankCode)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func paymentCashMarkup(paymentID string) tgbotapi.InlineKeyboardMarkup {
	return tgbotapi.NewInlineKeyboardMarkup(tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData("Оплатить при посадке", "pay:cash:"+paymentID)))
}

func findBank(code string) (supportedBank, bool) {
	for _, bank := range append(primaryBanks, otherBanks...) {
		if bank.Code == code {
			return bank, true
		}
	}
	return supportedBank{}, false
}

func paymentDetailsText(payment telegramPayment) string {
	purpose := "Оплата бронирования " + strings.ToUpper(strings.ReplaceAll(payment.ID[:8], "-", ""))
	return fmt.Sprintf("Сумма: %s\nПолучатель: %s\nIBAN: %s\nЕГРПОУ / ИНН: %s\nБанк: %s\nНазначение: %s", formatMoney(payment.AmountMinor, payment.Currency), payment.MerchantName, payment.IBAN, payment.EDRPOU, payment.BankName, purpose)
}

func nbuPaymentQR(payment telegramPayment) string {
	return nbuPaymentQRAt(payment, time.Now())
}

func nbuPaymentQRAt(payment telegramPayment, issuedAt time.Time) string {
	purpose := "Оплата бронирования " + strings.ToUpper(strings.ReplaceAll(payment.ID[:8], "-", ""))
	fields := []string{
		"BCD", "003", "1", "UCT", "", qrField(payment.MerchantName), normalizeIBAN(payment.IBAN), nbuAmount(payment),
		qrField(payment.EDRPOU), "SUPP/SUPP", nbuPaymentReference(payment), qrField(purpose), "", "FFFF",
		issuedAt.Add(30 * time.Minute).Format("060102150405"), issuedAt.Format("060102150405"), "RFU",
	}
	return "https://qr.bank.gov.ua/" + base64.RawURLEncoding.EncodeToString([]byte(strings.Join(fields, "\n")))
}

func nbuAmount(payment telegramPayment) string {
	if payment.Currency != "UAH" {
		return ""
	}
	if payment.AmountMinor%100 == 0 {
		return fmt.Sprintf("UAH%d", payment.AmountMinor/100)
	}
	return fmt.Sprintf("UAH%d.%02d", payment.AmountMinor/100, payment.AmountMinor%100)
}

func nbuPaymentReference(payment telegramPayment) string {
	return "VIVAT-" + strings.ToUpper(strings.ReplaceAll(payment.ID[:8], "-", ""))
}

func qrField(value string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(strings.TrimSpace(value))
}

func normalizeIBAN(value string) string {
	return strings.ToUpper(strings.NewReplacer(" ", "", "-", "").Replace(value))
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

func validUAIBAN(value string) bool {
	value = normalizeIBAN(value)
	if len(value) != 29 || !strings.HasPrefix(value, "UA") {
		return false
	}
	rearranged := value[4:] + value[:4]
	remainder := 0
	for _, char := range rearranged {
		if char >= '0' && char <= '9' {
			remainder = (remainder*10 + int(char-'0')) % 97
			continue
		}
		if char < 'A' || char > 'Z' {
			return false
		}
		letterValue := int(char-'A') + 10
		remainder = (remainder*100 + letterValue) % 97
	}
	return remainder == 1
}

func validUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if char != '-' {
				return false
			}
			continue
		}
		if !(char >= '0' && char <= '9') && !(char >= 'a' && char <= 'f') && !(char >= 'A' && char <= 'F') {
			return false
		}
	}
	return true
}

func (app *app) canAcceptBookings(ctx context.Context) (bool, error) {
	var status string
	if err := app.db.QueryRow(ctx, `SELECT subscription_status FROM tenants WHERE id = $1`, app.tenantID).Scan(&status); err != nil {
		return false, err
	}
	app.subscriptionStatus = status
	return status == "trial" || status == "active", nil
}

func (app *app) findTrips(ctx context.Context, origin, destination string, day time.Time) ([]tripOption, error) {
	if err := app.expireBookingHolds(ctx); err != nil {
		return nil, err
	}
	rows, err := app.db.Query(ctx, `
		SELECT t.id::text, t.origin_name, t.destination_name, t.starts_at, t.ends_at, t.price_minor, t.currency, t.pricing_mode,
			t.capacity - COALESCE(SUM(b.seats) FILTER (WHERE b.status IN ('pending', 'cash_on_boarding', 'confirmed') OR (b.status = 'awaiting_payment' AND b.payment_hold_expires_at > now())), 0) AS available
		FROM trips t
		LEFT JOIN bookings b ON b.trip_id = t.id
		WHERE t.tenant_id = $1 AND t.status IN ('new', 'assigned')
			AND t.origin_name ILIKE '%' || $2 || '%' AND t.destination_name ILIKE '%' || $3 || '%'
			AND t.starts_at >= $4 AND t.starts_at < $5
			AND NOT EXISTS (
				SELECT 1 FROM availability_blocks block
				WHERE block.tenant_id = t.tenant_id
				  AND block.starts_at < t.ends_at AND block.ends_at > t.starts_at
				  AND (block.route_id IS NULL OR block.route_id = t.route_id)
			)
		GROUP BY t.id
		HAVING t.capacity > COALESCE(SUM(b.seats) FILTER (WHERE b.status IN ('pending', 'cash_on_boarding', 'confirmed') OR (b.status = 'awaiting_payment' AND b.payment_hold_expires_at > now())), 0)
		ORDER BY t.starts_at
	`, app.tenantID, origin, destination, day, day.AddDate(0, 0, 1))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectTrips(rows)
}

type sqlExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (app *app) expireBookingHolds(ctx context.Context) error {
	return expireBookingHoldsWith(ctx, app.db, app.tenantID)
}

func expireBookingHoldsWith(ctx context.Context, executor sqlExecutor, tenantID string) error {
	_, err := executor.Exec(ctx, `
		WITH expired AS (
			UPDATE bookings SET status = 'expired', updated_at = now()
			WHERE tenant_id = $1 AND status = 'awaiting_payment' AND payment_hold_expires_at <= now()
			RETURNING id
		)
		UPDATE payments SET status = 'cancelled', updated_at = now()
		WHERE tenant_id = $1 AND booking_id IN (SELECT id FROM expired) AND status IN ('pending', 'authorized')
	`, tenantID)
	return err
}

func (app *app) findAlternativeDates(ctx context.Context, origin, destination string, from time.Time) ([]string, error) {
	rows, err := app.db.Query(ctx, `
		SELECT DISTINCT (starts_at AT TIME ZONE $4)::date
		FROM trips
		WHERE tenant_id = $1 AND status IN ('new', 'assigned')
			AND origin_name ILIKE '%' || $2 || '%' AND destination_name ILIKE '%' || $3 || '%'
			AND starts_at >= $5 AND starts_at < $5 + interval '14 days'
			AND NOT EXISTS (
				SELECT 1 FROM availability_blocks block
				WHERE block.tenant_id = trips.tenant_id
				  AND block.starts_at < trips.ends_at AND block.ends_at > trips.starts_at
				  AND (block.route_id IS NULL OR block.route_id = trips.route_id)
			)
		ORDER BY 1 LIMIT 4
	`, app.tenantID, origin, destination, app.timezone.String(), from)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]string, 0)
	for rows.Next() {
		var date time.Time
		if err := rows.Scan(&date); err != nil {
			return nil, err
		}
		result = append(result, date.In(app.timezone).Format("02.01.2006"))
	}
	return result, rows.Err()
}

func collectTrips(rows pgx.Rows) ([]tripOption, error) {
	items := make([]tripOption, 0)
	for rows.Next() {
		var item tripOption
		if err := rows.Scan(&item.ID, &item.Origin, &item.Destination, &item.StartsAt, &item.EndsAt, &item.PriceMinor, &item.Currency, &item.PricingMode, &item.Available); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (app *app) findCustomerByTelegram(ctx context.Context, telegramID int64) (string, error) {
	var id string
	err := app.db.QueryRow(ctx, `SELECT id::text FROM customers WHERE tenant_id = $1 AND telegram_id = $2`, app.tenantID, telegramID).Scan(&id)
	return id, err
}

func (app *app) stateKey(chatID int64) string {
	return "vivat:booking-state:" + app.tenantID + ":" + strconv.FormatInt(chatID, 10)
}
func (app *app) saveState(chatID int64, state bookingState) {
	encoded, err := json.Marshal(state)
	if err == nil {
		app.redis.Set(context.Background(), app.stateKey(chatID), encoded, stateTTL)
	}
}
func (app *app) getState(chatID int64) (bookingState, bool) {
	value, err := app.redis.Get(context.Background(), app.stateKey(chatID)).Bytes()
	if err != nil {
		return bookingState{}, false
	}
	var state bookingState
	return state, json.Unmarshal(value, &state) == nil
}
func (app *app) clearState(chatID int64) { app.redis.Del(context.Background(), app.stateKey(chatID)) }
func welcomeMessage(companyName string) string {
	companyName = strings.TrimSpace(companyName)
	if companyName == "" {
		companyName = "перевозчик"
	}
	return "Добро пожаловать в " + companyName + ". Найдём подходящий рейс, оформим бронь и покажем ваши поездки."
}

func (app *app) sendWelcome(chatID int64) {
	keyboard := tgbotapi.NewReplyKeyboard(
		tgbotapi.NewKeyboardButtonRow(tgbotapi.NewKeyboardButton("Найти рейс")),
		tgbotapi.NewKeyboardButtonRow(tgbotapi.NewKeyboardButton("Индивидуальный трансфер")),
		tgbotapi.NewKeyboardButtonRow(tgbotapi.NewKeyboardButton("Мои поездки"), tgbotapi.NewKeyboardButton("Связь с диспетчером")),
	)
	keyboard.ResizeKeyboard = true
	app.sendWithMarkup(chatID, welcomeMessage(app.tenantName), keyboard)
}
func (app *app) send(chatID int64, text string) { app.sendWithMarkup(chatID, text, nil) }
func (app *app) sendNotification(chatID int64, text string) error {
	_, err := app.bot.Send(tgbotapi.NewMessage(chatID, text))
	return err
}
func (app *app) sendWithMarkup(chatID int64, text string, markup interface{}) {
	message := tgbotapi.NewMessage(chatID, text)
	message.ReplyMarkup = markup
	if _, err := app.bot.Send(message); err != nil {
		app.log.Error("send telegram message", "error", err)
	}
}
func formatTripStatusNotification(payload telegramoutbox.TripStatusPayload, timezone *time.Location) string {
	status := map[string]string{
		"new":         "рейс открыт для бронирования",
		"assigned":    "рейс назначен",
		"in_progress": "рейс отправился",
		"completed":   "рейс завершён",
		"cancelled":   "рейс отменён",
	}[payload.Status]
	if status == "" {
		status = "статус рейса обновлён"
	}
	var text strings.Builder
	text.WriteString("Обновление вашей поездки\n\n")
	text.WriteString(payload.Origin)
	text.WriteString(" → ")
	text.WriteString(payload.Destination)
	text.WriteString("\nСтатус: ")
	text.WriteString(status)
	if !payload.StartsAt.IsZero() {
		text.WriteString("\nОтправление: ")
		text.WriteString(payload.StartsAt.In(timezone).Format("02.01.2006 15:04"))
	}
	if payload.Vehicle != "" {
		text.WriteString("\nТранспорт: ")
		text.WriteString(payload.Vehicle)
	}
	if payload.Driver != "" {
		text.WriteString("\nВодитель: ")
		text.WriteString(payload.Driver)
		if payload.DriverPhone != "" {
			text.WriteString(" · ")
			text.WriteString(payload.DriverPhone)
		}
	}
	return text.String()
}

func formatIndividualTransferRequestStatusNotification(payload telegramoutbox.IndividualTransferRequestPayload, timezone *time.Location) string {
	status := map[string]string{
		"in_progress": "Диспетчер принял заявку в работу.",
		"closed":      "Заявка обработана. Диспетчер сообщит согласованные детали поездки.",
		"cancelled":   "К сожалению, заявку не удалось подтвердить. Свяжитесь с диспетчером, чтобы подобрать другой вариант.",
	}[payload.Status]
	if status == "" {
		status = "Статус заявки обновлён."
	}
	return fmt.Sprintf("Индивидуальный трансфер\n%s → %s\n%s\n\n%s", payload.Origin, payload.Destination, payload.RequestedDepartureAt.In(timezone).Format("02.01.2006 в 15:04"), status)
}
func requiredEnv(key string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		panic("missing required environment variable: " + key)
	}
	return value
}
func optionalEnv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
func startOfDay(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, value.Location())
}
func validPlace(value string) bool {
	return len([]rune(strings.TrimSpace(value))) >= 2 && len([]rune(value)) <= 120
}
func normalizePhone(value string) string {
	var digits strings.Builder
	for _, character := range value {
		if character >= '0' && character <= '9' {
			digits.WriteRune(character)
		}
	}
	number := digits.String()
	if strings.HasPrefix(number, "00") {
		number = number[2:]
	}
	if len(number) < 7 || len(number) > 15 || strings.HasPrefix(number, "0") {
		return ""
	}
	return "+" + number
}
func formatMoney(minor int64, currency string) string {
	sign := ""
	if minor < 0 {
		sign = "-"
		minor = -minor
	}
	return fmt.Sprintf("%s%d.%02d %s", sign, minor/100, minor%100, currency)
}

func bookingStatusLabel(status string) string {
	switch status {
	case "pending":
		return "ожидает подтверждения"
	case "awaiting_payment":
		return "ожидает оплату"
	case "cash_on_boarding":
		return "оплата при посадке"
	case "confirmed":
		return "подтверждена"
	case "completed":
		return "завершена"
	default:
		return status
	}
}
