package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	tgbotapi "github.com/go-telegram-bot-api/telegram-bot-api/v5"
)

// Only an explicitly shared own contact enables profile birthday lookup.
func (app *app) askTelegramBirthDate(chatID int64, state bookingState) {
	response, err := app.bot.Request(tgbotapi.ChatInfoConfig{ChatConfig: tgbotapi.ChatConfig{ChatID: chatID}})
	if err == nil {
		var chat struct {
			Birthdate *struct {
				Day   int `json:"day"`
				Month int `json:"month"`
				Year  int `json:"year"`
			} `json:"birthdate"`
		}
		if json.Unmarshal(response.Result, &chat) == nil && chat.Birthdate != nil && chat.Birthdate.Year != 0 {
			value := fmt.Sprintf("%02d.%02d.%04d", chat.Birthdate.Day, chat.Birthdate.Month, chat.Birthdate.Year)
			if date, ok := parsePassengerBirthDate(value, app.timezone, time.Now()); ok {
				app.offerBirthDates(chatID, state, []string{date})
				return
			}
		}
	}
	if state.Step == "request_passenger_birth_date" {
		app.askIndividualRequestBirthDate(chatID, state)
	} else {
		app.askPassengerBirthDate(chatID, state)
	}
}

func passengerBirthDateCandidates(value string, location *time.Location, now time.Time) []string {
	if date, ok := parsePassengerBirthDate(value, location, now); ok {
		return []string{date}
	}
	value = strings.TrimSpace(value)
	if len(value) != 9 || strings.IndexFunc(value, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
		return nil
	}
	var dates []string
	for index := range value {
		date, ok := parsePassengerBirthDate(value[:index]+value[index+1:], location, now)
		if !ok {
			continue
		}
		exists := false
		for _, previous := range dates {
			if previous == date {
				exists = true
			}
		}
		if !exists {
			dates = append(dates, date)
		}
	}
	return dates
}

func (app *app) offerBirthDates(chatID int64, state bookingState, dates []string) {
	if len(dates) == 0 {
		app.send(chatID, "Не удалось распознать дату. Введите день, месяц и год, например 27.12.2005 или 27122005.")
		return
	}
	state.PendingBirthDates = dates
	state.BirthDateReturnStep = state.Step
	state.BirthDateNonce = strconv.FormatInt(time.Now().UnixNano(), 36)
	app.saveState(chatID, state)
	rows := make([][]tgbotapi.InlineKeyboardButton, 0, len(dates)+1)
	for index, date := range dates {
		rows = append(rows, tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData(formatBirthDate(date), fmt.Sprintf("dob:%s:%d", state.BirthDateNonce, index))))
	}
	rows = append(rows, tgbotapi.NewInlineKeyboardRow(tgbotapi.NewInlineKeyboardButtonData("Ввести другую дату", "dob:"+state.BirthDateNonce+":change")))
	prompt := "Проверьте дату рождения пассажира и подтвердите её."
	if len(dates) > 1 {
		prompt = "В дате, похоже, лишняя цифра. Выберите правильную дату или введите другую."
	}
	app.sendWithMarkup(chatID, prompt, tgbotapi.NewInlineKeyboardMarkup(rows...))
}

func (app *app) handleBirthDateCallback(chatID int64, data string) {
	state, ok := app.getState(chatID)
	parts := strings.Split(data, ":")
	if !ok || len(parts) != 3 || parts[1] != state.BirthDateNonce || state.BirthDateNonce == "" || (state.Step != "passenger_birth_date" && state.Step != "request_passenger_birth_date") || state.Step != state.BirthDateReturnStep {
		return
	}
	if parts[2] == "change" {
		state.PendingBirthDates = nil
		state.BirthDateNonce = ""
		if state.Step == "request_passenger_birth_date" {
			app.askIndividualRequestBirthDate(chatID, state)
		} else {
			app.askPassengerBirthDate(chatID, state)
		}
		return
	}
	index, err := strconv.Atoi(parts[2])
	if err != nil || index < 0 || index >= len(state.PendingBirthDates) {
		return
	}
	date, valid := parsePassengerBirthDate(state.PendingBirthDates[index], app.timezone, time.Now())
	if !valid {
		return
	}
	state.PassengerBirthDate = date
	state.PendingBirthDates = nil
	state.BirthDateNonce = ""
	state.BirthDateReturnStep = ""
	if state.Step == "request_passenger_birth_date" {
		app.askIndividualRequestSeats(chatID, state)
	} else {
		app.askSeats(chatID, state)
	}
}
