package notificationprefs

import (
	"encoding/json"
	"errors"
	"time"
)

type Event struct {
	Key      string `json:"key"`
	Category string `json:"category"`
	Group    string `json:"group"`
	Label    string `json:"label"`
	Hint     string `json:"hint"`
}

var Events = []Event{
	{"bookingCreated", "newBookings", "Бронирования", "Новая бронь", "Бронь с сайта, из бота или от диспетчера."},
	{"bookingChanged", "newBookings", "Бронирования", "Изменение брони", "Статус, количество мест или назначенный рейс."},
	{"bookingCancelled", "newBookings", "Бронирования", "Отмена брони", "Отменённая или просроченная бронь."},
	{"requestCreated", "newRequests", "Заявки", "Новая заявка", "Новая заявка на индивидуальную поездку."},
	{"requestChanged", "newRequests", "Заявки", "Обновление заявки", "Изменение статуса или создание брони по заявке."},
	{"tripAssigned", "trips", "Рейсы", "Назначение рейса", "Новый рейс или изменение водителя."},
	{"tripChanged", "trips", "Рейсы", "Изменение рейса", "Время, автомобиль, маршрут или статус поездки."},
	{"tripCancelled", "trips", "Рейсы", "Отмена рейса", "Рейс отменён перевозчиком."},
	{"paymentPaid", "payments", "Оплата", "Оплата получена", "Подтверждённый платёж за бронирование."},
	{"paymentFailed", "payments", "Оплата", "Проблема с оплатой", "Неуспешная или отменённая оплата."},
	{"paymentChanged", "payments", "Оплата", "Обновление оплаты", "Создание платежа, возврат или другой статус."},
	{"teamChanged", "team", "Команда", "Изменение доступа", "Роль или доступ сотрудника изменены."},
}

type Channels struct {
	Push     bool `json:"push"`
	Telegram bool `json:"telegram"`
}
type QuietHours struct {
	Enabled  bool   `json:"enabled"`
	Days     []int  `json:"days"`
	Start    string `json:"start"`
	End      string `json:"end"`
	Timezone string `json:"timezone"`
}
type Preferences struct {
	Events map[string]Channels `json:"events"`
	Quiet  QuietHours          `json:"quietHours"`
}

func Allowed(role, category string) bool {
	return role == "owner" || role == "admin" || role == "developer" || (role == "dispatcher" && (category == "newRequests" || category == "newBookings" || category == "trips" || category == "test")) || (role == "driver" && (category == "trips" || category == "newBookings" || category == "test"))
}
func Defaults(legacy map[string]bool) Preferences {
	p := Preferences{Events: map[string]Channels{}, Quiet: QuietHours{Days: []int{0, 1, 2, 3, 4, 5, 6}, Start: "20:00", End: "08:00", Timezone: "Europe/Warsaw"}}
	for _, e := range Events {
		enabled, exists := legacy[e.Category]
		if !exists {
			enabled = true
		}
		p.Events[e.Key] = Channels{Push: enabled, Telegram: true}
	}
	return p
}
func Load(raw []byte, legacy map[string]bool) Preferences {
	p := Defaults(legacy)
	if len(raw) == 0 || string(raw) == "{}" {
		return p
	}
	var stored Preferences
	if json.Unmarshal(raw, &stored) != nil {
		return p
	}
	for key, channels := range stored.Events {
		if _, ok := p.Events[key]; ok {
			p.Events[key] = channels
		}
	}
	if validQuiet(stored.Quiet) == nil {
		p.Quiet = stored.Quiet
	}
	return p
}
func Validate(p Preferences) error {
	known := map[string]bool{}
	for _, e := range Events {
		known[e.Key] = true
	}
	if len(p.Events) != len(known) {
		return errors.New("Выберите настройки для всех событий.")
	}
	for key := range p.Events {
		if !known[key] {
			return errors.New("Неизвестный тип уведомления.")
		}
	}
	return validQuiet(p.Quiet)
}
func validQuiet(q QuietHours) error {
	if _, err := time.LoadLocation(q.Timezone); err != nil {
		return errors.New("Выберите корректный часовой пояс.")
	}
	a, e1 := time.Parse("15:04", q.Start)
	b, e2 := time.Parse("15:04", q.End)
	if e1 != nil || e2 != nil || a.Equal(b) {
		return errors.New("Укажите разные время начала и окончания тихих часов.")
	}
	seen := map[int]bool{}
	for _, d := range q.Days {
		if d < 0 || d > 6 || seen[d] {
			return errors.New("Некорректные дни тихих часов.")
		}
		seen[d] = true
	}
	if q.Enabled && len(q.Days) == 0 {
		return errors.New("Выберите дни для тихих часов.")
	}
	return nil
}
func EventKey(key, category string) string {
	if key != "" {
		return key
	}
	for _, e := range Events {
		if e.Category == category {
			return e.Key
		}
	}
	return ""
}
func (p Preferences) Enabled(key, category, channel string) bool {
	if category == "test" {
		return true
	}
	c, exists := p.Events[EventKey(key, category)]
	if !exists {
		return false
	}
	if channel == "telegram" {
		return c.Telegram
	}
	return c.Push
}

// Days refer to the day on which a quiet interval starts, including overnight intervals.
func (p Preferences) ResumeAt(now time.Time) time.Time {
	q := p.Quiet
	if !q.Enabled || validQuiet(q) != nil {
		return now
	}
	loc, _ := time.LoadLocation(q.Timezone)
	local := now.In(loc)
	start, _ := time.Parse("15:04", q.Start)
	end, _ := time.Parse("15:04", q.End)
	for offset := -1; offset <= 0; offset++ {
		day := local.AddDate(0, 0, offset)
		selected := false
		for _, d := range q.Days {
			if d == int(day.Weekday()) {
				selected = true
			}
		}
		if !selected {
			continue
		}
		from := time.Date(day.Year(), day.Month(), day.Day(), start.Hour(), start.Minute(), 0, 0, loc)
		to := time.Date(day.Year(), day.Month(), day.Day(), end.Hour(), end.Minute(), 0, 0, loc)
		if !to.After(from) {
			to = to.AddDate(0, 0, 1)
		}
		if !now.Before(from) && now.Before(to) {
			return to
		}
	}
	return now
}
