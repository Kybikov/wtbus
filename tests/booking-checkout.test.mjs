import test from "node:test"
import assert from "node:assert/strict"
import { validateCheckout, bookingPassengers } from "../lib/booking-checkout.ts"

const valid = () => ({ passengers: [{firstName:"IVAN",lastName:"O'Neil",birthDate:"1990-01-01"},{firstName:"Anna-Maria",lastName:"Petrenko",birthDate:"2000-02-29"}],seats:2,phone:"+380670000013",paymentMethod:"cash_on_boarding",fields:[{key:"needs_assistance",type:"boolean",label:"Допомога",options:[]}],custom:{needs_assistance:false},today:"2026-09-18" })

test("checkout requires every passenger, a valid contact and explicit available payment", () => {
  assert.deepEqual(validateCheckout(valid()),{})
  const input=valid(); input.passengers.pop(); input.phone="+3801"; input.paymentMethod=""
  const errors=validateCheckout(input)
  assert.ok(errors.passengers); assert.ok(errors["passenger-phone"]); assert.ok(errors["payment-method"])
})
test("every passenger needs Latin document names and a real non-future birth date", () => {
  const input=valid(); input.passengers[1]={firstName:"Іван",lastName:"Petrenko",birthDate:"2001-02-29"}
  let errors=validateCheckout(input)
  assert.ok(errors["passenger-1-firstName"]); assert.ok(errors["passenger-1-birthDate"])
  input.passengers[1].birthDate="2026-09-19"
  errors=validateCheckout(input); assert.ok(errors["passenger-1-birthDate"])
})
test("required extra fields reject whitespace and invalid dates but accept false and zero", () => {
  const input=valid();input.fields.push({key:"document",type:"text",label:"Документ",options:[]},{key:"count",type:"number",label:"Число",options:[]},{key:"issued",type:"date",label:"Дата",options:[]})
  input.custom={needs_assistance:false,document:"   ",count:0,issued:"2026-02-30"}
  const errors=validateCheckout(input)
  assert.ok(errors["booking-document"]);assert.ok(errors["booking-issued"])
  assert.equal(errors["booking-count"],undefined);assert.equal(errors["booking-needs_assistance"],undefined)
})
test("legacy booking data remains readable without a group manifest", () => {
  assert.deepEqual(bookingPassengers({passenger_name:"Legacy"}),[])
  assert.deepEqual(bookingPassengers({passengers:[null,{firstName:"Bad"},...valid().passengers]}),valid().passengers)
})
