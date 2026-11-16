package main

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"math/big"
	"strconv"
	"time"
)

func moneyRate(ctx context.Context, tx pgx.Tx, tenant, from, to, date string) (string, error) {
	if from == to {
		return "1", nil
	}
	read := func(c string) (*big.Rat, error) {
		if c == "UAH" {
			return big.NewRat(1, 1), nil
		}
		var s string
		err := tx.QueryRow(ctx, `SELECT rate_to_uah::text FROM money_rate_history WHERE tenant_id=$1 AND currency=$2 AND rate_date=$3::date`, tenant, c, date).Scan(&s)
		if err != nil {
			return nil, err
		}
		v, ok := new(big.Rat).SetString(s)
		if !ok {
			return nil, errors.New("Некорректный курс.")
		}
		return v, nil
	}
	a, err := read(from)
	if err != nil {
		return "", err
	}
	b, err := read(to)
	if err != nil {
		return "", err
	}
	return new(big.Rat).Quo(a, b).FloatString(12), nil
}

// A quote is stored under its observation day, never relabelled as an earlier day.
func (app *application) storeMoneyRateHistory(ctx context.Context, tenant string, items []monobankRate) error {
	tx, err := app.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var zone string
	if err = tx.QueryRow(ctx, `SELECT timezone FROM tenants WHERE id=$1`, tenant).Scan(&zone); err != nil {
		return err
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	codes := map[int]string{978: "EUR", 840: "USD", 985: "PLN"}
	for _, v := range items {
		c := codes[v.A]
		if v.B != 980 || c == "" || v.Date <= 0 {
			continue
		}
		rate := new(big.Rat)
		if v.Buy > 0 && v.Sell > 0 {
			a, _ := new(big.Rat).SetString(strconv.FormatFloat(v.Buy, 'f', -1, 64))
			b, _ := new(big.Rat).SetString(strconv.FormatFloat(v.Sell, 'f', -1, 64))
			if a == nil || b == nil {
				continue
			}
			rate.Quo(new(big.Rat).Add(a, b), big.NewRat(2, 1))
		} else {
			var ok bool
			rate, ok = new(big.Rat).SetString(strconv.FormatFloat(v.Cross, 'f', -1, 64))
			if !ok {
				continue
			}
		}
		if rate.Sign() <= 0 {
			continue
		}
		_, err = tx.Exec(ctx, `INSERT INTO money_rate_history(tenant_id,rate_date,currency,rate_to_uah,source) VALUES($1,$2::date,$3,$4::numeric,'monobank') ON CONFLICT DO NOTHING`, tenant, time.Unix(v.Date, 0).In(loc).Format("2006-01-02"), c, rate.FloatString(12))
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
