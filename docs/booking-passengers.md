# Booking passengers

Booking details show one editable passenger card for each reserved seat. Legacy bookings fall back to the booking contact for the first passenger and empty cards for other existing seats. Editing a passenger changes that booking's manifest, not the customer's contact record. Text and phone edits save on blur; date selections save immediately through the serialized field queue.

The topbar's Add passenger action appends a seat explicitly. The server locks the trip and booking, checks the expected passenger count and current capacity, and updates the manifest, seats and price atomically. It keeps all boarding indexes and collected cash unchanged. Per-passenger quotes add the current booking's unit amount; per-booking fares remain unchanged. The confirmation shows the total before and after. Pending payment orders must be resolved first. Additional paid seats on bank-transfer bookings use a separate booking so bank payment matching cannot silently change.

Phone and birth date are optional for staff-entered companions; the first name is required. Dates and international phone numbers are validated when supplied. Public checkout retains its stricter document requirements. Actor-attributed passenger events are written in the same transaction, without copying personal passenger values into the activity log. Seat and price changes are included in addition events.

Trip lists expose `availableSeats` from active reservations and unexpired payment holds. Cancelled bookings and expired holds do not consume capacity. The default view puts Free seats beside Status; saved views can enable the column through Columns or Fields.

Verification: `TestBookingPassengerManagement` covers legacy manifests, field patches, validation, tenant/role isolation, stale additions, concurrent last-seat contention, retained cash/boarding, expired holds, trip free-seat reporting, cleared phone persistence, flat booking fares and activity attribution. It uses the isolated schema supplied by `NOTIFICATION_TEST_DATABASE_URL`.
